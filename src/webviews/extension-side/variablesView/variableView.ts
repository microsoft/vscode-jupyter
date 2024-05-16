// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri, WebviewView as vscodeWebviewView, window } from 'vscode';
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
import { IWebviewViewProvider } from '../../../platform/common/application/types';
import { ContextKey } from '../../../platform/common/contextKey';
import { logger } from '../../../platform/logging';
import {
    Resource,
    IConfigurationService,
    IDisposableRegistry,
    IDisposable,
    IExtensionContext,
    IExperimentService,
    Experiments
} from '../../../platform/common/types';
import { WebviewViewHost } from '../../../platform/webviews/webviewViewHost';
import { swallowExceptions } from '../../../platform/common/utils/decorators';
import { noop } from '../../../platform/common/utils/misc';
import { DataViewerDelegator } from '../dataviewer/dataViewerDelegator';

// This is the client side host for the native notebook variable view webview
// It handles passing messages to and from the react view as well as the connection
// to execution and changing of the active notebook
export class VariableView extends WebviewViewHost<IVariableViewPanelMapping> implements IDisposable {
    protected get owningResource(): Resource {
        return undefined;
    }
    constructor(
        configuration: IConfigurationService,
        provider: IWebviewViewProvider,
        context: IExtensionContext,
        private readonly variables: IJupyterVariables,
        private readonly disposables: IDisposableRegistry,
        private readonly notebookWatcher: INotebookWatcher,
        private readonly experiments: IExperimentService,
        private readonly dataViewerDelegator: DataViewerDelegator
    ) {
        const variableViewDir = joinPath(context.extensionUri, 'dist', 'webviews', 'webview-side', 'viewers');
        super(configuration, (c, d) => new VariableViewMessageListener(c, d), provider, variableViewDir, [
            joinPath(variableViewDir, 'variableView.js')
        ]);

        // Sign up if the active variable view notebook is changed, restarted or updated
        this.notebookWatcher.onDidFinishExecutingActiveNotebook(this.activeNotebookExecuted, this, this.disposables);
        this.notebookWatcher.onDidChangeActiveNotebook(this.activeNotebookChanged, this, this.disposables);
        this.notebookWatcher.onDidRestartActiveNotebook(this.activeNotebookRestarted, this, this.disposables);
        this.variables.refreshRequired(this.sendRefreshMessage, this, this.disposables);
        window.onDidChangeActiveTextEditor(this.activeTextEditorChanged, this, this.disposables);
    }

    @capturePerfTelemetry(Telemetry.NativeVariableViewLoaded)
    public async load(codeWebview: vscodeWebviewView) {
        await super.loadWebview(Uri.file(process.cwd()), codeWebview).catch(logger.error);

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
        const context = new ContextKey('jupyter.variableViewVisible');
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
    public async showDataViewer(request: IShowDataViewer) {
        request.variable.fileName = request.variable.fileName ?? this.notebookWatcher.activeKernel?.notebook.uri;
        return this.dataViewerDelegator.showContributedDataViewer(request.variable);
    }

    private postProcessSupportsDataExplorer(response: IJupyterVariablesResponse) {
        const variableViewers = this.dataViewerDelegator.getVariableViewers();
        response.pageResponse.forEach((variable) => {
            if (this.experiments.inExperiment(Experiments.DataViewerContribution)) {
                variable.supportsDataExplorer = variableViewers.some((d) =>
                    d.jupyterVariableViewers.dataTypes.includes(variable.type)
                );
            }
        });

        return response;
    }

    // Variables for the current active editor are being requested, check that we have a valid active notebook
    // and use the variables interface to fetch them and pass them to the variable view UI
    @swallowExceptions()
    private async requestVariables(args: IJupyterVariablesRequest): Promise<void> {
        const activeNotebook = this.notebookWatcher.activeKernel;
        if (activeNotebook) {
            const response = await this.variables.getVariables(args, activeNotebook);

            this.postMessage(
                InteractiveWindowMessages.GetVariablesResponse,
                this.postProcessSupportsDataExplorer(response)
            ).catch(noop);
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
