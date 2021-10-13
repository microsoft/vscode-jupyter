// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { Event, EventEmitter, NotebookDocument } from 'vscode';
import { ServerStatus } from '../../../../datascience-ui/interactive-common/mainState';
import { IApplicationShell, IVSCodeNotebook, IWorkspaceService } from '../../../common/application/types';
import { traceInfo, traceWarning } from '../../../common/logger';
import { IFileSystem } from '../../../common/platform/types';
import { IPythonExecutionFactory } from '../../../common/process/types';
import {
    IAsyncDisposable,
    IAsyncDisposableRegistry,
    IConfigurationService,
    IDisposableRegistry
} from '../../../common/types';
import { noop } from '../../../common/utils/misc';
import { IServiceContainer } from '../../../ioc/types';
import { CellHashProviderFactory } from '../../editor-integration/cellHashProviderFactory';
import { InteractiveWindowView } from '../../notebook/constants';
import { INotebookControllerManager } from '../../notebook/types';
import { IDataScienceErrorHandler, IJupyterServerUriStorage, INotebook, INotebookProvider } from '../../types';
import { CellOutputDisplayIdTracker } from './cellDisplayIdTracker';
import { Kernel } from './kernel';
import { IKernel, IKernelProvider, KernelOptions } from './types';

@injectable()
export class KernelProvider implements IKernelProvider {
    private readonly kernelsByNotebook = new WeakMap<NotebookDocument, { options: KernelOptions; kernel: IKernel }>();
    private readonly pendingDisposables = new Set<IAsyncDisposable>();
    private readonly _onDidRestartKernel = new EventEmitter<IKernel>();
    private readonly _onDidStartKernel = new EventEmitter<IKernel>();
    private readonly _onDidDisposeKernel = new EventEmitter<IKernel>();
    private readonly _onKernelStatusChanged = new EventEmitter<{ status: ServerStatus; kernel: IKernel }>();
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
        @inject(IDataScienceErrorHandler) private readonly errorHandler: IDataScienceErrorHandler,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IJupyterServerUriStorage) private readonly serverStorage: IJupyterServerUriStorage,
        @inject(CellOutputDisplayIdTracker) private readonly outputTracker: CellOutputDisplayIdTracker,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(CellHashProviderFactory) private cellHashProviderFactory: CellHashProviderFactory,
        @inject(IVSCodeNotebook) private readonly notebook: IVSCodeNotebook,
        @inject(IPythonExecutionFactory) private readonly pythonExecutionFactory: IPythonExecutionFactory,
        @inject(IServiceContainer) private readonly serviceContainer: IServiceContainer
    ) {
        this.asyncDisposables.push(this);
        this.notebookProvider.onSessionStatusChanged(this.onNotebookSessionChanged, this, this.disposables);
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
            this.errorHandler,
            this.appShell,
            this.fs,
            this.serverStorage,
            options.controller,
            this.configService,
            this.outputTracker,
            this.workspaceService,
            this.cellHashProviderFactory,
            this.pythonExecutionFactory,
            this.serviceContainer.get<INotebookControllerManager>(INotebookControllerManager)
        );
        kernel.onRestarted(() => this._onDidRestartKernel.fire(kernel), this, this.disposables);
        kernel.onDisposed(() => this._onDidDisposeKernel.fire(kernel), this, this.disposables);
        kernel.onStarted(() => this._onDidStartKernel.fire(kernel), this, this.disposables);
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
                    traceInfo(
                        `Kernel got disposed, hence there is no longer a kernel associated with ${notebook.uri.toString()}`,
                        kernel.notebookDocument.uri.toString()
                    );
                }
                this.pendingDisposables.delete(kernel);
            },
            this,
            this.disposables
        );
    }
    private disposeOldKernel(notebook: NotebookDocument) {
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
    private onNotebookSessionChanged({ status, notebook }: { status: ServerStatus; notebook: INotebook }) {
        const kernel = this.kernels.find((item) => item.notebook === notebook);
        if (kernel) {
            this._onKernelStatusChanged.fire({ status, kernel });
        }
    }
}
