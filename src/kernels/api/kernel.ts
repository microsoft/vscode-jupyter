// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { l10n, CancellationToken, ProgressLocation, extensions, window, Disposable, Event } from 'vscode';
import { Kernel, OutputItem } from '../../api';
import { ServiceContainer } from '../../platform/ioc/container';
import { IKernel, IKernelProvider, INotebookKernelExecution } from '../types';
import { getDisplayNameOrNameOfKernelConnection } from '../helpers';
import { IDisposable } from '../../platform/common/types';
import { dispose } from '../../platform/common/utils/lifecycle';
import { noop } from '../../platform/common/utils/misc';
import { getTelemetrySafeHashedString } from '../../platform/telemetry/helpers';
import { Telemetry, sendTelemetryEvent } from '../../telemetry';
import { StopWatch } from '../../platform/common/utils/stopWatch';
import { Deferred, createDeferred, sleep } from '../../platform/common/utils/async';
import { once } from '../../platform/common/utils/events';
import { traceError, traceInfo } from '../../platform/logging';

function getExtensionDisplayName(extensionId: string) {
    const extensionDisplayName = extensions.getExtension(extensionId)?.packageJSON.displayName;
    return extensionDisplayName ? `${extensionDisplayName} (${extensionId})` : extensionId;
}
/**
 * Displays a progress indicator when 3rd party extensions execute code against a kernel.
 * We need this to notify users when execution takes place for:
 * 1. Transparency
 * 2. If users experience delays in kernel execution within notebooks, then they have an idea why this might be the case.
 */
class KernelExecutionProgressIndicator {
    private readonly controllerDisplayName: string;
    private deferred?: Deferred<void>;
    private disposable?: IDisposable;
    private readonly title: string;
    private displayInProgress?: boolean;
    constructor(
        private readonly extensionDisplayName: string,
        kernel: IKernel
    ) {
        this.controllerDisplayName = getDisplayNameOrNameOfKernelConnection(kernel.kernelConnectionMetadata);
        this.title = l10n.t(`Executing code in {0} from {1}`, this.controllerDisplayName, this.extensionDisplayName);
    }
    dispose() {
        this.disposable?.dispose();
    }

    show() {
        if (this.deferred && !this.deferred.completed) {
            const oldDeferred = this.deferred;
            this.deferred = createDeferred<void>();
            oldDeferred.resolve();
            return (this.disposable = new Disposable(() => this.deferred?.resolve()));
        }

        this.deferred = createDeferred<void>();
        this.showProgress().catch(noop);
        return (this.disposable = new Disposable(() => this.deferred?.resolve()));
    }
    private async showProgress() {
        // Give a grace period of 500ms to avoid too many progress indicators.
        await sleep(500);
        if (!this.deferred || this.deferred.completed || this.displayInProgress) {
            return;
        }
        this.displayInProgress = true;
        await window.withProgress({ location: ProgressLocation.Notification, title: this.title }, async () => {
            let deferred = this.deferred;
            while (deferred && !deferred.completed) {
                await deferred.promise;
                deferred = this.deferred;
            }
        });
        this.displayInProgress = false;
    }
}

/**
 * Design guidelines for separate kernel per extension.
 * Asseume extrension A & B use the same kernel and use this API.
 * Both can send code and so can the user via a notebook/iw.
 * Assume user executes code via notebook/iw and that is busy.
 * 1. Extension A executes code `1` agaist kernel,
 * 2. Laster extension A excecutes another block of code `2` against the kernel.
 * When executing code `2`, extension A would like to cancel the first request `1`.
 * However the kernel is busy running user code, extension A should not be aware of this knowledge.
 * We should keep track of this, and prevent Extension A from interrupting user code.
 * Once user code is done, then `1` will get picked up by the kernel and when we get an ack back from kernel
 * then we can interrupt the kernel.
 * Similarly, while `2` is busy executing, if Extension B comes in, they have to wait till `2` is done.
 * They have no way of knowing that `2` is busy executing via Extension A (or whether its user code).
 *
 * Basically Extensions should never be allowed to interrupt user code or other extensions code.
 * The Jupyter extension is the only one that can police this.
 *
 * Unfortunately what this means is we need a queue of requests, and the queue should apply to all extensions.
 * This way, when A cancels all requests and it was never sent to the kernel, all we need to do is
 * ensure those requests never get sent to the kernel.
 * While the requests from Extension B that are still in the queue can still get processed even after A cancels all of its requests.
 */
class WrappedKernelPerExtension implements Kernel {
    get status(): 'unknown' | 'starting' | 'idle' | 'busy' | 'terminating' | 'restarting' | 'autorestarting' | 'dead' {
        // sendApiTelemetry(this.extensionId, this.kernel, 'status', this.execution.executionCount).catch(noop);
        return this.kernel.status;
    }
    get onDidChangeStatus(): Event<
        'unknown' | 'starting' | 'idle' | 'busy' | 'terminating' | 'restarting' | 'autorestarting' | 'dead'
    > {
        // sendApiTelemetry(this.extensionId, this.kernel, 'onDidChangeStatus', this.execution.executionCount).catch(noop);
        return this.kernel.onStatusChanged;
    }

    private readonly extensionDisplayName: string;
    private readonly progress: KernelExecutionProgressIndicator;
    private previousProgress?: IDisposable;
    constructor(
        private readonly extensionId: string,
        private readonly kernel: IKernel,
        private readonly execution: INotebookKernelExecution
    ) {
        this.extensionDisplayName = getExtensionDisplayName(extensionId);
        this.progress = new KernelExecutionProgressIndicator(this.extensionDisplayName, kernel);
        once(kernel.onDisposed)(() => this.progress.dispose());
    }

    async *executeCode(code: string, token: CancellationToken): AsyncGenerator<OutputItem[], void, unknown> {
        this.previousProgress?.dispose();
        let completed = false;
        const measures = {
            executionCount: this.execution.executionCount,
            requestSentAfter: 0,
            requestAcknowledgedAfter: 0,
            cancelledAfter: 0,
            duration: 0
        };
        const properties = {
            kernelId: '',
            extensionId: this.extensionId,
            cancelled: false,
            requestSent: false,
            requestAcknowledged: false,
            cancelledBeforeRequestSent: false,
            cancelledBeforeRequestAcknowledged: false,
            mimeTypes: '',
            failed: false
        };
        const stopwatch = new StopWatch();
        const mimeTypes = new Set<string>();
        sendApiTelemetry(this.extensionId, this.kernel, 'executeCode', measures.executionCount).catch(noop);

        if (this.kernel.disposed) {
            properties.failed = true;
            sendApiExecTelemetry(this.kernel, measures, properties).catch(noop);
            throw new Error('Kernel is disposed');
        }
        if (!this.kernel.session?.kernel) {
            properties.failed = true;
            sendApiExecTelemetry(this.kernel, measures, properties).catch(noop);
            if (this.kernel.status === 'dead' || this.kernel.status === 'terminating') {
                throw new Error('Kernel is dead or terminating');
            }
            throw new Error('Kernel connection not available to execute 3rd party code');
        }

        const disposables: IDisposable[] = [];
        const done = createDeferred<void>();
        disposables.push({
            dispose: () => {
                measures.duration = stopwatch.elapsedTime;
                properties.mimeTypes = Array.from(mimeTypes).join(',');
                completed = true;
                done.resolve();
                sendApiExecTelemetry(this.kernel, measures, properties).catch(noop);
            }
        });
        const kernelExecution = ServiceContainer.instance
            .get<IKernelProvider>(IKernelProvider)
            .getKernelExecution(this.kernel);
        const outputs: OutputItem[][] = [];
        let outputsReceieved = createDeferred<void>();
        kernelExecution
            .executeCode(code, this.extensionId, token)
            .then((codeExecution) => {
                codeExecution.result.finally(() => dispose(disposables)).catch(noop);
                codeExecution.onRequestSent(
                    () => {
                        properties.requestSent = true;
                        measures.requestSentAfter = stopwatch.elapsedTime;
                        if (!token.isCancellationRequested) {
                            const progress = (this.previousProgress = this.progress.show());
                            disposables.push(progress);
                        }
                    },
                    this,
                    disposables
                );
                codeExecution.onRequestAcknowledged(
                    () => {
                        properties.requestAcknowledged = true;
                        measures.requestAcknowledgedAfter = stopwatch.elapsedTime;
                    },
                    this,
                    disposables
                );
                codeExecution.onDidEmitOutput(
                    (e) => {
                        e.forEach((item) => mimeTypes.add(item.mime));
                        outputs.push(e);
                    },
                    this,
                    disposables
                );
            })
            .catch((ex) => {
                traceError(
                    `Extension ${this.extensionId} failed to execute code in kernel ${this.extensionDisplayName}`,
                    ex
                );
            });
        token.onCancellationRequested(
            () => {
                if (completed) {
                    return;
                }
                properties.cancelled = true;
                measures.cancelledAfter = stopwatch.elapsedTime;
                properties.cancelledBeforeRequestSent = !properties.requestSent;
                properties.cancelledBeforeRequestAcknowledged = !properties.requestAcknowledged;
                traceInfo(`Code execution cancelled by extension ${this.extensionDisplayName}`);
            },
            this,
            disposables
        );
        while (true) {
            await Promise.race([outputsReceieved.promise, done.promise]);
            if (outputsReceieved.completed) {
                outputsReceieved = createDeferred<void>();
            }
            while (outputs.length) {
                yield outputs.shift()!;
            }
            if (done.completed) {
                break;
            }
        }
    }
}

async function sendApiTelemetry(extensionId: string, kernel: IKernel, pemUsed: keyof Kernel, executionCount: number) {
    const kernelId = await getTelemetrySafeHashedString(kernel.id);
    sendTelemetryEvent(Telemetry.NewJupyterKernelApiUsage, { executionCount }, { kernelId, pemUsed, extensionId });
}
async function sendApiExecTelemetry(
    kernel: IKernel,
    measures: {
        executionCount: number;
        requestSentAfter: number;
        requestAcknowledgedAfter: number;
        cancelledAfter: number;
        duration: number;
    },
    properties: {
        kernelId: string;
        extensionId: string;
        requestSent: boolean;
        cancelled: boolean;
        requestAcknowledged: boolean;
        cancelledBeforeRequestSent: boolean;
        cancelledBeforeRequestAcknowledged: boolean;
        mimeTypes: string;
        failed: boolean;
    }
) {
    properties.kernelId = await getTelemetrySafeHashedString(kernel.id);
    sendTelemetryEvent(Telemetry.NewJupyterKernelApiExecution, measures, properties);
}

export function createKernelApiForExetnsion(extensionId: string, kernel: IKernel) {
    const kernelProvider = ServiceContainer.instance.get<IKernelProvider>(IKernelProvider);
    return new WrappedKernelPerExtension(extensionId, kernel, kernelProvider.getKernelExecution(kernel));
}
