// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { l10n, CancellationToken, Event, EventEmitter, ProgressLocation, extensions, window, Disposable } from 'vscode';
import { ExecutionResult, Kernel } from '../../api';
import { ServiceContainer } from '../../platform/ioc/container';
import { IKernel, IKernelProvider, INotebookKernelExecution } from '../types';
import { executeSilentlyAndEmitOutput, getDisplayNameOrNameOfKernelConnection } from '../helpers';
import { IDisposable } from '../../platform/common/types';
import { dispose } from '../../platform/common/utils/lifecycle';
import { noop } from '../../platform/common/utils/misc';
import { getTelemetrySafeHashedString } from '../../platform/telemetry/helpers';
import { Telemetry, sendTelemetryEvent } from '../../telemetry';
import { StopWatch } from '../../platform/common/utils/stopWatch';
import { Deferred, createDeferred, sleep } from '../../platform/common/utils/async';
import { once } from '../../platform/common/utils/events';
import { traceInfo, traceVerbose } from '../../platform/logging';

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
    constructor(
        private readonly extensionDisplayName: string,
        kernel: IKernel
    ) {
        this.controllerDisplayName = getDisplayNameOrNameOfKernelConnection(kernel.kernelConnectionMetadata);
        this.title = l10n.t(
            `Executing code against kernel '{0}' on behalf of the extension {1}`,
            this.controllerDisplayName,
            this.extensionDisplayName
        );
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

        this.showProgress().catch(noop);

        this.deferred = createDeferred<void>();
        return (this.disposable = new Disposable(() => this.deferred?.resolve()));
    }
    private async showProgress() {
        // Give a grace period of 500ms to avoid too many progress indicators.
        await sleep(500);
        if (!this.deferred || this.deferred.completed) {
            return;
        }
        await window.withProgress({ location: ProgressLocation.Notification, title: this.title }, async () => {
            let deferred = this.deferred;
            while (deferred && !deferred.completed) {
                await deferred.promise;
                deferred = this.deferred;
            }
        });
    }
}

class WrappedKernelPerExtension implements Kernel {
    get status(): 'unknown' | 'starting' | 'idle' | 'busy' | 'terminating' | 'restarting' | 'autorestarting' | 'dead' {
        sendApiTelemetry(this.extensionId, this.kernel, 'status', this.execution.executionCount).catch(noop);
        return this.kernel.status;
    }
    get onDidChangeStatus(): Event<
        'unknown' | 'starting' | 'idle' | 'busy' | 'terminating' | 'restarting' | 'autorestarting' | 'dead'
    > {
        sendApiTelemetry(this.extensionId, this.kernel, 'onDidChangeStatus', this.execution.executionCount).catch(noop);
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

    executeCode(code: string, token: CancellationToken): ExecutionResult {
        this.previousProgress?.dispose();
        let completed = false;
        const measures = {
            requestHandledAfter: 0,
            executionCount: this.execution.executionCount,
            interruptedAfter: 0,
            duration: 0
        };
        const properties = {
            requestHandled: false,
            extensionId: this.extensionId,
            kernelId: '',
            interruptedBeforeHandled: false,
            interrupted: false,
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
            if (this.status === 'dead' || this.status === 'terminating') {
                throw new Error('Kernel is dead or terminating');
            }
            throw new Error('Kernel connection not available to execute 3rd party code');
        }

        const disposables: IDisposable[] = [];
        const onDidEmitOutput = new EventEmitter<{ mime: string; data: Uint8Array }[]>();
        const progress = (this.previousProgress = this.progress.show());
        disposables.push(progress);
        disposables.push(onDidEmitOutput);
        disposables.push({
            dispose: () => {
                measures.duration = stopwatch.elapsedTime;
                properties.mimeTypes = Array.from(mimeTypes).join(',');
                completed = true;
                traceVerbose(`Kernel execution completed in ${measures.duration}ms, ${this.extensionDisplayName}.`);
            }
        });
        const request = executeSilentlyAndEmitOutput(this.kernel.session.kernel, code, (output) => {
            if (output.length) {
                properties.requestHandled = true;
                measures.requestHandledAfter = stopwatch.elapsedTime;
                output.forEach((item) => mimeTypes.add(item.mime));
                onDidEmitOutput.fire(output);
            }
        });
        const oldIOPub = request.onIOPub;
        request.onIOPub = (msg) => {
            properties.requestHandled = true;
            measures.requestHandledAfter = stopwatch.elapsedTime;
            return oldIOPub(msg);
        };
        request.onReply = () => {
            properties.requestHandled = true;
            measures.requestHandledAfter = stopwatch.elapsedTime;
        };
        token.onCancellationRequested(
            () => {
                if (completed) {
                    return;
                }
                properties.interrupted = true;
                measures.interruptedAfter = stopwatch.elapsedTime;
                properties.interruptedBeforeHandled = !properties.requestHandled;
                if (properties.requestHandled) {
                    traceInfo(`Kernel Interrupted by extension ${this.extensionDisplayName}`);
                    this.kernel.interrupt().catch(() => request.dispose());
                } else {
                    request.dispose();
                }
            },
            this,
            disposables
        );
        request.done.finally(() => dispose(disposables)).catch(noop);
        return {
            done: new Promise((resolve, reject) => request.done.then(() => resolve(), reject)),
            onDidEmitOutput: onDidEmitOutput.event
        };
    }
}

async function sendApiTelemetry(extensionId: string, kernel: IKernel, pemUsed: keyof Kernel, executionCount: number) {
    const kernelId = await getTelemetrySafeHashedString(kernel.id);
    sendTelemetryEvent(Telemetry.NewJupyterKernelApiUsage, { executionCount }, { kernelId, pemUsed, extensionId });
}
async function sendApiExecTelemetry(
    kernel: IKernel,
    measures: {
        requestHandledAfter: number;
        executionCount: number;
        interruptedAfter: number;
        duration: number;
    },
    properties: {
        requestHandled: boolean;
        extensionId: string;
        kernelId: string;
        interruptedBeforeHandled: boolean;
        interrupted: boolean;
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
