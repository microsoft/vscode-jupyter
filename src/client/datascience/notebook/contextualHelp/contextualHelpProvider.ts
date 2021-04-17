// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { inject, injectable } from 'inversify';
import { CancellationToken, WebviewView, WebviewViewResolveContext } from 'vscode';
import {
    IWorkspaceService,
    IWebviewViewProvider,
    IVSCodeNotebook,
    ICommandManager,
    IDocumentManager
} from '../../../common/application/types';
import { IConfigurationService, IDisposableRegistry } from '../../../common/types';
import { IServiceContainer } from '../../../ioc/types';
import { KernelSelector } from '../../jupyter/kernels/kernelSelector';
import { IKernelProvider } from '../../jupyter/kernels/types';
import { INotebookStorageProvider } from '../../notebookStorage/notebookStorageProvider';
import {
    ICodeCssGenerator,
    IContextualHelp,
    IJupyterServerUriStorage,
    INotebookProvider,
    IStatusProvider,
    IThemeFinder
} from '../../types';
import { IContextualHelpProvider } from '../types';
import { ContextualHelp } from './contextualHelp';

// This class creates our UI for our variable view and links it to the vs code webview view
@injectable()
export class ContextualHelpProvider implements IContextualHelpProvider {
    public readonly viewType = 'jupyterContextualHelp';
    private _contextualHelp?: ContextualHelp;

    constructor(@inject(IServiceContainer) private serviceContainer: IServiceContainer) {}

    public async resolveWebviewView(
        webviewView: WebviewView,
        _context: WebviewViewResolveContext,
        _token: CancellationToken
    ): Promise<void> {
        webviewView.webview.options = { enableScripts: true, enableCommandUris: true };

        // Create our actual variable view
        this._contextualHelp = new ContextualHelp(
            this.serviceContainer.get<IConfigurationService>(IConfigurationService),
            this.serviceContainer.get<ICodeCssGenerator>(ICodeCssGenerator),
            this.serviceContainer.get<IThemeFinder>(IThemeFinder),
            this.serviceContainer.get<IWorkspaceService>(IWorkspaceService),
            this.serviceContainer.get<IWebviewViewProvider>(IWebviewViewProvider),
            this.serviceContainer.get<IDisposableRegistry>(IDisposableRegistry),
            this.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook),
            this.serviceContainer.get<IStatusProvider>(IStatusProvider),
            this.serviceContainer.get<INotebookProvider>(INotebookProvider),
            this.serviceContainer.get<INotebookStorageProvider>(INotebookStorageProvider),
            this.serviceContainer.get<IJupyterServerUriStorage>(IJupyterServerUriStorage),
            this.serviceContainer.get<KernelSelector>(KernelSelector),
            this.serviceContainer.get<ICommandManager>(ICommandManager),
            this.serviceContainer.get<IKernelProvider>(IKernelProvider),
            this.serviceContainer.get<IDocumentManager>(IDocumentManager)
        );

        await this._contextualHelp.load(webviewView);
    }

    public get contextualHelp(): IContextualHelp | undefined {
        return this._contextualHelp;
    }
}
