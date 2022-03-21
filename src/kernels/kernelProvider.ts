// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';
import type { KernelMessage } from '@jupyterlab/services';
import { inject, injectable } from 'inversify';
import { Event, EventEmitter, NotebookDocument } from 'vscode';
import { IApplicationShell, IWorkspaceService, IVSCodeNotebook } from '../client/common/application/types';
import { traceInfoIfCI, traceVerbose, traceWarning } from '../client/common/logger';
import { getDisplayPath } from '../client/common/platform/fs-paths';
import { IFileSystem } from '../client/common/platform/types';
import { IPythonExecutionFactory } from '../client/common/process/types';
import {
    IAsyncDisposable,
    IAsyncDisposableRegistry,
    IDisposableRegistry,
    IConfigurationService
} from '../client/common/types';
import { noop } from '../client/common/utils/misc';
import { CellHashProviderFactory } from '../interactive-window/editor-integration/cellHashProviderFactory';
import { InteractiveWindowView } from '../notebooks/constants';
import { INotebookProvider, IStatusProvider } from '../client/datascience/types';
import { CellOutputDisplayIdTracker } from '../notebooks/execution/cellDisplayIdTracker';
import { Kernel } from './kernel';
import { IKernel, IKernelProvider, KernelOptions } from './types';

@injectable()
export class KernelProvider implements IKernelProvider {
    private readonly kernelsByNotebook = new WeakMap<NotebookDocument, { options: KernelOptions; kernel: IKernel }>();
    private readonly pendingDisposables = new Set<IAsyncDisposable>();
    private readonly _onDidRestartKernel = new EventEmitter<IKernel>();
    private readonly _onDidStartKernel = new EventEmitter<IKernel>();
    private readonly _onDidDisposeKernel = new EventEmitter<IKernel>();
    private readonly _onKernelStatusChanged = new EventEmitter<{ status: KernelMessage.Status; kernel: IKernel }>();
    public readonly onKernelStatusChanged = this._onKernelStatusChanged.event;
    public get kernels() {
        const kernels = new Set<IKernel>();
        this.notebook.notebookDocuments.forEach((item) => {
            const kernel = this.get(item);
            if (kernel) {
                kernels.add(kernel);
            }
        });
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
        this.notebook.onDidCloseNotebookDocument(this.disposeOldKernel, this, disposables);
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

    public get(notebook: NotebookDocument): IKernel | undefined {
        return this.kernelsByNotebook.get(notebook)?.kernel;
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
    public getOrCreate(notebook: NotebookDocument, options: KernelOptions): IKernel {
        const existingKernelInfo = this.kernelsByNotebook.get(notebook);
        if (existingKernelInfo && existingKernelInfo.options.metadata.id === options.metadata.id) {
            return existingKernelInfo.kernel;
        }
        const resourceUri = notebook.notebookType === InteractiveWindowView ? options.resourceUri : notebook.uri;
        this.disposeOldKernel(notebook);

        const waitForIdleTimeout = this.configService.getSettings(resourceUri).jupyterLaunchTimeout;
        const interruptTimeout = this.configService.getSettings(resourceUri).jupyterInterruptTimeout;
        const kernel = new Kernel(
            notebook,
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
        this.kernelsByNotebook.set(notebook, { options, kernel });
        this.deleteMappingIfKernelIsDisposed(notebook, kernel);
        return kernel;
    }
    /**
     * If a kernel has been disposed, then remove the mapping of Uri + Kernel.
     */
    private deleteMappingIfKernelIsDisposed(notebook: NotebookDocument, kernel: IKernel) {
        kernel.onDisposed(
            () => {
                // If the same kernel is associated with this document & it was disposed, then delete it.
                if (this.kernelsByNotebook.get(notebook)?.kernel === kernel) {
                    this.kernelsByNotebook.delete(notebook);
                    traceVerbose(
                        `Kernel got disposed, hence there is no longer a kernel associated with ${getDisplayPath(
                            notebook.uri
                        )}`,
                        getDisplayPath(kernel.notebookDocument.uri)
                    );
                }
                this.pendingDisposables.delete(kernel);
            },
            this,
            this.disposables
        );
    }
    private disposeOldKernel(notebook: NotebookDocument) {
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
    }
}
