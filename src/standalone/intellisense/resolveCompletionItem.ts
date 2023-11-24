// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken, CompletionItem, Disposable, Position, TextDocument } from 'vscode';
import { IKernel } from '../../kernels/types';
import { StopWatch } from '../../platform/common/utils/stopWatch';
import { Telemetry, TelemetryMeasures, TelemetryProperties, sendTelemetryEvent } from '../../telemetry';
import type { Kernel, KernelMessage } from '@jupyterlab/services';
import { raceTimeoutError } from '../../platform/common/utils/async';
import { raceCancellation } from '../../platform/common/cancellation';
import { DisposableStore } from '../../platform/common/utils/lifecycle';
import { stripAnsi } from '../../platform/common/utils/regexp';
import { traceWarning } from '../../platform/logging';
import { getDisplayNameOrNameOfKernelConnection } from '../../kernels/helpers';
import { Settings } from '../../platform/common/constants';

// Not all kernels support requestInspect method.
// E.g. deno does not support this, hence waiting for this to complete is poinless.
// As that results in a `loading...` method to appear against the completion item.
// If we have n consecutive attempts where the response never comes back in 1s,
// then we'll always ignore `requestInspect` method for this kernel.
export const MAX_ATTEMPTS_BEFORE_IGNORING_RESOLVE_COMPLETION = 5;
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
        requestDuration: 0
    };
    const properties: TelemetryProperties<Telemetry.KernelCodeCompletionResolve> = {
        kernelId: kernelId,
        kernelConnectionType: kernel.kernelConnectionMetadata.kind,
        kernelLanguage: monacoLanguage,
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
    const request = sendInspectRequest(item, document, position, kernel.session.kernel);

    try {
        const msg = await raceTimeoutError(
            MAX_TIMEOUT_WAITING_FOR_RESOLVE_COMPLETION,
            new RequestTimedoutError(),
            raceCancellation(token, request)
        );

        properties.kernelStatusAfterRequest = kernel.status;
        properties.cancelled = token.isCancellationRequested;
        properties.completed = !token.isCancellationRequested;
        measures.duration = stopWatch.elapsedTime;
        measures.requestDuration = properties.completed ? stopWatch.elapsedTime : 0;

        if (!properties.cancelled && msg?.content?.status === 'ok' && msg?.content?.found) {
            const documentation = stripAnsi(msg.content.data['text/plain'] as string);
            item.documentation = documentation;
            properties.completedWithData = documentation.length > 0;
        }
    } catch (ex) {
        properties.requestTimedout = ex instanceof RequestTimedoutError;
        handleKernelRequestTimeout(kernel, monacoLanguage);
    }
    if (properties.cancelled || properties.requestTimedout) {
        checkHowLongKernelTakesToReplyEvenAfterTimeoutOrCancellation(
            request,
            stopWatch,
            properties,
            measures,
            toDispose
        );
    }

    sendTelemetryEvent(Telemetry.KernelCodeCompletionResolve, measures, properties);
    return item;
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
            `Failed to resolve completion items for kernel ${getDisplayNameOrNameOfKernelConnection(
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

function sendInspectRequest(
    item: CompletionItem,
    document: TextDocument,
    position: Position,
    kernel: Kernel.IKernelConnection
): Promise<KernelMessage.IInspectReplyMsg> {
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

    return kernel.requestInspect(contents);
}
function checkHowLongKernelTakesToReplyEvenAfterTimeoutOrCancellation(
    request: Promise<unknown>,
    stopWatch: StopWatch,
    telemetryInfo: TelemetryProperties<Telemetry.KernelCodeCompletionResolve>,
    measures: TelemetryMeasures<Telemetry.KernelCodeCompletionResolve>,
    toDispose: DisposableStore
) {
    // Do not wait too long
    // Some kernels do not support this request, this will give
    // an indication that they never work.
    const timeout = setTimeout(() => {
        telemetryInfo.requestTimedout = true;
        measures.requestDuration = stopWatch.elapsedTime;
        sendTelemetryEvent(Telemetry.KernelCodeCompletionResolve, measures, telemetryInfo);
    }, MAX_TIMEOUT_WAITING_FOR_RESOLVE_COMPLETION * 10);
    const timeoutDisposable = new Disposable(() => clearTimeout(timeout));
    toDispose.add(new Disposable(() => clearTimeout(timeout)));

    void request.finally(() => {
        timeoutDisposable.dispose();
        measures.requestDuration = stopWatch.elapsedTime;
        // Wait for completion and send the total time taken
        // Its possible that user may have cancelled this operation,
        // but kernel is still busy processing this request.
        // With this data we will know that completions take too long and can slow the kernel down.
        sendTelemetryEvent(Telemetry.KernelCodeCompletionResolve, measures, telemetryInfo);
    });
}
