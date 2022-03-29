// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';
import type { KernelMessage } from '@jupyterlab/services';
import { inject, injectable } from 'inversify';
import { Event, EventEmitter, NotebookDocument, Uri, workspace } from 'vscode';
import { IApplicationShell, IWorkspaceService, IVSCodeNotebook } from '../platform/common/application/types';
import { traceInfoIfCI, traceVerbose, traceWarning } from '../platform/common/logger';
import { getDisplayPath } from '../platform/common/platform/fs-paths';
import { IFileSystem } from '../platform/common/platform/types';
import { IPythonExecutionFactory } from '../platform/common/process/types';
import {
    IAsyncDisposable,
    IAsyncDisposableRegistry,
    IDisposableRegistry,
    IConfigurationService
} from '../platform/common/types';
import { noop } from '../platform/common/utils/misc';
import { CellHashProviderFactory } from '../interactive-window/editor-integration/cellHashProviderFactory';
import { InteractiveWindowView } from '../notebooks/constants';
import { CellOutputDisplayIdTracker } from '../notebooks/execution/cellDisplayIdTracker';
import { Kernel } from './kernel';
import { IKernel, IKernelProvider, INotebookProvider, KernelOptions } from './types';
import { IStatusProvider } from '../platform/progress/types';

@injectable()
export class KernelProvider implements IKernelProvider {
    /**
     * Use a separate dictionary to track kernels by Notebook, so that
     * the ref to kernel is lost when the notebook is closed.
     */
    private readonly kernelsByNotebook = new WeakMap<NotebookDocument, { options: KernelOptions; kernel: IKernel }>();
    /**
     * The life time of kernels not tied to a notebook will be managed by callers of the API.
     * Where as if a kernel is tied to a notebook, then the kernel dies along with notebooks.
     */
    private readonly kernelsByUri = new Map<string, { options: KernelOptions; kernel: IKernel }>();
    private readonly pendingDisposables = new Set<IAsyncDisposable>();
    private readonly _onDidRestartKernel = new EventEmitter<IKernel>();
    private readonly _onDidStartKernel = new EventEmitter<IKernel>();
    private readonly _onDidDisposeKernel = new EventEmitter<IKernel>();
    private readonly _onKernelStatusChanged = new EventEmitter<{ status: KernelMessage.Status; kernel: IKernel }>();
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
        @inject(IAsyncDisposableRegistry) private asyncDisposables: IAsyncDisposableRegistry,
        @inject(IDisposableRegistry) private disposables: IDisposableRegistry,
        @inject(INotebookProvider) private notebookProvider: INotebookProvider,
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(CellOutputDisplayIdTracker) private readonly outputTracker: CellOutputDisplayIdTracker,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(CellHashProviderFactory) private cellHashProviderFactory: CellHashProviderFactory,
        @inject(IVSCodeNotebook) private readonly notebook: IVSCodeNotebook,
        @inject(IPythonExecutionFactory) private readonly pythonExecutionFactory: IPythonExecutionFactory,
        @inject(IStatusProvider) private readonly statusProvider: IStatusProvider
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
    public getOrCreate(uri: Uri, options: KernelOptions): IKernel {
        const existingKernelInfo = this.getInternal(uri);
        const notebook = workspace.notebookDocuments.find((nb) => nb.uri.toString() === uri.toString());
        if (existingKernelInfo && existingKernelInfo.options.metadata.id === options.metadata.id) {
            return existingKernelInfo.kernel;
        }
        this.disposeOldKernel(uri);

        const resourceUri = notebook?.notebookType === InteractiveWindowView ? options.resourceUri : uri;
        const waitForIdleTimeout = this.configService.getSettings(resourceUri).jupyterLaunchTimeout;
        const interruptTimeout = this.configService.getSettings(resourceUri).jupyterInterruptTimeout;
        const kernel = new Kernel(
            uri,
            resourceUri,
            options.metadata,
            this.notebookProvider,
            this.disposables,
            waitForIdleTimeout,
            interruptTimeout,
            this.appShell,
            this.fs,
            options.controller,
            this.configService,
            this.outputTracker,
            this.workspaceService,
            this.cellHashProviderFactory,
            this.pythonExecutionFactory,
            this.statusProvider
        );
        kernel.onRestarted(() => this._onDidRestartKernel.fire(kernel), this, this.disposables);
        kernel.onDisposed(() => this._onDidDisposeKernel.fire(kernel), this, this.disposables);
        kernel.onStarted(() => this._onDidStartKernel.fire(kernel), this, this.disposables);
        kernel.onStatusChanged(
            (status) => this._onKernelStatusChanged.fire({ kernel, status }),
            this,
            this.disposables
        );
        this.asyncDisposables.push(kernel);
        if (notebook) {
            this.kernelsByNotebook.set(notebook, { options, kernel });
        } else {
            this.kernelsByUri.set(uri.toString(), { options, kernel });
        }
        this.deleteMappingIfKernelIsDisposed(uri, kernel);
        return kernel;
    }
    public getInternal(
        uri: Uri
    ):
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
    private deleteMappingIfKernelIsDisposed(uri: Uri, kernel: IKernel) {
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
    private disposeOldKernel(uri: Uri) {
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
