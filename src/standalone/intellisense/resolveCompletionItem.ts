// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken, CompletionItem, Position, TextDocument } from 'vscode';
import { IKernel } from '../../kernels/types';
import { StopWatch } from '../../platform/common/utils/stopWatch';
import { Telemetry, sendTelemetryEvent } from '../../telemetry';
import type { Kernel, KernelMessage } from '@jupyterlab/services';
import { raceTimeoutError } from '../../platform/common/utils/async';
import { raceCancellation } from '../../platform/common/cancellation';
import { dispose } from '../../platform/common/utils/lifecycle';
import { stripAnsi } from '../../platform/common/utils/regexp';
import { traceInfo, traceVerbose, traceWarning } from '../../platform/logging';
import { getDisplayNameOrNameOfKernelConnection } from '../../kernels/helpers';
import { Settings } from '../../platform/common/constants';
import { convertDocumentationToMarkdown } from './completionDocumentationFormatter';
import { once } from '../../platform/common/utils/events';
import { IDisposable } from '../../platform/common/types';
import { splitLines } from '../../platform/common/helpers';

// Not all kernels support requestInspect method.
// E.g. deno does not support this, hence waiting for this to complete is poinless.
// As that results in a `loading...` method to appear against the completion item.
// If we have n consecutive attempts where the response never comes back in 1s,
// then we'll always ignore `requestInspect` method for this kernel.
export const MAX_ATTEMPTS_BEFORE_IGNORING_RESOLVE_COMPLETION = 5;
/**
 * Based on my (Don) findings with a local Python Kernel, the max number of pending requests I had was just 1.
 * Hence its fair to assume that having 3 is unlikely and not a scenario we want to run into.
 * I.e. 3 requests waiting for a response from the kernel is bad.
 */
export const MAX_PENDING_REQUESTS = 3;
const MAX_TIMEOUT_WAITING_FOR_RESOLVE_COMPLETION = Settings.IntellisenseTimeout;

const kernelIdsThatToNotSupportCompletionResolveOrAreTooSlowToReply = new Set<string>();
const totalNumberOfTimeoutsWaitingForResolveCompletionPerKernel = new Map<string, number>();

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
    if (kernelIdsThatToNotSupportCompletionResolveOrAreTooSlowToReply.has(kernelId)) {
        return item;
    }

    // We do not want to delay sending completion data because kernel is busy.
    // Also we do not want to make things worse, as kernel is already busy why slow it even further.
    if (kernel.status !== 'idle') {
        return item;
    }
    const message = generateInspectRequestMessage(originalCompletionItem || item, document, position);
    const request = sendInspectRequest(message, kernel.session.kernel, token);

    try {
        const content = await raceTimeoutError(
            MAX_TIMEOUT_WAITING_FOR_RESOLVE_COMPLETION,
            new RequestTimedoutError(),
            raceCancellation(token, request)
        );

        if (!token.isCancellationRequested && content?.status === 'ok' && content?.found) {
            const documentation = getDocumentation(content);
            item.documentation = convertDocumentationToMarkdown(documentation, monacoLanguage);
        }
    } catch (ex) {
        handleKernelRequestTimeout(kernel, monacoLanguage);
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

const telemetrySentForUnableToResolveCompletion = new Set<string>();
function handleKernelRequestTimeout(kernel: IKernel, monacoLanguage: string) {
    const kernelId = kernel.kernelConnectionMetadata.id;
    if (kernelIdsThatToNotSupportCompletionResolveOrAreTooSlowToReply.has(kernelId)) {
        return;
    }
    let numberOfFailedAttempts = totalNumberOfTimeoutsWaitingForResolveCompletionPerKernel.get(kernelId) || 0;
    numberOfFailedAttempts += 1;
    totalNumberOfTimeoutsWaitingForResolveCompletionPerKernel.set(kernelId, numberOfFailedAttempts);
    if (numberOfFailedAttempts >= MAX_ATTEMPTS_BEFORE_IGNORING_RESOLVE_COMPLETION) {
        traceWarning(
            `Failed to inspect code in kernel ${getDisplayNameOrNameOfKernelConnection(
                kernel.kernelConnectionMetadata
            )} ${numberOfFailedAttempts} times.}`
        );
        if (!telemetrySentForUnableToResolveCompletion.has(kernelId)) {
            telemetrySentForUnableToResolveCompletion.add(kernelId);
            sendTelemetryEvent(Telemetry.KernelCodeCompletionCannotResolve, undefined, {
                kernelId: kernelId,
                kernelConnectionType: kernel.kernelConnectionMetadata.kind,
                kernelLanguage: monacoLanguage
            });
        }
        kernelIdsThatToNotSupportCompletionResolveOrAreTooSlowToReply.add(kernelId);
        return;
    }
}

/**
 * We do not want to flood the kernel with too many pending requests.
 * Thats bad, as that can slow the kernel down.
 * Instead we will wait until there are only a max of 5 pending requests.
 */
async function sendInspectRequest(
    message: Parameters<Kernel.IKernelConnection['requestInspect']>[0],
    kernel: Kernel.IKernelConnection,
    token: CancellationToken
): Promise<KernelMessage.IInspectReplyMsg['content']> {
    if (doesKernelHaveTooManyPendingRequests(kernel)) {
        traceInfo(
            `Too many pending requests ${getPendingRequestCount(kernel)} for kernel ${
                kernel.id
            }, waiting for it to be ready.`
        );
        await raceCancellation(token, waitForKernelToBeReadyToHandleRequest(kernel, token));
    }
    if (token.isCancellationRequested) {
        return Promise.resolve({ data: {}, found: false, status: 'ok', metadata: {} });
    }
    const counter = incrementPendingCounter(kernel);
    const stopWatch = new StopWatch();
    // Get last 50 characters for logging
    const codeForLogging = splitLines(message.code).reverse()[0].slice(-50);
    traceVerbose(`Inspecting code ${codeForLogging}`);
    const request = kernel.requestInspect(message).finally(() => counter.dispose());
    // No need to raceCancel with the token, thats expected in the calling code.
    return request.then(({ content }) => {
        if (token.isCancellationRequested) {
            traceVerbose(`Inspected code ${codeForLogging} in ${stopWatch.elapsedTime}ms (but cancelled)`);
        } else {
            traceVerbose(`Inspected code ${codeForLogging} in ${stopWatch.elapsedTime}ms`);
        }
        return content;
    });
}

function generateInspectRequestMessage(
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

export const pendingInspectRequests = new WeakMap<Kernel.IKernelConnection, { count: number }>();

function doesKernelHaveTooManyPendingRequests(kernel: Kernel.IKernelConnection) {
    if (!pendingInspectRequests.has(kernel)) {
        pendingInspectRequests.set(kernel, { count: 0 });
    }
    return (pendingInspectRequests.get(kernel)?.count || 0) >= MAX_PENDING_REQUESTS;
}
function getPendingRequestCount(kernel: Kernel.IKernelConnection) {
    if (!pendingInspectRequests.has(kernel)) {
        pendingInspectRequests.set(kernel, { count: 0 });
    }
    return pendingInspectRequests.get(kernel)?.count || 0;
}

function incrementPendingCounter(kernel: Kernel.IKernelConnection) {
    const counter = pendingInspectRequests.get(kernel) || { count: 0 };
    pendingInspectRequests.set(kernel, counter);
    counter.count += 1;
    return {
        dispose: () => {
            counter.count -= 1;
        }
    };
}

async function waitForKernelToBeReadyToHandleRequest(
    kernel: Kernel.IKernelConnection,
    token: CancellationToken
): Promise<void> {
    const disposables: IDisposable[] = [];
    await raceCancellation(
        token,
        new Promise<void>((resolve) => {
            const statusChangeHandler = () => {
                if (!doesKernelHaveTooManyPendingRequests(kernel)) {
                    resolve();
                    dispose(disposables);
                }
            };
            const interval = setInterval(() => {
                if (!doesKernelHaveTooManyPendingRequests(kernel)) {
                    resolve();
                    dispose(disposables);
                }
            }, 50);
            once(token.onCancellationRequested)(
                () => {
                    resolve();
                    kernel.statusChanged.disconnect(statusChangeHandler);
                },
                undefined,
                disposables
            );
            kernel.statusChanged.connect(statusChangeHandler);
            disposables.push({
                dispose: () => {
                    clearInterval(interval);
                    kernel.statusChanged.disconnect(statusChangeHandler);
                }
            });
        })
    );
}
