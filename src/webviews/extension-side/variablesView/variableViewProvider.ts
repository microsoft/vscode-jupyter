// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { CancellationToken, WebviewView, WebviewViewResolveContext } from 'vscode';
import { IJupyterVariables } from '../../../kernels/variables/types';
import {
    IWorkspaceService,
    IWebviewViewProvider,
    IApplicationShell,
    ICommandManager,
    IDocumentManager
} from '../../../platform/common/application/types';
import { Identifiers, isTestExecution } from '../../../platform/common/constants';
import { IConfigurationService, IDisposableRegistry, IExtensionContext } from '../../../platform/common/types';
import { createDeferred, Deferred } from '../../../platform/common/utils/async';
import { IJupyterVariableDataProviderFactory, IDataViewerFactory } from '../dataviewer/types';
import { INotebookWatcher, IVariableViewProvider } from './types';
import { VariableView } from './variableView';

// This class creates our UI for our variable view and links it to the vs code webview view
@injectable()
export class VariableViewProvider implements IVariableViewProvider {
    public readonly viewType = 'jupyterViewVariables';

    // Either return the active variable view or wait until it's created and return it
    // @ts-ignore Property will be accessed in test code via casting to ITestVariableViewProviderInterface
    private get activeVariableView(): Promise<VariableView> {
        if (!isTestExecution()) {
            throw new Error('activeVariableView only for test code');
        }
        // If we have already created the view, then just return it
        if (this.variableView) {
            return Promise.resolve(this.variableView);
        }

        // If not wait until created and then return
        this.activeVariableViewPromise = createDeferred<VariableView>();
        return this.activeVariableViewPromise.promise;
    }
    private activeVariableViewPromise?: Deferred<VariableView>;

    private variableView?: VariableView;

    constructor(
        @inject(IConfigurationService) private readonly configuration: IConfigurationService,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IWebviewViewProvider) private readonly webviewViewProvider: IWebviewViewProvider,
        @inject(IExtensionContext) private readonly context: IExtensionContext,
        @inject(IJupyterVariables) @named(Identifiers.ALL_VARIABLES) private variables: IJupyterVariables,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IJupyterVariableDataProviderFactory)
        private readonly jupyterVariableDataProviderFactory: IJupyterVariableDataProviderFactory,
        @inject(IDataViewerFactory) private readonly dataViewerFactory: IDataViewerFactory,
        @inject(INotebookWatcher) private readonly notebookWatcher: INotebookWatcher,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IDocumentManager) private readonly documentManager: IDocumentManager
    ) {}

    public async resolveWebviewView(
        webviewView: WebviewView,
        _context: WebviewViewResolveContext,
        _token: CancellationToken
    ): Promise<void> {
        webviewView.webview.options = { enableScripts: true };

        // Create our actual variable view
        this.variableView = new VariableView(
            this.configuration,
            this.workspaceService,
            this.webviewViewProvider,
            this.context,
            this.variables,
            this.disposables,
            this.appShell,
            this.jupyterVariableDataProviderFactory,
            this.dataViewerFactory,
            this.notebookWatcher,
            this.commandManager,
            this.documentManager
        );

        // If someone is waiting for the variable view resolve that here
        if (this.activeVariableViewPromise) {
            this.activeVariableViewPromise.resolve(this.variableView);
        }

        await this.variableView.load(webviewView);
    }
}
