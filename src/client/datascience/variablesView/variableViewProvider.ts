// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { inject, injectable, named } from 'inversify';
import { CancellationToken, WebviewView, WebviewViewResolveContext } from 'vscode';
import { IApplicationShell, IWebviewViewProvider, IWorkspaceService } from '../../common/application/types';
import { isTestExecution } from '../../common/constants';
import { IConfigurationService, IDisposableRegistry } from '../../common/types';
import { createDeferred, Deferred } from '../../common/utils/async';
import { Identifiers } from '../constants';
import { IDataViewerFactory } from '../data-viewing/types';
import { ICodeCssGenerator, IJupyterVariableDataProviderFactory, IJupyterVariables, IThemeFinder } from '../types';
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
        @inject(ICodeCssGenerator) private readonly cssGenerator: ICodeCssGenerator,
        @inject(IThemeFinder) private readonly themeFinder: IThemeFinder,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IWebviewViewProvider) private readonly webviewViewProvider: IWebviewViewProvider,
        @inject(IJupyterVariables) @named(Identifiers.ALL_VARIABLES) private variables: IJupyterVariables,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IJupyterVariableDataProviderFactory)
        private readonly jupyterVariableDataProviderFactory: IJupyterVariableDataProviderFactory,
        @inject(IDataViewerFactory) private readonly dataViewerFactory: IDataViewerFactory,
        @inject(INotebookWatcher) private readonly notebookWatcher: INotebookWatcher
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
            this.cssGenerator,
            this.themeFinder,
            this.workspaceService,
            this.webviewViewProvider,
            this.variables,
            this.disposables,
            this.appShell,
            this.jupyterVariableDataProviderFactory,
            this.dataViewerFactory,
            this.notebookWatcher
        );

        // If someone is waiting for the variable view resolve that here
        if (this.activeVariableViewPromise) {
            this.activeVariableViewPromise.resolve(this.variableView);
        }

        await this.variableView.load(webviewView);
    }
}
