// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';
import { inject, injectable } from 'inversify';
import { Uri, workspace } from 'vscode';
import { IApplicationShell, IWorkspaceService, IVSCodeNotebook } from '../platform/common/application/types';
import { IFileSystem } from '../platform/common/platform/types.node';
import { IPythonExecutionFactory } from '../platform/common/process/types.node';
import { IAsyncDisposableRegistry, IDisposableRegistry, IConfigurationService } from '../platform/common/types';
import { CellHashProviderFactory } from '../interactive-window/editor-integration/cellHashProviderFactory';
import { InteractiveWindowView } from '../notebooks/constants';
import { CellOutputDisplayIdTracker } from '../notebooks/execution/cellDisplayIdTracker';
import { Kernel } from './kernel.node';
import { IKernel, INotebookProvider, KernelOptions } from './types';
import { IStatusProvider } from '../platform/progress/types';
import { BaseKernelProvider } from './kernelProvider.base';

@injectable()
export class KernelProvider extends BaseKernelProvider {
    constructor(
        @inject(IAsyncDisposableRegistry) asyncDisposables: IAsyncDisposableRegistry,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(INotebookProvider) private notebookProvider: INotebookProvider,
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(CellOutputDisplayIdTracker) private readonly outputTracker: CellOutputDisplayIdTracker,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(CellHashProviderFactory) private cellHashProviderFactory: CellHashProviderFactory,
        @inject(IVSCodeNotebook) notebook: IVSCodeNotebook,
        @inject(IPythonExecutionFactory) private readonly pythonExecutionFactory: IPythonExecutionFactory,
        @inject(IStatusProvider) private readonly statusProvider: IStatusProvider
    ) {
        super(asyncDisposables, disposables, notebook);
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
            this.cellHashProviderFactory,
            this.workspaceService,
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
}
