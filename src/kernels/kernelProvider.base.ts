// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';
import type { KernelMessage } from '@jupyterlab/services';
import { Event, EventEmitter, NotebookDocument, Uri } from 'vscode';
import { IVSCodeNotebook } from '../platform/common/application/types';
import { traceInfoIfCI, traceVerbose, traceWarning } from '../platform/logging';
import { getDisplayPath } from '../platform/common/platform/fs-paths';
import { IAsyncDisposable, IAsyncDisposableRegistry, IDisposableRegistry } from '../platform/common/types';
import { noop } from '../platform/common/utils/misc';
import { IBaseKernel, IKernelProvider, IKernel, KernelOptions, IThirdPartyKernelProvider } from './types';

export abstract class BaseKernelProvider implements IKernelProvider {
    /**
     * Use a separate dictionary to track kernels by Notebook, so that
     * the ref to kernel is lost when the notebook is closed.
     */
    private readonly kernelsByNotebook = new WeakMap<NotebookDocument, { options: KernelOptions; kernel: IKernel }>();
    private readonly pendingDisposables = new Set<IAsyncDisposable>();
    protected readonly _onDidRestartKernel = new EventEmitter<IKernel>();
    protected readonly _onDidStartKernel = new EventEmitter<IKernel>();
    protected readonly _onDidCreateKernel = new EventEmitter<IKernel>();
    protected readonly _onDidDisposeKernel = new EventEmitter<IKernel>();
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
        // Array.from(this.kernelsByUri.values()).forEach((item) => kernels.add(item.kernel));
        return Array.from(kernels);
    }
    constructor(
        protected asyncDisposables: IAsyncDisposableRegistry,
        protected disposables: IDisposableRegistry,
        private readonly notebook: IVSCodeNotebook
    ) {
        this.asyncDisposables.push(this);
        this.notebook.onDidCloseNotebookDocument((e) => this.disposeOldKernel(e), this, disposables);
        disposables.push(this._onDidDisposeKernel);
        disposables.push(this._onDidRestartKernel);
        disposables.push(this._onKernelStatusChanged);
        disposables.push(this._onDidStartKernel);
        disposables.push(this._onDidCreateKernel);
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
    public get onDidCreateKernel(): Event<IKernel> {
        return this._onDidCreateKernel.event;
    }
    public get(notebook: NotebookDocument): IKernel | undefined {
        return this.kernelsByNotebook.get(notebook)?.kernel;
    }

    public getInternal(notebook: NotebookDocument):
        | {
              options: KernelOptions;
              kernel: IKernel;
          }
        | undefined {
        return this.kernelsByNotebook.get(notebook);
    }

    public async dispose() {
        traceInfoIfCI(`Disposing all kernels from kernel provider`);
        const items = Array.from(this.pendingDisposables.values());
        this.pendingDisposables.clear();
        await Promise.all(items);
        await Promise.all(this.kernels.map((k) => k.dispose()));
    }
    public abstract getOrCreate(notebook: NotebookDocument, options: KernelOptions): IKernel;
    protected storeKernel(notebook: NotebookDocument, options: KernelOptions, kernel: IKernel) {
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
                if (this.get(kernel.notebook) === kernel) {
                    this.kernelsByNotebook.delete(kernel.notebook);
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
    protected disposeOldKernel(notebook: NotebookDocument) {
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
    }
}

export abstract class BaseThirdPartyKernelProvider implements IThirdPartyKernelProvider {
    /**
     * The life time of kernels not tied to a notebook will be managed by callers of the API.
     * Where as if a kernel is tied to a notebook, then the kernel dies along with notebooks.
     */
    private readonly kernelsByUri = new Map<string, { options: KernelOptions; kernel: IBaseKernel }>();
    private readonly pendingDisposables = new Set<IAsyncDisposable>();
    protected readonly _onDidRestartKernel = new EventEmitter<IBaseKernel>();
    protected readonly _onDidStartKernel = new EventEmitter<IBaseKernel>();
    protected readonly _onDidCreateKernel = new EventEmitter<IBaseKernel>();
    protected readonly _onDidDisposeKernel = new EventEmitter<IBaseKernel>();
    protected readonly _onKernelStatusChanged = new EventEmitter<{
        status: KernelMessage.Status;
        kernel: IBaseKernel;
    }>();
    public readonly onKernelStatusChanged = this._onKernelStatusChanged.event;
    public get kernels() {
        return Array.from(this.kernelsByUri.values()).map((item) => item.kernel);
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
    }

    public get onDidDisposeKernel(): Event<IBaseKernel> {
        return this._onDidDisposeKernel.event;
    }
    public get onDidRestartKernel(): Event<IBaseKernel> {
        return this._onDidRestartKernel.event;
    }
    public get onDidStartKernel(): Event<IBaseKernel> {
        return this._onDidStartKernel.event;
    }
    public get onDidCreateKernel(): Event<IBaseKernel> {
        return this._onDidCreateKernel.event;
    }
    public get(uri: Uri): IBaseKernel | undefined {
        return this.kernelsByUri.get(uri.toString())?.kernel;
    }

    public getInternal(uri: Uri):
        | {
              options: KernelOptions;
              kernel: IBaseKernel;
          }
        | undefined {
        return this.kernelsByUri.get(uri.toString());
    }

    public async dispose() {
        traceInfoIfCI(`Disposing all kernels from kernel provider`);
        const items = Array.from(this.pendingDisposables.values());
        this.pendingDisposables.clear();
        await Promise.all(items);
        await Promise.all(this.kernels.map((k) => k.dispose()));
    }
    public abstract getOrCreate(uri: Uri, options: KernelOptions): IBaseKernel;
    protected storeKernel(uri: Uri, options: KernelOptions, kernel: IBaseKernel) {
        this.kernelsByUri.set(uri.toString(), { options, kernel });
        this._onDidCreateKernel.fire(kernel);
    }

    /**
     * If a kernel has been disposed, then remove the mapping of Uri + Kernel.
     */
    protected deleteMappingIfKernelIsDisposed(uri: Uri, kernel: IBaseKernel) {
        kernel.onDisposed(
            () => {
                // If the same kernel is associated with this document & it was disposed, then delete it.
                if (this.get(uri) === kernel) {
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
