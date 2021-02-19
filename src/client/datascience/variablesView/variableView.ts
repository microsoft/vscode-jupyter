// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../common/extensions';

import { injectable, unmanaged } from 'inversify';
import * as path from 'path';
import { WebviewView as vscodeWebviewView } from 'vscode';

import {
    IApplicationShell,
    ICommandManager,
    IWebviewViewProvider,
    IWorkspaceService
} from '../../common/application/types';
import { EXTENSION_ROOT_DIR } from '../../common/constants';
import { traceError } from '../../common/logger';
import { IConfigurationService, IDisposable, IDisposableRegistry, Resource } from '../../common/types';
import * as localize from '../../common/utils/localize';
import {
    InteractiveWindowMessages,
    IShowDataViewer
} from '../../datascience/interactive-common/interactiveWindowTypes';
import { captureTelemetry, sendTelemetryEvent } from '../../telemetry';
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
import { ContextKey } from '../../common/contextKey';

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
        @unmanaged() private readonly notebookWatcher: INotebookWatcher,
        @unmanaged() private readonly commandManager: ICommandManager
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

        // Sign up if the active variable view notebook is changed, restarted or updated
        this.notebookWatcher.onDidExecuteActiveNotebook(this.activeNotebookExecuted, this, this.disposables);
        this.notebookWatcher.onDidChangeActiveNotebook(this.activeNotebookChanged, this, this.disposables);
        this.notebookWatcher.onDidRestartActiveNotebook(this.activeNotebookRestarted, this, this.disposables);

        this.dataViewerChecker = new DataViewerChecker(configuration, appShell);
    }

    @captureTelemetry(Telemetry.NativeVariableViewLoaded)
    public async load(codeWebview: vscodeWebviewView) {
        await super.loadWebview(process.cwd(), codeWebview).catch(traceError);

        // After loading, hook up our visibility watch and check the initial visibility
        if (this.webviewView) {
            this.disposables.push(
                this.webviewView.onDidChangeVisiblity(() => {
                    this.handleVisibilityChanged();
                })
            );
        }
        this.handleVisibilityChanged();
    }

    // Used to identify this webview in telemetry, not shown to user so no localization
    // for webview views
    public get title(): string {
        return 'variableView';
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payload: any,
        handler: (args: M[T]) => void
    ) {
        const args = payload as M[T];
        handler.bind(this)(args);
    }

    // Variable view visibility has changed. Update our context key for command enable / disable
    private handleVisibilityChanged() {
        const context = new ContextKey('jupyter.variableViewVisible', this.commandManager);
        let visible = false;
        if (this.webviewView) {
            visible = this.webviewView.visible;
        }
        context.set(visible).ignoreErrors();

        // I've we've been made visible, make sure that we are updated
        if (visible) {
            sendTelemetryEvent(Telemetry.NativeVariableViewMadeVisible);
            // If there is an active execution count, update the view with that info
            // Keep the variables up to date if document has run cells while the view was not visible
            if (this.notebookWatcher.activeNotebookExecutionCount !== undefined) {
                this.postMessage(InteractiveWindowMessages.UpdateVariableViewExecutionCount, {
                    executionCount: this.notebookWatcher.activeNotebookExecutionCount
                }).ignoreErrors();
            } else {
                // No active view, so just trigger refresh to clear
                this.postMessage(InteractiveWindowMessages.ForceVariableRefresh).ignoreErrors();
            }
        }
    }

    // Handle a request from the react UI to show our data viewer
    private async showDataViewer(request: IShowDataViewer): Promise<void> {
        try {
            if (
                this.notebookWatcher.activeNotebook &&
                (await this.dataViewerChecker.isRequestedColumnSizeAllowed(request.columnSize, this.owningResource))
            ) {
                // Create a variable data provider and pass it to the data viewer factory to create the data viewer
                const jupyterVariableDataProvider = await this.jupyterVariableDataProviderFactory.create(
                    request.variable,
                    this.notebookWatcher.activeNotebook
                );
                const title: string = `${localize.DataScience.dataExplorerTitle()} - ${request.variable.name}`;
                await this.dataViewerFactory.create(jupyterVariableDataProvider, title);
            }
        } catch (e) {
            traceError(e);
            sendTelemetryEvent(Telemetry.FailedShowDataViewer);
            void this.appShell.showErrorMessage(localize.DataScience.showDataViewerFail());
        }
    }

    // Variables for the current active editor are being requested, check that we have a valid active notebook
    // and use the variables interface to fetch them and pass them to the variable view UI
    private async requestVariables(args: IJupyterVariablesRequest): Promise<void> {
        if (this.notebookWatcher.activeNotebook) {
            const response = await this.variables.getVariables(args, this.notebookWatcher.activeNotebook);

            this.postMessage(InteractiveWindowMessages.GetVariablesResponse, response).ignoreErrors();
            sendTelemetryEvent(Telemetry.VariableExplorerVariableCount, undefined, {
                variableCount: response.totalCount
            });
        }
    }

    // The active variable view notebook has executed a new cell so update the execution count in the variable view
    private async activeNotebookExecuted(args: { executionCount: number }) {
        this.postMessage(InteractiveWindowMessages.UpdateVariableViewExecutionCount, {
            executionCount: args.executionCount
        }).ignoreErrors();
    }

    // The active variable new notebook has changed, so force a refresh on the view to pick up the new info
    private async activeNotebookChanged(arg: { notebook?: INotebook; executionCount?: number }) {
        if (arg.executionCount) {
            this.postMessage(InteractiveWindowMessages.UpdateVariableViewExecutionCount, {
                executionCount: arg.executionCount
            }).ignoreErrors();
        } else {
            this.postMessage(InteractiveWindowMessages.UpdateVariableViewExecutionCount, {
                executionCount: 0
            }).ignoreErrors();
        }

        this.postMessage(InteractiveWindowMessages.ForceVariableRefresh).ignoreErrors();
    }

    private async activeNotebookRestarted() {
        this.postMessage(InteractiveWindowMessages.RestartKernel).ignoreErrors();
    }
}
