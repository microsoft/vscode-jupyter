// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../common/extensions';

import { injectable, unmanaged } from 'inversify';
import * as path from 'path';
import { WebviewView as vscodeWebviewView } from 'vscode';

import { IApplicationShell, IWebviewViewProvider, IWorkspaceService } from '../../common/application/types';
import { EXTENSION_ROOT_DIR } from '../../common/constants';
import { traceError } from '../../common/logger';
import { IConfigurationService, IDisposable, IDisposableRegistry, Resource } from '../../common/types';
import * as localize from '../../common/utils/localize';
import {
    InteractiveWindowMessages,
    IShowDataViewer
} from '../../datascience/interactive-common/interactiveWindowTypes';
import { sendTelemetryEvent } from '../../telemetry';
import { Telemetry } from '../constants';
import { IDataViewerFactory } from '../data-viewing/types';
import { DataViewerChecker } from '../interactive-common/dataViewerChecker';
import {
    ICodeCssGenerator,
    IJupyterVariableDataProviderFactory,
    IJupyterVariables,
    IJupyterVariablesRequest,
    INotebook,
    IThemeFinder
} from '../types';
import { WebviewViewHost } from '../webviews/webviewViewHost';
import { INotebookWatcher, IVariableViewPanelMapping } from './types';
import { VariableViewMessageListener } from './variableViewMessageListener';

const variableViewDir = path.join(EXTENSION_ROOT_DIR, 'out', 'datascience-ui', 'viewers');

// This is the client side host for the native notebook variable view webview
// It handles passing messages to and from the react view as well as the connection
// to execution and changing of the active notebook
@injectable()
export class VariableView extends WebviewViewHost<IVariableViewPanelMapping> implements IDisposable {
    private dataViewerChecker: DataViewerChecker;
    protected get owningResource(): Resource {
        return undefined;
    }
    constructor(
        @unmanaged() configuration: IConfigurationService,
        @unmanaged() cssGenerator: ICodeCssGenerator,
        @unmanaged() themeFinder: IThemeFinder,
        @unmanaged() workspaceService: IWorkspaceService,
        @unmanaged() provider: IWebviewViewProvider,
        @unmanaged() private readonly variables: IJupyterVariables,
        @unmanaged() private readonly disposables: IDisposableRegistry,
        @unmanaged() private readonly appShell: IApplicationShell,
        @unmanaged() private readonly jupyterVariableDataProviderFactory: IJupyterVariableDataProviderFactory,
        @unmanaged() private readonly dataViewerFactory: IDataViewerFactory,
        @unmanaged() private readonly notebookWatcher: INotebookWatcher
    ) {
        super(
            configuration,
            cssGenerator,
            themeFinder,
            workspaceService,
            (c, d) => new VariableViewMessageListener(c, d),
            provider,
            variableViewDir,
            [path.join(variableViewDir, 'commons.initial.bundle.js'), path.join(variableViewDir, 'variableView.js')]
        );

        // Sign up if the active variable view notebook is changed or updated
        this.notebookWatcher.onDidExecuteActiveVariableViewNotebook(
            this.activeNotebookExecuted,
            this,
            this.disposables
        );

        this.notebookWatcher.onDidChangeActiveVariableViewNotebook(this.activeNotebookChanged, this, this.disposables);

        this.dataViewerChecker = new DataViewerChecker(configuration, appShell);
    }

    public async load(codeWebview: vscodeWebviewView) {
        await super.loadWebview(process.cwd(), codeWebview).catch(traceError);
    }

    // Used to identify this webview in telemetry, not shown to user so no localization
    // for webview views
    public get title(): string {
        return 'variableView';
    }

    //tslint:disable-next-line:no-any
    protected onMessage(message: string, payload: any) {
        switch (message) {
            case InteractiveWindowMessages.GetVariablesRequest:
                this.handleMessage(message, payload, this.requestVariables);
                break;
            case InteractiveWindowMessages.ShowDataViewer:
                this.handleMessage(message, payload, this.showDataViewer);
                break;
            default:
                break;
        }

        super.onMessage(message, payload);
    }

    // Handle message helper function to specifically handle our message mapping type
    protected handleMessage<M extends IVariableViewPanelMapping, T extends keyof M>(
        _message: T,
        // tslint:disable-next-line:no-any
        payload: any,
        handler: (args: M[T]) => void
    ) {
        const args = payload as M[T];
        handler.bind(this)(args);
    }

    // Handle a request from the react UI to show our data viewer
    private async showDataViewer(request: IShowDataViewer): Promise<void> {
        try {
            if (
                this.notebookWatcher.activeVariableViewNotebook &&
                (await this.dataViewerChecker.isRequestedColumnSizeAllowed(request.columnSize, this.owningResource))
            ) {
                // Create a variable data provider and pass it to the data viewer factory to create the data viewer
                const jupyterVariableDataProvider = await this.jupyterVariableDataProviderFactory.create(
                    request.variable,
                    this.notebookWatcher.activeVariableViewNotebook
                );
                const title: string = `${localize.DataScience.dataExplorerTitle()} - ${request.variable.name}`;
                await this.dataViewerFactory.create(jupyterVariableDataProvider, title);
            }
        } catch (e) {
            traceError(e);
            sendTelemetryEvent(Telemetry.FailedShowDataViewer);
            this.appShell.showErrorMessage(localize.DataScience.showDataViewerFail());
        }
    }

    // Variables for the current active editor are being requested, check that we have a valid active notebook
    // and use the variables interface to fetch them and pass them to the variable view UI
    private async requestVariables(args: IJupyterVariablesRequest): Promise<void> {
        if (this.notebookWatcher.activeVariableViewNotebook) {
            const response = await this.variables.getVariables(args, this.notebookWatcher.activeVariableViewNotebook);

            this.postMessage(InteractiveWindowMessages.GetVariablesResponse, response).ignoreErrors();
        }
    }

    // The active variable view notebook has executed a new cell so update the execution count in the variable view
    private async activeNotebookExecuted(args: { executionCount: number }) {
        this.postMessage(InteractiveWindowMessages.UpdateVariableViewExecutionCount, {
            executionCount: args.executionCount
        }).ignoreErrors();
    }

    // The active variable new notebook has changed, so force a refresh on the view to pick up the new info
    private async activeNotebookChanged(_notebook: INotebook | undefined) {
        this.postMessage(InteractiveWindowMessages.ForceVariableRefresh).ignoreErrors();
    }
}
