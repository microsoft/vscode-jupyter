// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri, WebviewView as vscodeWebviewView } from 'vscode';
import { joinPath } from '../../../platform/vscode-path/resources';
import { capturePerfTelemetry, sendTelemetryEvent, Telemetry } from '../../../telemetry';
import { INotebookWatcher, IVariableViewPanelMapping } from './types';
import { VariableViewMessageListener } from './variableViewMessageListener';
import { InteractiveWindowMessages, IShowDataViewer } from '../../../messageTypes';
import {
    IJupyterVariables,
    IJupyterVariablesRequest,
    IJupyterVariablesResponse
} from '../../../kernels/variables/types';
import {
    IWorkspaceService,
    IWebviewViewProvider,
    IApplicationShell,
    ICommandManager,
    IDocumentManager
} from '../../../platform/common/application/types';
import { ContextKey } from '../../../platform/common/contextKey';
import { traceError } from '../../../platform/logging';
import {
    Resource,
    IConfigurationService,
    IDisposableRegistry,
    IDisposable,
    IExtensionContext
} from '../../../platform/common/types';
import * as localize from '../../../platform/common/utils/localize';
import { DataViewerChecker } from '../dataviewer/dataViewerChecker';
import { IJupyterVariableDataProviderFactory, IDataViewerFactory, IDataViewer } from '../dataviewer/types';
import { WebviewViewHost } from '../../../platform/webviews/webviewViewHost';
import { swallowExceptions } from '../../../platform/common/utils/decorators';
import { noop } from '../../../platform/common/utils/misc';

// This is the client side host for the native notebook variable view webview
// It handles passing messages to and from the react view as well as the connection
// to execution and changing of the active notebook
export class VariableView extends WebviewViewHost<IVariableViewPanelMapping> implements IDisposable {
    private dataViewerChecker: DataViewerChecker;
    protected get owningResource(): Resource {
        return undefined;
    }
    constructor(
        configuration: IConfigurationService,
        workspaceService: IWorkspaceService,
        provider: IWebviewViewProvider,
        context: IExtensionContext,
        private readonly variables: IJupyterVariables,
        private readonly disposables: IDisposableRegistry,
        private readonly appShell: IApplicationShell,
        private readonly jupyterVariableDataProviderFactory: IJupyterVariableDataProviderFactory,
        private readonly dataViewerFactory: IDataViewerFactory,
        private readonly notebookWatcher: INotebookWatcher,
        private readonly commandManager: ICommandManager,
        private readonly documentManager: IDocumentManager
    ) {
        const variableViewDir = joinPath(context.extensionUri, 'out', 'webviews', 'webview-side', 'viewers');
        super(
            configuration,
            workspaceService,
            (c, d) => new VariableViewMessageListener(c, d),
            provider,
            variableViewDir,
            [joinPath(variableViewDir, 'variableView.js')]
        );

        // Sign up if the active variable view notebook is changed, restarted or updated
        this.notebookWatcher.onDidFinishExecutingActiveNotebook(this.activeNotebookExecuted, this, this.disposables);
        this.notebookWatcher.onDidChangeActiveNotebook(this.activeNotebookChanged, this, this.disposables);
        this.notebookWatcher.onDidRestartActiveNotebook(this.activeNotebookRestarted, this, this.disposables);
        this.variables.refreshRequired(this.sendRefreshMessage, this, this.disposables);
        this.documentManager.onDidChangeActiveTextEditor(this.activeTextEditorChanged, this, this.disposables);

        this.dataViewerChecker = new DataViewerChecker(configuration, appShell);
    }

    @capturePerfTelemetry(Telemetry.NativeVariableViewLoaded)
    public async load(codeWebview: vscodeWebviewView) {
        await super.loadWebview(Uri.file(process.cwd()), codeWebview).catch(traceError);

        // After loading, hook up our visibility watch and check the initial visibility
        if (this.webviewView) {
            this.disposables.push(
                this.webviewView.onDidChangeVisibility(() => {
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
    protected override onMessage(message: string, payload: any) {
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
        context.set(visible).catch(noop);

        // I've we've been made visible, make sure that we are updated
        if (visible) {
            sendTelemetryEvent(Telemetry.NativeVariableViewMadeVisible);
            // If there is an active execution count, update the view with that info
            // Keep the variables up to date if document has run cells while the view was not visible
            if (this.notebookWatcher.activeNotebookExecutionCount !== undefined) {
                this.postMessage(InteractiveWindowMessages.UpdateVariableViewExecutionCount, {
                    executionCount: this.notebookWatcher.activeNotebookExecutionCount
                }).catch(noop);
            } else {
                // No active view, so just trigger refresh to clear
                this.postMessage(InteractiveWindowMessages.ForceVariableRefresh).catch(noop);
            }
        }
    }

    // Handle a request from the react UI to show our data viewer. Public for testing
    @swallowExceptions()
    public async showDataViewer(request: IShowDataViewer): Promise<IDataViewer | undefined> {
        try {
            if (
                this.notebookWatcher.activeKernel &&
                (await this.dataViewerChecker.isRequestedColumnSizeAllowed(request.columnSize, this.owningResource))
            ) {
                // Create a variable data provider and pass it to the data viewer factory to create the data viewer
                const jupyterVariableDataProvider = await this.jupyterVariableDataProviderFactory.create(
                    request.variable,
                    this.notebookWatcher.activeKernel
                );
                const title: string = `${localize.DataScience.dataExplorerTitle} - ${request.variable.name}`;
                return await this.dataViewerFactory.create(jupyterVariableDataProvider, title);
            }
        } catch (e) {
            traceError(e);
            sendTelemetryEvent(Telemetry.FailedShowDataViewer);
            this.appShell.showErrorMessage(localize.DataScience.showDataViewerFail).then(noop, noop);
        }
    }

    // Variables for the current active editor are being requested, check that we have a valid active notebook
    // and use the variables interface to fetch them and pass them to the variable view UI
    @swallowExceptions()
    private async requestVariables(args: IJupyterVariablesRequest): Promise<void> {
        const activeNotebook = this.notebookWatcher.activeKernel;
        if (activeNotebook) {
            const response = await this.variables.getVariables(args, activeNotebook);

            this.postMessage(InteractiveWindowMessages.GetVariablesResponse, response).catch(noop);
            sendTelemetryEvent(Telemetry.VariableExplorerVariableCount, {
                variableCount: response.totalCount
            });
        } else {
            // If there isn't an active notebook or interactive window, clear the variables
            const response: IJupyterVariablesResponse = {
                executionCount: args.executionCount,
                pageStartIndex: -1,
                pageResponse: [],
                totalCount: 0,
                refreshCount: args.refreshCount
            };

            this.postMessage(InteractiveWindowMessages.GetVariablesResponse, response).catch(noop);
        }
    }

    // The active variable view notebook has executed a new cell so update the execution count in the variable view
    private async activeNotebookExecuted(args: { executionCount: number }) {
        this.postMessage(InteractiveWindowMessages.UpdateVariableViewExecutionCount, {
            executionCount: args.executionCount
        }).catch(noop);
    }

    // The active variable new notebook has changed, so force a refresh on the view to pick up the new info
    private async activeNotebookChanged(arg: { executionCount?: number }) {
        if (arg.executionCount) {
            this.postMessage(InteractiveWindowMessages.UpdateVariableViewExecutionCount, {
                executionCount: arg.executionCount
            }).catch(noop);
        } else {
            this.postMessage(InteractiveWindowMessages.UpdateVariableViewExecutionCount, {
                executionCount: 0
            }).catch(noop);
        }

        this.postMessage(InteractiveWindowMessages.ForceVariableRefresh).catch(noop);
    }

    // Active text editor changed. Editor may not be associated with a notebook
    private activeTextEditorChanged() {
        this.postMessage(InteractiveWindowMessages.ForceVariableRefresh).catch(noop);
    }

    private async activeNotebookRestarted() {
        this.postMessage(InteractiveWindowMessages.RestartKernel).catch(noop);
    }

    private async sendRefreshMessage() {
        this.postMessage(InteractiveWindowMessages.ForceVariableRefresh).catch(noop);
    }
}
