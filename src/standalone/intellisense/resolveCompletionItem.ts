// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationError, CancellationToken, CompletionItem, Position, TextDocument } from 'vscode';
import { IKernel } from '../../kernels/types';
import { StopWatch } from '../../platform/common/utils/stopWatch';
import { Telemetry, sendTelemetryEvent } from '../../telemetry';
import type { Kernel, KernelMessage } from '@jupyterlab/services';
import { raceTimeoutError } from '../../platform/common/utils/async';
import { raceCancellation, wrapCancellationTokens } from '../../platform/common/cancellation';
import { dispose } from '../../platform/common/utils/lifecycle';
import { stripAnsi } from '../../platform/common/utils/regexp';
import { traceInfo, traceVerbose, traceWarning } from '../../platform/logging';
import { getDisplayNameOrNameOfKernelConnection, isPythonKernelConnection } from '../../kernels/helpers';
import { Settings } from '../../platform/common/constants';
import { convertDocumentationToMarkdown } from './completionDocumentationFormatter';
import { once } from '../../platform/common/utils/events';
import { IDisposable } from '../../platform/common/types';
import { splitLines } from '../../platform/common/helpers';
import { escapeStringToEmbedInPythonCode } from '../../kernels/chat/generator';
import { execCodeInBackgroundThread } from '../api/kernels/backgroundExecution';
import { noop } from '../../platform/common/utils/misc';

/**
 * Based on my (Don) findings with a local Python Kernel, the max number of pending requests I had was just 1.
 * Hence its fair to assume that having 1 pending request is unlikely and not a scenario we want to run into.
 * I.e. 1 request waiting for a response from the kernel is bad.
 */
export const maxPendingKernelRequests = 1;
const maxTimeWaitingForResolveCompletion = Settings.IntellisenseResolveTimeout;
const maxNumberOfTimesAllowedToExceedTimeoutBeforeIgnoringAllRequests = 5;

const kernelsThatDoNotSupportCompletionResolveOrAreTooSlowToReply = new WeakSet<IKernel>();

class RequestTimedoutError extends Error {
    constructor() {
        super('Request timed out');
    }
}

export async function resolveCompletionItem(
    item: CompletionItem,
    originalCompletionItem: undefined | CompletionItem,
    token: CancellationToken,
    kernel: IKernel,
    kernelId: string,
    monacoLanguage: string,
    document: TextDocument,
    position: Position
): Promise<CompletionItem> {
    if (!item.range || !kernel.session?.kernel) {
        // We always set a range in the completion item we send.
        // Except for Python.
        return item;
    }
    if (kernelsThatDoNotSupportCompletionResolveOrAreTooSlowToReply.has(kernel)) {
        return item;
    }

    // We do not want to delay sending completion data because kernel is busy.
    // Also we do not want to make things worse, as kernel is already busy why slow it even further.
    if (!isPythonKernelConnection(kernel.kernelConnectionMetadata) && kernel.status !== 'idle') {
        return item;
    }
    const message = createInspectRequestMessage(originalCompletionItem || item, document, position);
    const request = sendInspectRequest(message, kernel, token);
    const consolidatedToken = wrapCancellationTokens(token);
    try {
        const content = await raceTimeoutError(
            maxTimeWaitingForResolveCompletion,
            new RequestTimedoutError(),
            raceCancellation(consolidatedToken.token, request)
        );
        if (!token.isCancellationRequested && content?.status === 'ok' && content?.found) {
            const documentation = getDocumentation(content);
            item.documentation = convertDocumentationToMarkdown(documentation, monacoLanguage);
        }
    } catch (ex) {
        if (ex instanceof CancellationError) {
            return item;
        }
        if (ex instanceof RequestTimedoutError) {
            consolidatedToken.cancel();
            handleKernelRequestTimeout(kernel, monacoLanguage, kernelId);
        }
    } finally {
        consolidatedToken.dispose();
    }

    return item;
}

function getDocumentation(content: KernelMessage.IInspectReply) {
    if (!content || content.status !== 'ok' || !content.found) {
        return ';';
    }
    if (!content.data || typeof content.data !== 'object') {
        return '';
    }
    return 'text/plain' in content.data ? stripAnsi(content.data['text/plain'] as string) : '';
}

const telemetrySentForUnableToResolveCompletion = new WeakSet<IKernel>();
function handleKernelRequestTimeout(kernel: IKernel, monacoLanguage: string, kernelId: string) {
    if (isPythonKernelConnection(kernel.kernelConnectionMetadata)) {
        return;
    }
    if (kernelsThatDoNotSupportCompletionResolveOrAreTooSlowToReply.has(kernel)) {
        return;
    }
    kernelsThatDoNotSupportCompletionResolveOrAreTooSlowToReply.add(kernel);
    traceWarning(
        `Failed to inspect code in kernel ${getDisplayNameOrNameOfKernelConnection(kernel.kernelConnectionMetadata)}`
    );
    if (!telemetrySentForUnableToResolveCompletion.has(kernel)) {
        telemetrySentForUnableToResolveCompletion.add(kernel);
        sendTelemetryEvent(Telemetry.KernelCodeCompletionCannotResolve, undefined, {
            kernelId,
            kernelConnectionType: kernel.kernelConnectionMetadata.kind,
            kernelLanguage: monacoLanguage
        });
    }
}

const cachedKernelInspectRequests = new WeakMap<
    Kernel.IKernelConnection,
    Map<string, KernelMessage.IInspectReplyMsg['content']>
>();

const timeToInspectRequest = new WeakMap<
    Kernel.IKernelConnection,
    { maxTime: number; lastRequestTime: number; numberOfTimesMaxedOut: 0 }
>();

async function sendPythonInspectRequest(
    kernel: IKernel,
    message: Parameters<Kernel.IKernelConnection['requestInspect']>[0],
    token: CancellationToken
) {
    const codeToExecute = `return get_ipython().kernel.do_inspect("${escapeStringToEmbedInPythonCode(message.code)}", ${
        message.cursor_pos
    }, ${message.detail_level})`;
    const content = await execCodeInBackgroundThread<KernelMessage.IInspectReplyMsg['content']>(
        kernel,
        [codeToExecute],
        token
    );
    return { content } as KernelMessage.IInspectReplyMsg;
}

const emptyResult: KernelMessage.IInspectReplyMsg['content'] = { data: {}, found: false, status: 'ok', metadata: {} };

function getCachedResult(
    kernel: IKernel,
    message: KernelMessage.IInspectRequestMsg['content']
): KernelMessage.IInspectReplyMsg['content'] | undefined {
    if (!kernel.session?.kernel) {
        return;
    }
    const cacheKey = JSON.stringify(message);
    const cache = cachedKernelInspectRequests.get(kernel.session.kernel);
    return cache?.get(cacheKey);
}

function cachedResult(
    kernel: IKernel,
    message: KernelMessage.IInspectRequestMsg['content'],
    content: KernelMessage.IInspectReplyMsg['content']
): KernelMessage.IInspectReplyMsg['content'] | undefined {
    if (!kernel.session?.kernel) {
        return;
    }
    if (content.status !== 'ok' || !content.found) {
        return;
    }
    const cacheKey = JSON.stringify(message);
    const cache =
        cachedKernelInspectRequests.get(kernel.session.kernel) ||
        new Map<string, KernelMessage.IInspectReplyMsg['content']>();
    cachedKernelInspectRequests.set(kernel.session.kernel, cache);
    // If we have more than 100 items in the cache, clear it.
    if (cache.size > 100) {
        cache.clear();
    }
    cache.set(cacheKey, content);
}

function shoudlSendInspectRequest(kernel: IKernel) {
    if (!kernel.session?.kernel) {
        return false;
    }
    // If in the past requests, we've had some requests that took more than 2 seconds,
    // then do not send any more inspect requests.
    const times = timeToInspectRequest.get(kernel.session.kernel) || {
        maxTime: 0,
        lastRequestTime: 0,
        numberOfTimesMaxedOut: 0
    };

    // If this is a non-python kernel, and even if 1 request took too long, then do not send any more requests.
    if (
        !isPythonKernelConnection(kernel.kernelConnectionMetadata) &&
        times.maxTime > maxTimeWaitingForResolveCompletion
    ) {
        traceWarning(
            `Not sending inspect request as previous requests took over ${maxTimeWaitingForResolveCompletion}s.`
        );
        return false;
    }

    if (times.numberOfTimesMaxedOut > maxNumberOfTimesAllowedToExceedTimeoutBeforeIgnoringAllRequests) {
        // Ok we know that at least 5 requests took more than ?s.
        // Do not send another request at all.
        // No point in causing unnecessary load on the kernel.
        traceWarning(
            `Not sending inspect request as there have been at least ${maxNumberOfTimesAllowedToExceedTimeoutBeforeIgnoringAllRequests} requests that took over ${maxTimeWaitingForResolveCompletion}s.`
        );
        return false;
    }
    if (times.maxTime > maxTimeWaitingForResolveCompletion && Date.now() - times.lastRequestTime < 30_000) {
        // Ok we know that at least one request took more than 1s.
        // Do not send another request, lets wait for at least 30s before we send another request.
        traceWarning(
            `Not sending inspect request as previous requests took over ${maxTimeWaitingForResolveCompletion}s.`
        );
        return false;
    }
    return true;
}

async function waitForKernelToBeReady(kernel: IKernel, token: CancellationToken) {
    if (!kernel.session?.kernel) {
        return;
    }
    if (!doesKernelHaveTooManyPendingRequests(kernel)) {
        return;
    }
    traceInfo(
        `Too many pending requests ${getPendingRequestCount(kernel)} for kernel ${
            kernel.id
        }, waiting for it to be ready.`
    );
    const kernelConnection = kernel.session.kernel;
    const disposables: IDisposable[] = [];
    await raceCancellation(
        token,
        new Promise<void>((resolve) => {
            const statusChangeHandler = () => {
                if (!doesKernelHaveTooManyPendingRequests(kernel)) {
                    resolve();
                    dispose(disposables);
                    return;
                }
                // Perhaps we have some async code.
                setInterval(statusChangeHandler, 100);
            };
            once(token.onCancellationRequested)(
                () => {
                    resolve();
                    kernelConnection.statusChanged.disconnect(statusChangeHandler);
                },
                undefined,
                disposables
            );
            kernelConnection.statusChanged.connect(statusChangeHandler);
            disposables.push({
                dispose: () => {
                    kernelConnection.statusChanged.disconnect(statusChangeHandler);
                }
            });
        })
    ).finally(() => dispose(disposables));
}

function trackCompletionTime(kernel: IKernel, elapsedTime: number) {
    if (!kernel.session?.kernel) {
        return;
    }
    const times = timeToInspectRequest.get(kernel.session.kernel) || {
        maxTime: 0,
        lastRequestTime: 0,
        numberOfTimesMaxedOut: 0
    };
    times.maxTime = Math.max(times.maxTime, elapsedTime);
    times.lastRequestTime = Date.now();
    if (elapsedTime > maxTimeWaitingForResolveCompletion) {
        times.numberOfTimesMaxedOut += 1;
    }
    timeToInspectRequest.set(kernel.session.kernel, times);
}

/**
 * We do not want to flood the kernel with too many pending requests.
 * Thats bad, as that can slow the kernel down.
 * Instead we will wait until there are only a max of 5 pending requests.
 */
async function sendInspectRequest(
    message: Parameters<Kernel.IKernelConnection['requestInspect']>[0],
    kernel: IKernel,
    token: CancellationToken
): Promise<KernelMessage.IInspectReplyMsg['content'] | undefined> {
    if (!kernel.session?.kernel) {
        return;
    }
    const cachedValue = getCachedResult(kernel, message);
    if (cachedValue) {
        return cachedValue;
    }
    // If in the past requests, we've had some requests that took too long,
    // then do not send any more inspect requests.
    if (!shoudlSendInspectRequest(kernel)) {
        return emptyResult;
    }

    await waitForKernelToBeReady(kernel, token);

    if (token.isCancellationRequested) {
        return emptyResult;
    }

    const completionPending = incrementPendingCounter(kernel);
    const stopWatch = new StopWatch();

    const codeForLogging = splitLines(message.code).reverse()[0].slice(-50);
    traceVerbose(`Inspecting code ${codeForLogging}`);
    const request = isPythonKernelConnection(kernel.kernelConnectionMetadata)
        ? sendPythonInspectRequest(kernel, message, token)
        : kernel.session.kernel.requestInspect(message);

    void request.finally(() => completionPending.dispose());

    // No need to raceCancel with the token, thats expected in the calling code.
    return request.then(({ content }) => {
        if (!kernel.session?.kernel) {
            return;
        }
        cachedResult(kernel, message, content);
        trackCompletionTime(kernel, stopWatch.elapsedTime);

        const logger = stopWatch.elapsedTime > maxTimeWaitingForResolveCompletion ? traceWarning : traceVerbose;
        if (token.isCancellationRequested) {
            logger(`Inspected code ${codeForLogging} in ${stopWatch.elapsedTime}ms (but cancelled)`);
        } else {
            logger(`Inspected code ${codeForLogging} in ${stopWatch.elapsedTime}ms`);
        }
        return content;
    });
}

function createInspectRequestMessage(
    item: CompletionItem,
    document: TextDocument,
    position: Position
): KernelMessage.IInspectRequestMsg['content'] {
    const code = document.getText();
    const insertText =
        (typeof item.insertText === 'string' ? item.insertText : item.insertText?.value) ||
        (typeof item.label === 'string' ? item.label : item.label.label) ||
        '';
    const newCode = code.substring(0, position.character) + insertText;
    const cursor_pos = position.character + insertText.length;
    const contents: KernelMessage.IInspectRequestMsg['content'] = {
        code: newCode,
        cursor_pos,
        detail_level: 0
    };

    return contents;
}

const pendingInspectRequests = new WeakMap<Kernel.IKernelConnection, { count: number }>();

function doesKernelHaveTooManyPendingRequests(kernel: IKernel) {
    if (!kernel.session?.kernel) {
        return false;
    }
    return getPendingRequestCount(kernel) >= maxPendingKernelRequests;
}
function getPendingRequestCount(kernel: IKernel) {
    if (!kernel.session?.kernel) {
        return 0;
    }
    if (!pendingInspectRequests.has(kernel.session?.kernel)) {
        pendingInspectRequests.set(kernel.session?.kernel, { count: 0 });
    }
    return pendingInspectRequests.get(kernel.session?.kernel)?.count || 0;
}

function incrementPendingCounter(kernel: IKernel) {
    if (!kernel.session?.kernel) {
        return { dispose: noop };
    }
    const counter = pendingInspectRequests.get(kernel.session?.kernel) || { count: 0 };
    pendingInspectRequests.set(kernel.session?.kernel, counter);
    counter.count += 1;
    return {
        dispose: () => {
            counter.count -= 1;
        }
    };
}
