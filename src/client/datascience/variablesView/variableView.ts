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
import { IFileSystem } from '../../common/platform/types';
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
import { KernelState, KernelStateEventArgs } from '../notebookExtensibility';
import {
    ICodeCssGenerator,
    IJupyterVariableDataProviderFactory,
    IJupyterVariables,
    IJupyterVariablesRequest,
    INotebook,
    INotebookEditor,
    INotebookEditorProvider,
    INotebookExtensibility,
    IThemeFinder
} from '../types';
import { WebviewViewHost } from '../webviews/webviewViewHost';
import { IVariableViewNotebookWatcher, IVariableViewPanelMapping } from './types';
import { VariableViewMessageListener } from './variableViewMessageListener';

const variableViewDir = path.join(EXTENSION_ROOT_DIR, 'out', 'datascience-ui', 'viewers');

// This is the client side host for the native notebook variable view webview
// It handles passing messages to and from the react view as well as tracking
// code execution changes and active editor switches
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
        @unmanaged() private readonly notebookEditorProvider: INotebookEditorProvider,
        @unmanaged() private readonly notebookExtensibility: INotebookExtensibility,
        @unmanaged() private readonly disposables: IDisposableRegistry,
        @unmanaged() private readonly appShell: IApplicationShell,
        @unmanaged() private readonly jupyterVariableDataProviderFactory: IJupyterVariableDataProviderFactory,
        @unmanaged() private readonly dataViewerFactory: IDataViewerFactory,
        @unmanaged() private readonly fileSystem: IFileSystem,
        @unmanaged() private readonly variableViewNotebookWatcher: IVariableViewNotebookWatcher
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

        // We need to know if kernel state changes or if the active notebook editor is changed
        //this.notebookExtensibility.onKernelStateChange(this.kernelStateChanged, this, this.disposables);
        //this.notebookEditorProvider.onDidChangeActiveNotebookEditor(this.activeEditorChanged, this, this.disposables);
        this.variableViewNotebookWatcher.onDidExecuteActiveVariableViewNotebook(
            this.activeNotebookExecuted,
            this,
            this.disposables
        );

        this.variableViewNotebookWatcher.onDidChangeActiveVariableViewNotebook(
            this.activeNotebookChanged,
            this,
            this.disposables
        );

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
            //if (
            //this.notebookEditorProvider.activeEditor &&
            //this.notebookEditorProvider.activeEditor.notebook &&
            //(await this.dataViewerChecker.isRequestedColumnSizeAllowed(request.columnSize, this.owningResource))
            //) {
            if (
                this.variableViewNotebookWatcher.activeVariableViewNotebook &&
                (await this.dataViewerChecker.isRequestedColumnSizeAllowed(request.columnSize, this.owningResource))
            ) {
                // Create a variable data provider and pass it to the data viewer factory to create the data viewer
                const jupyterVariableDataProvider = await this.jupyterVariableDataProviderFactory.create(
                    request.variable,
                    this.variableViewNotebookWatcher.activeVariableViewNotebook
                    //this.notebookEditorProvider.activeEditor.notebook
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

    // Variables for the current active editor are being requested, check that we have a valid active editor
    // and use the variables interface to fetch them and pass them to the variable view UI
    private async requestVariables(args: IJupyterVariablesRequest): Promise<void> {
        //if (this.notebookEditorProvider.activeEditor && this.notebookEditorProvider.activeEditor.notebook) {
        if (this.variableViewNotebookWatcher.activeVariableViewNotebook) {
            //const response = await this.variables.getVariables(args, this.notebookEditorProvider.activeEditor.notebook);
            const response = await this.variables.getVariables(
                args,
                this.variableViewNotebookWatcher.activeVariableViewNotebook
            );

            this.postMessage(InteractiveWindowMessages.GetVariablesResponse, response).ignoreErrors();
        }
    }

    private async activeNotebookExecuted(args: { executionCount: number }) {
        this.postMessage(InteractiveWindowMessages.UpdateVariableViewExecutionCount, {
            executionCount: args.executionCount
        }).ignoreErrors();
    }

    private async activeNotebookChanged(_notebook: INotebook | undefined) {
        // When the active editor changes we want to force a refresh of variables
        this.postMessage(InteractiveWindowMessages.ForceVariableRefresh).ignoreErrors();
    }

    // When the kernel state is changed we need to see if it's a cell from the active document that finished execution
    // If so update the execution count on the variable view to refresh variables
    private async kernelStateChanged(kernelStateEvent: KernelStateEventArgs) {
        // Check for non-silent executes from the current cell that have an execution order
        if (
            kernelStateEvent.state === KernelState.executed &&
            kernelStateEvent.cell &&
            kernelStateEvent.cell.metadata.executionOrder &&
            kernelStateEvent.silent !== true
        ) {
            // We only want to update the variable view execution count when it's the active document executing
            if (
                this.notebookEditorProvider.activeEditor &&
                this.fileSystem.arePathsSame(this.notebookEditorProvider.activeEditor.file, kernelStateEvent.resource)
            ) {
                this.postMessage(InteractiveWindowMessages.UpdateVariableViewExecutionCount, {
                    executionCount: kernelStateEvent.cell.metadata.executionOrder
                }).ignoreErrors();
            }
        }
    }

    private async activeEditorChanged(_editor: INotebookEditor | undefined) {
        // When the active editor changes we want to force a refresh of variables
        this.postMessage(InteractiveWindowMessages.ForceVariableRefresh).ignoreErrors();
    }
}
