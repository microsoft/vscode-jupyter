// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken, Event, EventEmitter, Uri } from 'vscode';
import { ExecutionResult, Kernel, Kernels } from '../../api';
import { ServiceContainer } from '../../platform/ioc/container';
import { IKernel, IKernelProvider, INotebookKernelExecution, isRemoteConnection } from '../types';
import { executeSilentlyAndEmitOutput } from '../helpers';
import { IDisposable } from '../../platform/common/types';
import { dispose } from '../../platform/common/utils/lifecycle';
import { noop } from '../../platform/common/utils/misc';
import { IVSCodeNotebook } from '../../platform/common/application/types';
import { getTelemetrySafeHashedString } from '../../platform/telemetry/helpers';
import { Telemetry, sendTelemetryEvent } from '../../telemetry';
import { StopWatch } from '../../platform/common/utils/stopWatch';

// Each extension gets its own instance of the API.
const apiCache = new Map<string, Kernels>();
const kernelCache = new WeakMap<IKernel, Kernel>();

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

    constructor(
        private readonly extensionId: string,
        private readonly kernel: IKernel,
        private readonly execution: INotebookKernelExecution
    ) {}

    executeCode(code: string, token: CancellationToken): ExecutionResult {
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
        disposables.push(onDidEmitOutput);
        disposables.push({
            dispose: () => {
                measures.duration = stopwatch.elapsedTime;
                properties.mimeTypes = Array.from(mimeTypes).join(',');
                completed = true;
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

export function getKernelsApi(extensionId: string): Kernels {
    // Each extension gets its own instance of the API.
    let api = apiCache.get(extensionId);
    if (!api) {
        api = {
            findKernel(query: { uri: Uri }) {
                const kernelProvider = ServiceContainer.instance.get<IKernelProvider>(IKernelProvider);
                const notebooks = ServiceContainer.instance.get<IVSCodeNotebook>(IVSCodeNotebook);
                const notebook = notebooks.notebookDocuments.find(
                    (item) => item.uri.toString() === query.uri.toString()
                );
                const kernel = kernelProvider.get(notebook || query.uri);
                // We are only interested in returning kernels that have been started by the user.
                if (!kernel || !kernel.startedAtLeastOnce) {
                    return;
                }
                const execution = kernelProvider.getKernelExecution(kernel);
                if (!isRemoteConnection(kernel.kernelConnectionMetadata) && execution.executionCount === 0) {
                    // For local kernels, execution count must be greater than 0,
                    // As we pre-warms kernels (i.e. we start kernels even though the user may not have executed any code).
                    // The only way to determine whether users executed code is to look at the execution count
                    return;
                }
                let wrappedKernel =
                    kernelCache.get(kernel) || new WrappedKernelPerExtension(extensionId, kernel, execution);
                kernelCache.set(kernel, wrappedKernel);
                return wrappedKernel;
            }
        };
        apiCache.set(extensionId, api);
    }
    return api;
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
