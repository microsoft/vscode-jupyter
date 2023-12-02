// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { KernelMessage } from '@jupyterlab/services';
import { Event, EventEmitter, NotebookDocument, Uri, workspace } from 'vscode';
import { traceInfoIfCI, traceVerbose, traceWarning } from '../platform/logging';
import { getDisplayPath } from '../platform/common/platform/fs-paths';
import { IAsyncDisposable, IAsyncDisposableRegistry, IDisposableRegistry } from '../platform/common/types';
import { isUri, noop } from '../platform/common/utils/misc';
import {
    IThirdPartyKernel,
    IKernelProvider,
    IKernel,
    KernelOptions,
    IThirdPartyKernelProvider,
    ThirdPartyKernelOptions,
    INotebookKernelExecution
} from './types';
import { JupyterServerProviderHandle } from './jupyter/types';

/**
 * Provides kernels to the system. Generally backed by a URI or a notebook object.
 */
export abstract class BaseCoreKernelProvider implements IKernelProvider {
    protected readonly executions = new WeakMap<IKernel, INotebookKernelExecution>();

    /**
     * Use a separate dictionary to track kernels by Notebook, so that
     * the ref to kernel is lost when the notebook is closed.
     */
    private readonly kernelsByNotebook = new WeakMap<NotebookDocument, { options: KernelOptions; kernel: IKernel }>();
    private readonly kernelsById = new Map<string, { options: KernelOptions; kernel: IKernel }>();
    private readonly pendingDisposables = new Set<IAsyncDisposable>();
    protected readonly _onDidRestartKernel = new EventEmitter<IKernel>();
    protected readonly _onDidStartKernel = new EventEmitter<IKernel>();
    protected readonly _onDidCreateKernel = new EventEmitter<IKernel>();
    protected readonly _onDidDisposeKernel = new EventEmitter<IKernel>();
    protected readonly _onKernelStatusChanged = new EventEmitter<{ status: KernelMessage.Status; kernel: IKernel }>();
    public readonly onKernelStatusChanged = this._onKernelStatusChanged.event;
    public get kernels() {
        const kernels = new Set<IKernel>();
        workspace.notebookDocuments.forEach((item) => {
            const kernel = this.get(item);
            if (kernel) {
                kernels.add(kernel);
            }
        });
        return Array.from(kernels);
    }
    constructor(
        protected asyncDisposables: IAsyncDisposableRegistry,
        protected disposables: IDisposableRegistry
    ) {
        this.asyncDisposables.push(this);
        workspace.onDidCloseNotebookDocument((e) => this.disposeOldKernel(e), this, disposables);
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
    public get(uriOrNotebook: Uri | NotebookDocument | string): IKernel | undefined {
        if (isUri(uriOrNotebook)) {
            const notebook = workspace.notebookDocuments.find(
                (item) => item.uri.toString() === uriOrNotebook.toString()
            );
            return notebook ? this.get(notebook) : undefined;
        } else if (typeof uriOrNotebook === 'string') {
            return this.kernelsById.get(uriOrNotebook)?.kernel;
        } else {
            return this.kernelsByNotebook.get(uriOrNotebook)?.kernel;
        }
    }
    public getKernelExecution(kernel: IKernel): INotebookKernelExecution {
        return this.executions.get(kernel)!;
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
        this.kernelsById.set(kernel.id, { options, kernel });
        this._onDidCreateKernel.fire(kernel);
    }
    /**
     * If a kernel has been disposed, then remove the mapping of Uri + Kernel.
     */
    protected deleteMappingIfKernelIsDisposed(kernel: IKernel) {
        kernel.onDisposed(
            () => {
                // If the same kernel is associated with this document & it was disposed, then delete it.
                if (this.get(kernel.notebook) === kernel) {
                    this.kernelsByNotebook.delete(kernel.notebook);
                    this.kernelsById.delete(kernel.id);
                    traceVerbose(
                        `Kernel got disposed, hence there is no longer a kernel associated with ${getDisplayPath(
                            kernel.uri
                        )}`
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
            traceVerbose(
                `Disposing kernel associated with ${getDisplayPath(notebook.uri)}, isClosed=${notebook.isClosed}`
            );
            this.kernelsById.delete(kernelToDispose.kernel.id);
            this.pendingDisposables.add(kernelToDispose.kernel);
            kernelToDispose.kernel
                .dispose()
                .catch((ex) => traceWarning('Failed to dispose old kernel', ex))
                .finally(() => this.pendingDisposables.delete(kernelToDispose.kernel))
                .catch(noop);
        }
        this.kernelsByNotebook.delete(notebook);
    }

    protected handleServerRemoval(servers: JupyterServerProviderHandle[]) {
        workspace.notebookDocuments.forEach((document) => {
            const kernel = this.kernelsByNotebook.get(document);
            if (kernel) {
                const metadata = kernel.options.metadata;

                if (metadata.kind === 'connectToLiveRemoteKernel' || metadata.kind === 'startUsingRemoteKernelSpec') {
                    const matchingRemovedServer = servers.find(
                        (server) =>
                            server.id === metadata.serverProviderHandle.id &&
                            server.handle === metadata.serverProviderHandle.handle
                    );
                    if (matchingRemovedServer) {
                        // it should be removed
                        this.kernelsByNotebook.delete(document);
                        this.kernelsById.delete(kernel.kernel.id);
                    }
                }
            }
        });
    }
}

export abstract class BaseThirdPartyKernelProvider implements IThirdPartyKernelProvider {
    /**
     * The life time of kernels not tied to a notebook will be managed by callers of the API.
     * Where as if a kernel is tied to a notebook, then the kernel dies along with notebooks.
     */
    private readonly kernelsByUri = new Map<string, { options: ThirdPartyKernelOptions; kernel: IThirdPartyKernel }>();
    private readonly kernelsById = new Map<string, { options: ThirdPartyKernelOptions; kernel: IThirdPartyKernel }>();
    private readonly pendingDisposables = new Set<IAsyncDisposable>();
    protected readonly _onDidRestartKernel = new EventEmitter<IThirdPartyKernel>();
    protected readonly _onDidStartKernel = new EventEmitter<IThirdPartyKernel>();
    protected readonly _onDidCreateKernel = new EventEmitter<IThirdPartyKernel>();
    protected readonly _onDidDisposeKernel = new EventEmitter<IThirdPartyKernel>();
    protected readonly _onKernelStatusChanged = new EventEmitter<{
        status: KernelMessage.Status;
        kernel: IThirdPartyKernel;
    }>();
    public readonly onKernelStatusChanged = this._onKernelStatusChanged.event;
    public get kernels() {
        return Array.from(this.kernelsByUri.values()).map((item) => item.kernel);
    }
    constructor(
        protected asyncDisposables: IAsyncDisposableRegistry,
        protected disposables: IDisposableRegistry
    ) {
        this.asyncDisposables.push(this);
        workspace.onDidCloseNotebookDocument(
            (e) => {
                traceVerbose(`Notebook document ${getDisplayPath(e.uri)} got closed`);
                this.disposeOldKernel(e.uri);
            },
            this,
            disposables
        );
        disposables.push(this._onDidDisposeKernel);
        disposables.push(this._onDidRestartKernel);
        disposables.push(this._onKernelStatusChanged);
        disposables.push(this._onDidStartKernel);
        disposables.push(this._onDidCreateKernel);
    }

    public get onDidDisposeKernel(): Event<IThirdPartyKernel> {
        return this._onDidDisposeKernel.event;
    }
    public get onDidRestartKernel(): Event<IThirdPartyKernel> {
        return this._onDidRestartKernel.event;
    }
    public get onDidStartKernel(): Event<IThirdPartyKernel> {
        return this._onDidStartKernel.event;
    }
    public get onDidCreateKernel(): Event<IThirdPartyKernel> {
        return this._onDidCreateKernel.event;
    }
    public get(uri: Uri | string): IThirdPartyKernel | undefined {
        return this.kernelsByUri.get(uri.toString())?.kernel || this.kernelsById.get(uri.toString())?.kernel;
    }

    public getInternal(uri: Uri):
        | {
              options: ThirdPartyKernelOptions;
              kernel: IThirdPartyKernel;
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
    public abstract getOrCreate(uri: Uri, options: ThirdPartyKernelOptions): IThirdPartyKernel;
    protected storeKernel(uri: Uri, options: ThirdPartyKernelOptions, kernel: IThirdPartyKernel) {
        this.kernelsByUri.set(uri.toString(), { options, kernel });
        this.kernelsById.set(kernel.id, { options, kernel });
        this._onDidCreateKernel.fire(kernel);
    }

    /**
     * If a kernel has been disposed, then remove the mapping of Uri + Kernel.
     */
    protected deleteMappingIfKernelIsDisposed(uri: Uri, kernel: IThirdPartyKernel) {
        kernel.onDisposed(
            () => {
                // If the same kernel is associated with this document & it was disposed, then delete it.
                if (this.get(uri) === kernel) {
                    this.kernelsByUri.delete(uri.toString());
                    this.kernelsById.delete(kernel.id);
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
            this.kernelsById.delete(kernelToDispose.kernel.id);
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
