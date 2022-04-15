// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';
import type { KernelMessage } from '@jupyterlab/services';
import { Event, EventEmitter, NotebookDocument, Uri, workspace } from 'vscode';
import { IVSCodeNotebook } from '../platform/common/application/types';
import { traceInfoIfCI, traceVerbose, traceWarning } from '../platform/logging';
import { getDisplayPath } from '../platform/common/platform/fs-paths';
import { IAsyncDisposable, IAsyncDisposableRegistry, IDisposableRegistry } from '../platform/common/types';
import { noop } from '../platform/common/utils/misc';
import { IKernel, IKernelProvider, KernelOptions } from './types';

export abstract class BaseKernelProvider implements IKernelProvider {
    /**
     * Use a separate dictionary to track kernels by Notebook, so that
     * the ref to kernel is lost when the notebook is closed.
     */
    protected readonly kernelsByNotebook = new WeakMap<NotebookDocument, { options: KernelOptions; kernel: IKernel }>();
    /**
     * The life time of kernels not tied to a notebook will be managed by callers of the API.
     * Where as if a kernel is tied to a notebook, then the kernel dies along with notebooks.
     */
    protected readonly kernelsByUri = new Map<string, { options: KernelOptions; kernel: IKernel }>();
    private readonly pendingDisposables = new Set<IAsyncDisposable>();
    protected readonly _onDidRestartKernel = new EventEmitter<IKernel>();
    protected readonly _onDidStartKernel = new EventEmitter<IKernel>();
    protected readonly _onDidDisposeKernel = new EventEmitter<IKernel>();
    protected readonly _onKernelStatusChanged = new EventEmitter<{ status: KernelMessage.Status; kernel: IKernel }>();
    public readonly onKernelStatusChanged = this._onKernelStatusChanged.event;
    public get kernels() {
        const kernels = new Set<IKernel>();
        this.notebook.notebookDocuments.forEach((item) => {
            const kernel = this.get(item.uri);
            if (kernel) {
                kernels.add(kernel);
            }
        });
        Array.from(this.kernelsByUri.values()).forEach((item) => kernels.add(item.kernel));
        return Array.from(kernels);
    }
    constructor(
        protected asyncDisposables: IAsyncDisposableRegistry,
        protected disposables: IDisposableRegistry,
        private readonly notebook: IVSCodeNotebook
    ) {
        this.asyncDisposables.push(this);
        this.notebook.onDidCloseNotebookDocument((e) => this.disposeOldKernel(e.uri), this, disposables);
    }

    public get onDidDisposeKernel(): Event<IKernel> {
        return this._onDidDisposeKernel.event;
    }

    public get onDidRestartKernel(): Event<IKernel> {
        return this._onDidRestartKernel.event;
    }

    public get onDidStartKernel(): Event<IKernel> {
        return this._onDidStartKernel.event;
    }

    public get(uri: Uri): IKernel | undefined {
        return this.getInternal(uri)?.kernel;
    }
    public async dispose() {
        traceInfoIfCI(`Disposing all kernels from kernel provider`);
        const items = Array.from(this.pendingDisposables.values());
        this.pendingDisposables.clear();
        await Promise.all(items);
        await Promise.all(this.kernels.map((k) => k.dispose()));
        this._onDidDisposeKernel.dispose();
        this._onDidRestartKernel.dispose();
        this._onKernelStatusChanged.dispose();
    }
    public abstract getOrCreate(uri: Uri, options: KernelOptions): IKernel;
    public getInternal(uri: Uri):
        | {
              options: KernelOptions;
              kernel: IKernel;
          }
        | undefined {
        const notebook = workspace.notebookDocuments.find((nb) => nb.uri.toString() === uri.toString());
        if (!notebook) {
            return this.kernelsByUri.get(uri.toString());
        }
        return notebook ? this.kernelsByNotebook.get(notebook) : undefined;
    }
    /**
     * If a kernel has been disposed, then remove the mapping of Uri + Kernel.
     */
    protected deleteMappingIfKernelIsDisposed(uri: Uri, kernel: IKernel) {
        kernel.onDisposed(
            () => {
                // If the same kernel is associated with this document & it was disposed, then delete it.
                if (this.getInternal(uri)?.kernel === kernel) {
                    const notebook = workspace.notebookDocuments.find((nb) => nb.uri.toString() === uri.toString());
                    if (notebook) {
                        this.kernelsByNotebook.delete(notebook);
                    }
                    this.kernelsByUri.delete(uri.toString());
                    traceVerbose(
                        `Kernel got disposed, hence there is no longer a kernel associated with ${getDisplayPath(uri)}`
                    );
                }
                this.pendingDisposables.delete(kernel);
            },
            this,
            this.disposables
        );
    }
    protected disposeOldKernel(uri: Uri) {
        const notebook = workspace.notebookDocuments.find((nb) => nb.uri.toString() === uri.toString());
        if (notebook) {
            traceInfoIfCI(
                `Disposing kernel associated with ${getDisplayPath(notebook.uri)}, isClosed=${notebook.isClosed}`
            );

            const kernelToDispose = this.kernelsByNotebook.get(notebook);
            if (kernelToDispose) {
                this.pendingDisposables.add(kernelToDispose.kernel);
                kernelToDispose.kernel
                    .dispose()
                    .catch((ex) => traceWarning('Failed to dispose old kernel', ex))
                    .finally(() => this.pendingDisposables.delete(kernelToDispose.kernel))
                    .catch(noop);
            }
            this.kernelsByNotebook.delete(notebook);
        } else {
            traceInfoIfCI(`Disposing kernel associated with ${getDisplayPath(uri)}`);
            const kernelToDispose = this.kernelsByUri.get(uri.toString());
            if (kernelToDispose) {
                this.pendingDisposables.add(kernelToDispose.kernel);
                kernelToDispose.kernel
                    .dispose()
                    .catch((ex) => traceWarning('Failed to dispose old kernel', ex))
                    .finally(() => this.pendingDisposables.delete(kernelToDispose.kernel))
                    .catch(noop);
            }
            this.kernelsByUri.delete(uri.toString());
        }
    }
}
