// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';
import { inject, injectable, multiInject } from 'inversify';
import { NotebookDocument, Uri, workspace } from 'vscode';
import { IApplicationShell, IWorkspaceService, IVSCodeNotebook } from '../platform/common/application/types';
import {
    IAsyncDisposableRegistry,
    IDisposableRegistry,
    IConfigurationService,
    IExtensionContext
} from '../platform/common/types';
import { Kernel } from './kernel.web';
import { IKernel, INotebookKernel, INotebookProvider, ITracebackFormatter, KernelOptions } from './types';
import { BaseKernelProvider } from './kernelProvider.base';
import { IStatusProvider } from '../platform/progress/types';
import { InteractiveWindowView } from '../platform/common/constants';
import { CellOutputDisplayIdTracker } from './execution/cellDisplayIdTracker';
import { isUri } from '../platform/common/utils/misc';
import { IFileSystem } from '../platform/common/platform/types';

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
        @inject(IFileSystem) private readonly fs: IFileSystem
    ) {
        super(asyncDisposables, disposables, notebook);
    }

    public getOrCreate(uri: Uri, options: KernelOptions): IKernel;
    public getOrCreate(notebook: NotebookDocument, options: KernelOptions): INotebookKernel;
    public getOrCreate(
        uriOrNotebook: Uri | NotebookDocument,
        options: KernelOptions
    ): IKernel | INotebookKernel | undefined {
        const uri = isUri(uriOrNotebook) ? uriOrNotebook : uriOrNotebook.uri;
        const notebook = isUri(uriOrNotebook)
            ? workspace.notebookDocuments.find((nb) => nb.uri.toString() === uri.toString())
            : uriOrNotebook;
        const existingKernelInfo = this.getInternal(uri);
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
            notebook,
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
            this.fs
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

        if (isUri(uriOrNotebook)) {
            this.storeKernelByUri(uriOrNotebook, options, kernel);
        } else {
            this.storeKernelByNotebook(uriOrNotebook, options, kernel as INotebookKernel);
        }

        this.deleteMappingIfKernelIsDisposed(uri, kernel);
        return kernel;
    }
}
