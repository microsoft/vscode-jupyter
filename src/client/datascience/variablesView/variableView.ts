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
import { IDataViewerFactory } from '../data-viewing/types';
import { DataViewerChecker } from '../interactive-common/dataViewerChecker';
import { KernelState, KernelStateEventArgs } from '../notebookExtensibility';
import {
    ICodeCssGenerator,
    IJupyterVariableDataProviderFactory,
    IJupyterVariables,
    IJupyterVariablesRequest,
    INotebookEditor,
    INotebookEditorProvider,
    //INotebookExecutionLogger,
    INotebookExtensibility,
    IThemeFinder
} from '../types';
import { WebviewViewHost } from '../webviews/webviewViewHost';
import { IVariableViewPanelMapping } from './types';
import { VariableViewMessageListener } from './variableViewMessageListener';

const variableViewDir = path.join(EXTENSION_ROOT_DIR, 'out', 'datascience-ui', 'viewers');

// This is the client side host for the native notebook variable view webview
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
        @unmanaged() private readonly dataViewerFactory: IDataViewerFactory
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
        this.notebookExtensibility.onKernelStateChange(this.kernelStateChanged, this, this.disposables);
        this.notebookEditorProvider.onDidChangeActiveNotebookEditor(this.activeEditorChanged, this, this.disposables);

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

    private async showDataViewer(request: IShowDataViewer): Promise<void> {
        try {
            if (
                this.notebookEditorProvider.activeEditor &&
                this.notebookEditorProvider.activeEditor.notebook &&
                (await this.dataViewerChecker.isRequestedColumnSizeAllowed(request.columnSize, this.owningResource))
            ) {
                const jupyterVariableDataProvider = await this.jupyterVariableDataProviderFactory.create(
                    request.variable,
                    this.notebookEditorProvider.activeEditor.notebook
                );
                const title: string = `${localize.DataScience.dataExplorerTitle()} - ${request.variable.name}`;
                await this.dataViewerFactory.create(jupyterVariableDataProvider, title);
            }
        } catch (e) {
            traceError(e);
            this.appShell.showErrorMessage(e.toString());
        }
    }

    private async requestVariables(args: IJupyterVariablesRequest): Promise<void> {
        // Test to see if we can hook up to the active notebook
        // Need to test for only native notebooks here?
        if (this.notebookEditorProvider.activeEditor && this.notebookEditorProvider.activeEditor.notebook) {
            const response = await this.variables.getVariables(args, this.notebookEditorProvider.activeEditor.notebook);

            this.postMessage(InteractiveWindowMessages.GetVariablesResponse, response).ignoreErrors(); // Trace errors here?
        }
    }

    // When the kernel state is change we need to see if it's a cell from the active document that finished execution
    // If so update the execution count on the variable view to refresh variables
    private async kernelStateChanged(kernelStateEvent: KernelStateEventArgs) {
        if (
            kernelStateEvent.state === KernelState.executed &&
            kernelStateEvent.cell &&
            kernelStateEvent.cell.metadata.executionOrder &&
            kernelStateEvent.silent !== true
        ) {
            // We only want to update the variable view execution count when it's the active document executing
            if (
                this.notebookEditorProvider.activeEditor &&
                this.notebookEditorProvider.activeEditor.file.toString() === kernelStateEvent.resource.toString()
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
