// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { inject, injectable } from 'inversify';
import { CancellationToken, WebviewView, WebviewViewResolveContext } from 'vscode';
import {
    IWorkspaceService,
    IWebviewViewProvider,
    IVSCodeNotebook,
    IApplicationShell,
    ICommandManager
} from '../../../common/application/types';
import { IConfigurationService, IDisposableRegistry } from '../../../common/types';
import { IServiceContainer } from '../../../ioc/types';
import { KernelSelector } from '../../jupyter/kernels/kernelSelector';
import { IKernelProvider } from '../../jupyter/kernels/types';
import { INotebookStorageProvider } from '../../notebookStorage/notebookStorageProvider';
import {
    ICodeCssGenerator,
    IDataScienceErrorHandler,
    IInteractiveWindowListener,
    IJupyterServerUriStorage,
    INotebookProvider,
    IScratchPad,
    IStatusProvider,
    IThemeFinder
} from '../../types';
import { IScratchPadProvider, INotebookWatcher } from '../types';
import { ScratchPad } from './scratchPad';

// This class creates our UI for our variable view and links it to the vs code webview view
@injectable()
export class ScratchPadProvider implements IScratchPadProvider {
    public readonly viewType = 'jupyterScratchPad';
    private _scratchPad?: ScratchPad;

    constructor(@inject(IServiceContainer) private serviceContainer: IServiceContainer) {}

    public async resolveWebviewView(
        webviewView: WebviewView,
        _context: WebviewViewResolveContext,
        _token: CancellationToken
    ): Promise<void> {
        webviewView.webview.options = { enableScripts: true, enableCommandUris: true };

        // Create our actual variable view
        this._scratchPad = new ScratchPad(
            this.serviceContainer.getAll<IInteractiveWindowListener>(IInteractiveWindowListener),
            this.serviceContainer.get<IConfigurationService>(IConfigurationService),
            this.serviceContainer.get<ICodeCssGenerator>(ICodeCssGenerator),
            this.serviceContainer.get<IThemeFinder>(IThemeFinder),
            this.serviceContainer.get<IWorkspaceService>(IWorkspaceService),
            this.serviceContainer.get<IWebviewViewProvider>(IWebviewViewProvider),
            this.serviceContainer.get<IDisposableRegistry>(IDisposableRegistry),
            this.serviceContainer.get<INotebookWatcher>(INotebookWatcher),
            this.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook),
            this.serviceContainer.get<IStatusProvider>(IStatusProvider),
            this.serviceContainer.get<IApplicationShell>(IApplicationShell),
            this.serviceContainer.get<IDataScienceErrorHandler>(IDataScienceErrorHandler),
            this.serviceContainer.get<INotebookProvider>(INotebookProvider),
            this.serviceContainer.get<INotebookStorageProvider>(INotebookStorageProvider),
            this.serviceContainer.get<IJupyterServerUriStorage>(IJupyterServerUriStorage),
            this.serviceContainer.get<KernelSelector>(KernelSelector),
            this.serviceContainer.get<ICommandManager>(ICommandManager),
            this.serviceContainer.get<IKernelProvider>(IKernelProvider)
        );

        await this._scratchPad.load(webviewView);
    }

    public get scratchPad(): IScratchPad | undefined {
        return this._scratchPad;
    }
}
