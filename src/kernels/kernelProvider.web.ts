// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';
import { inject, injectable, multiInject } from 'inversify';
import { Uri, workspace } from 'vscode';
import { IApplicationShell, IVSCodeNotebook, IWorkspaceService } from '../platform/common/application/types';
import { InteractiveWindowView } from '../platform/common/constants';
import {
    IAsyncDisposableRegistry,
    IConfigurationService,
    IDisposableRegistry,
    IExtensionContext
} from '../platform/common/types';
import { IStatusProvider } from '../platform/progress/types';
import { CellOutputDisplayIdTracker } from './execution/cellDisplayIdTracker';
import { Kernel } from './kernel';
import { BaseKernelProvider } from './kernelProvider.base';
import { IKernel, INotebookProvider, IStartupCodeProvider, ITracebackFormatter, KernelOptions } from './types';

@injectable()
export class KernelProvider extends BaseKernelProvider {
    constructor(
        @inject(IAsyncDisposableRegistry) asyncDisposables: IAsyncDisposableRegistry,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(INotebookProvider) private notebookProvider: INotebookProvider,
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(CellOutputDisplayIdTracker) private readonly outputTracker: CellOutputDisplayIdTracker,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IVSCodeNotebook) notebook: IVSCodeNotebook,
        @inject(IStatusProvider) private readonly statusProvider: IStatusProvider,
        @inject(IExtensionContext) private readonly context: IExtensionContext,
        @multiInject(ITracebackFormatter) private readonly formatters: ITracebackFormatter[],
        @multiInject(IStartupCodeProvider) private readonly startupCodeProviders: IStartupCodeProvider[]
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
            waitForIdleTimeout,
            interruptTimeout,
            this.appShell,
            options.controller,
            this.configService,
            this.outputTracker,
            this.workspaceService,
            this.statusProvider,
            options.creator,
            this.context,
            this.formatters,
            this.startupCodeProviders,
            () => Promise.resolve()
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
        this.storeKernel(uri, notebook, options, kernel);
        this.deleteMappingIfKernelIsDisposed(uri, kernel);
        return kernel;
    }
}
