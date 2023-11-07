// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken, Event, EventEmitter, Uri, workspace } from 'vscode';
import { ExecutionResult, Kernel, Kernels } from '../../api';
import { ServiceContainer } from '../../platform/ioc/container';
import { IKernel, IKernelProvider } from '../types';
import { executeSilentlyAndEmitOutput } from '../helpers';
import { IDisposable } from '../../platform/common/types';
import { dispose } from '../../platform/common/utils/lifecycle';
import { noop } from '../../platform/common/utils/misc';

const kernelCache = new WeakMap<IKernel, Kernel>();

class WrappedKernel implements Kernel {
    get status(): 'unknown' | 'starting' | 'idle' | 'busy' | 'terminating' | 'restarting' | 'autorestarting' | 'dead' {
        return this.kernel.status;
    }
    get onDidChangeStatus(): Event<
        'unknown' | 'starting' | 'idle' | 'busy' | 'terminating' | 'restarting' | 'autorestarting' | 'dead'
    > {
        return this.kernel.onStatusChanged;
    }

    constructor(private readonly kernel: IKernel) {}

    executeCode(code: string, token: CancellationToken): ExecutionResult {
        if (this.kernel.disposed) {
            throw new Error('Kernel is disposed');
        }
        if (!this.kernel.session?.kernel) {
            if (this.status === 'dead' || this.status === 'terminating') {
                throw new Error('Kernel is dead or terminating');
            }
            throw new Error('Kernel connection not available to execute 3rd party code');
        }
        const onDidEmitOutput = new EventEmitter<{ mime: string; data: Uint8Array }[]>();
        const disposables: IDisposable[] = [];
        let requestHandled = false;
        let completed = false;
        disposables.push({
            dispose: () => {
                completed = true;
            }
        });
        const request = executeSilentlyAndEmitOutput(this.kernel.session.kernel, code, (output) => {
            if (output.length) {
                requestHandled = true;
                onDidEmitOutput.fire(output);
            }
        });
        request.onIOPub = () => {
            requestHandled = true;
        };
        request.onReply = () => {
            requestHandled = true;
        };
        token.onCancellationRequested(
            () => {
                if (!completed && requestHandled) {
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

export function getKernelsApi(): Kernels {
    const kernelProvider = ServiceContainer.instance.get<IKernelProvider>(IKernelProvider);
    return {
        findKernel(query: { uri: Uri }) {
            const notebook = workspace.notebookDocuments.find((item) => item.uri.toString() === query.uri.toString());
            const kernel = kernelProvider.get(notebook || query.uri);
            if (!kernel) {
                return;
            }
            let wrappedKernel = kernelCache.get(kernel) || new WrappedKernel(kernel);
            kernelCache.set(kernel, wrappedKernel);
            return wrappedKernel;
        }
    };
}
