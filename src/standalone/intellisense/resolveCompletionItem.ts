// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken, CompletionItem, Disposable, Position, TextDocument } from 'vscode';
import { IKernel } from '../../kernels/types';
import { StopWatch } from '../../platform/common/utils/stopWatch';
import { Telemetry, TelemetryMeasures, TelemetryProperties, sendTelemetryEvent } from '../../telemetry';
import type { Kernel, KernelMessage } from '@jupyterlab/services';
import { raceTimeoutError } from '../../platform/common/utils/async';
import { raceCancellation } from '../../platform/common/cancellation';
import { DisposableStore, dispose } from '../../platform/common/utils/lifecycle';
import { stripAnsi } from '../../platform/common/utils/regexp';
import { traceInfo, traceVerbose, traceWarning } from '../../platform/logging';
import { getDisplayNameOrNameOfKernelConnection, getKernelConnectionLanguage } from '../../kernels/helpers';
import { Settings } from '../../platform/common/constants';
import { convertDocumentationToMarkdown } from './completionDocumentationFormatter';
import { once } from '../../platform/common/utils/events';
import { IDisposable } from '../../platform/common/types';
import { splitLines } from '../../platform/common/helpers';
import { translateKernelLanguageToMonaco } from '../../platform/common/utils';

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
    token: CancellationToken,
    kernel: IKernel,
    kernelId: string,
    monacoLanguage: string,
    document: TextDocument,
    position: Position,
    toDispose: DisposableStore
): Promise<CompletionItem> {
    if (!item.range || !kernel.session?.kernel) {
        // We always set a range in the completion item we send.
        // Except for Python.
        return item;
    }
    if (kernelIdsThatToNotSupportCompletionResolveOrAreTooSlowToReply.has(kernelId)) {
        return item;
    }

    const stopWatch = new StopWatch();
    const measures: TelemetryMeasures<Telemetry.KernelCodeCompletionResolve> = {
        duration: 0,
        pendingRequests: 0,
        requestDuration: 0
    };
    const properties: TelemetryProperties<Telemetry.KernelCodeCompletionResolve> = {
        kernelId: kernelId,
        kernelConnectionType: kernel.kernelConnectionMetadata.kind,
        kernelLanguage: getKernelConnectionLanguage(kernel.kernelConnectionMetadata),
        monacoLanguage: translateKernelLanguageToMonaco(
            getKernelConnectionLanguage(kernel.kernelConnectionMetadata) || ''
        ),
        cancelled: false,
        completed: false,
        completedWithData: false,
        kernelStatusBeforeRequest: kernel.status,
        requestSent: false
    };

    // We do not want to delay sending completion data because kernel is busy.
    // Also we do not want to make things worse, as kernel is already busy why slow it even further.
    if (kernel.status !== 'idle') {
        sendTelemetryEvent(Telemetry.KernelCodeCompletionResolve, measures, properties);
        return item;
    }
    properties.requestSent = true;
    const message = generateInspectRequestMessage(item, document, position);
    const request = sendInspectRequest(message, kernel.session.kernel, token, properties, measures, toDispose);

    try {
        const content = await raceTimeoutError(
            MAX_TIMEOUT_WAITING_FOR_RESOLVE_COMPLETION,
            new RequestTimedoutError(),
            raceCancellation(token, request)
        );

        properties.kernelStatusAfterRequest = kernel.status;
        properties.cancelled = token.isCancellationRequested;
        properties.completed = !token.isCancellationRequested;
        measures.duration = stopWatch.elapsedTime;

        if (!properties.cancelled && content?.status === 'ok' && content?.found) {
            const documentation = getDocumentation(content);
            item.documentation = convertDocumentationToMarkdown(documentation, monacoLanguage);
            properties.completedWithData = documentation.length > 0;
        }
    } catch (ex) {
        properties.requestTimedout = ex instanceof RequestTimedoutError;
        handleKernelRequestTimeout(kernel, monacoLanguage);
    }

    sendTelemetryEvent(Telemetry.KernelCodeCompletionResolve, measures, properties);
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
        sendTelemetryEvent(Telemetry.KernelCodeCompletionCannotResolve, undefined, {
            kernelId: kernelId,
            kernelConnectionType: kernel.kernelConnectionMetadata.kind,
            kernelLanguage: monacoLanguage
        });
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
    token: CancellationToken,
    properties: TelemetryProperties<Telemetry.KernelCodeCompletionResolve>,
    measures: TelemetryMeasures<Telemetry.KernelCodeCompletionResolve>,
    toDispose: DisposableStore
): Promise<KernelMessage.IInspectReplyMsg['content']> {
    measures.pendingRequests = getPendingRequestCount(kernel);
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
    const codeForLogging = splitLines(message.code).reverse()[0].trim();
    traceVerbose(`Inspecting code ${codeForLogging}`);
    const request = kernel.requestInspect(message).finally(() => {
        properties.completed = true;
        measures.requestDuration = stopWatch.elapsedTime;
        properties.kernelStatusAfterRequest = kernel.status;
        counter.dispose();
    });
    checkHowLongKernelTakesToReplyEvenAfterTimeoutOrCancellation(
        request,
        kernel,
        stopWatch,
        properties,
        measures,
        toDispose,
        codeForLogging
    );
    // No need to raceCancel with the token, thats expected in the calling code.
    return request.then(({ content }) => {
        traceVerbose(`Inspected code ${codeForLogging} in ${stopWatch.elapsedTime}ms`);
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
function checkHowLongKernelTakesToReplyEvenAfterTimeoutOrCancellation(
    request: Promise<unknown>,
    kernel: Kernel.IKernelConnection,
    stopWatch: StopWatch,
    properties: TelemetryProperties<Telemetry.KernelCodeCompletionResolve>,
    measures: TelemetryMeasures<Telemetry.KernelCodeCompletionResolve>,
    toDispose: DisposableStore,
    codeForLogging: string
) {
    // Do not wait too long
    // Some kernels do not support this request, this will give
    // an indication that they never work.
    const maxTime = MAX_TIMEOUT_WAITING_FOR_RESOLVE_COMPLETION * 10;
    const timeout = setTimeout(() => {
        properties.requestTimedout = true;
        measures.requestDuration = stopWatch.elapsedTime;
        sendTelemetryEvent(Telemetry.KernelCodeCompletionResolve, measures, properties);

        traceWarning(`Timeout (after ${maxTime}ms) waiting to inspect code '${codeForLogging}' in kernel ${kernel.id}`);
    }, maxTime);
    const timeoutDisposable = new Disposable(() => clearTimeout(timeout));
    toDispose.add(timeoutDisposable);

    void request.finally(() => {
        // We do not care if the request didn't time out or it was not cancelled.
        if (!properties.cancelled || !properties.requestTimedout) {
            return;
        }
        timeoutDisposable.dispose();
        properties.completed = true;
        measures.requestDuration = stopWatch.elapsedTime;
        // Wait for completion and send the total time taken
        // Its possible that user may have cancelled this operation,
        // but kernel is still busy processing this request.
        // With this data we will know that completions take too long and can slow the kernel down.
        sendTelemetryEvent(Telemetry.KernelCodeCompletionResolve, measures, properties);
    });
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
