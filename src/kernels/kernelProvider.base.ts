// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';
import type { KernelMessage } from '@jupyterlab/services';
import { Event, EventEmitter, NotebookDocument, Uri, workspace } from 'vscode';
import { IVSCodeNotebook } from '../platform/common/application/types';
import { traceInfoIfCI, traceVerbose, traceWarning } from '../platform/logging';
import { getDisplayPath } from '../platform/common/platform/fs-paths';
import { IAsyncDisposable, IAsyncDisposableRegistry, IDisposableRegistry } from '../platform/common/types';
import { isUri, noop } from '../platform/common/utils/misc';
import { IKernel, IKernelProvider, INotebookKernel, KernelOptions } from './types';

export abstract class BaseKernelProvider implements IKernelProvider {
    /**
     * Use a separate dictionary to track kernels by Notebook, so that
     * the ref to kernel is lost when the notebook is closed.
     */
    protected readonly kernelsByNotebook = new WeakMap<
        NotebookDocument,
        { options: KernelOptions; kernel: INotebookKernel }
    >();
    /**
     * The life time of kernels not tied to a notebook will be managed by callers of the API.
     * Where as if a kernel is tied to a notebook, then the kernel dies along with notebooks.
     */
    private readonly kernelsByUri = new Map<string, { options: KernelOptions; kernel: IKernel }>();
    private readonly pendingDisposables = new Set<IAsyncDisposable>();
    protected readonly _onDidRestartKernel = new EventEmitter<IKernel>();
    protected readonly _onDidRestartNotebookKernel = new EventEmitter<INotebookKernel>();
    protected readonly _onDidStartKernel = new EventEmitter<IKernel>();
    protected readonly _onDidStartNotebookKernel = new EventEmitter<INotebookKernel>();
    protected readonly _onDidCreateKernel = new EventEmitter<IKernel>();
    protected readonly _onDidCreateNotebookKernel = new EventEmitter<INotebookKernel>();
    protected readonly _onDidDisposeKernel = new EventEmitter<IKernel>();
    protected readonly _onDidDisposeNotebookKernel = new EventEmitter<INotebookKernel>();
    protected readonly _onKernelStatusChanged = new EventEmitter<{
        status: KernelMessage.Status;
        kernel: IKernel;
    }>();
    public readonly onKernelStatusChanged = this._onKernelStatusChanged.event;
    public get kernels() {
        const kernels = new Set<IKernel>();
        this.notebook.notebookDocuments.forEach((item) => {
            const kernel = this.get(item);
            if (kernel) {
                kernels.add(kernel);
            }
        });
        Array.from(this.kernelsByUri.values()).forEach((item) => kernels.add(item.kernel));
        return Array.from(kernels);
    }
    public get notebookKernels() {
        const kernels = new Set<INotebookKernel>();
        this.notebook.notebookDocuments.forEach((item) => {
            const kernel = this.get(item);
            if (kernel) {
                kernels.add(kernel);
            }
        });
        return Array.from(kernels);
    }
    constructor(
        protected asyncDisposables: IAsyncDisposableRegistry,
        protected disposables: IDisposableRegistry,
        private readonly notebook: IVSCodeNotebook
    ) {
        this.asyncDisposables.push(this);
        this.notebook.onDidCloseNotebookDocument((e) => this.disposeOldKernel(e.uri), this, disposables);
        disposables.push(this._onDidDisposeKernel);
        disposables.push(this._onDidRestartKernel);
        disposables.push(this._onKernelStatusChanged);
        disposables.push(this._onDidStartKernel);
        disposables.push(this._onDidCreateKernel);
        disposables.push(this._onDidCreateNotebookKernel);
        disposables.push(this._onDidStartNotebookKernel);
        disposables.push(this._onDidDisposeNotebookKernel);
    }

    public get onDidDisposeKernel(): Event<IKernel> {
        return this._onDidDisposeKernel.event;
    }
    public get onDidDisposeNotebookKernel(): Event<INotebookKernel> {
        return this._onDidDisposeNotebookKernel.event;
    }

    public get onDidRestartKernel(): Event<IKernel> {
        return this._onDidRestartKernel.event;
    }
    public get onDidRestartNotebookKernel(): Event<INotebookKernel> {
        return this._onDidRestartNotebookKernel.event;
    }

    public get onDidStartKernel(): Event<IKernel> {
        return this._onDidStartKernel.event;
    }

    public get onDidStartNotebookKernel(): Event<INotebookKernel> {
        return this._onDidStartNotebookKernel.event;
    }
    public get onDidCreateKernel(): Event<IKernel> {
        return this._onDidCreateKernel.event;
    }
    public get onDidCreateNotebookKernel(): Event<INotebookKernel> {
        return this._onDidCreateNotebookKernel.event;
    }

    public get(uri: Uri): IKernel | undefined;
    public get(notebook: NotebookDocument): INotebookKernel | undefined;
    public get(uriOrNotebook: Uri | NotebookDocument): INotebookKernel | IKernel | undefined {
        return isUri(uriOrNotebook)
            ? this.getInternal(uriOrNotebook)?.kernel
            : this.kernelsByNotebook.get(uriOrNotebook)?.kernel;
    }

    public async dispose() {
        traceInfoIfCI(`Disposing all kernels from kernel provider`);
        const items = Array.from(this.pendingDisposables.values());
        this.pendingDisposables.clear();
        await Promise.all(items);
        await Promise.all(this.kernels.map((k) => k.dispose()));
    }
    public abstract getOrCreate(uri: Uri, options: KernelOptions): IKernel;
    public abstract getOrCreate(notebook: NotebookDocument, options: KernelOptions): INotebookKernel;
    public abstract getOrCreate(
        uriOrNotebook: Uri | NotebookDocument,
        options: KernelOptions
    ): IKernel | INotebookKernel | undefined;
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

    protected storeKernelByUri(uri: Uri, options: KernelOptions, kernel: IKernel) {
        this.kernelsByUri.set(uri.toString(), { options, kernel });
        this._onDidCreateKernel.fire(kernel);
    }

    protected storeKernelByNotebook(notebook: NotebookDocument, options: KernelOptions, kernel: INotebookKernel) {
        this.kernelsByNotebook.set(notebook, { options, kernel });
        this._onDidCreateKernel.fire(kernel);
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
            const kernelToDispose = this.kernelsByNotebook.get(notebook);
            if (kernelToDispose) {
                traceInfoIfCI(
                    `Disposing kernel associated with ${getDisplayPath(notebook.uri)}, isClosed=${notebook.isClosed}`
                );
                this.pendingDisposables.add(kernelToDispose.kernel);
                kernelToDispose.kernel
                    .dispose()
                    .catch((ex) => traceWarning('Failed to dispose old kernel', ex))
                    .finally(() => this.pendingDisposables.delete(kernelToDispose.kernel))
                    .catch(noop);
            }
            this.kernelsByNotebook.delete(notebook);
        } else {
            const kernelToDispose = this.kernelsByUri.get(uri.toString());
            if (kernelToDispose) {
                traceInfoIfCI(`Disposing kernel associated with ${getDisplayPath(uri)}`);
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
