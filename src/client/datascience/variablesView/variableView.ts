// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../common/extensions';

import { injectable, unmanaged } from 'inversify';
import * as path from 'path';
import { WebviewView as vscodeWebviewView } from 'vscode';

import { IWebviewViewProvider, IWorkspaceService } from '../../common/application/types';
import { EXTENSION_ROOT_DIR } from '../../common/constants';
import { traceError } from '../../common/logger';
import { IConfigurationService, IDisposable, IDisposableRegistry, Resource } from '../../common/types';
import { InteractiveWindowMessages } from '../../datascience/interactive-common/interactiveWindowTypes';
import { KernelState, KernelStateEventArgs } from '../notebookExtensibility';
import {
    ICodeCssGenerator,
    IJupyterVariables,
    IJupyterVariablesRequest,
    INotebookEditorProvider,
    INotebookExecutionLogger,
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
        @unmanaged() private readonly disposables: IDisposableRegistry
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

    private async requestVariables(args: IJupyterVariablesRequest): Promise<void> {
        // Test to see if we can hook up to the active notebook
        // Need to test for only native notebooks here?
        if (this.notebookEditorProvider.activeEditor && this.notebookEditorProvider.activeEditor.notebook) {
            const response = await this.variables.getVariables(args, this.notebookEditorProvider.activeEditor.notebook);

            this.postMessage(InteractiveWindowMessages.GetVariablesResponse, response).ignoreErrors(); // Trace errors here?
        }
    }

    // Called when the kernel state is changed. Need to inform the UI that something has executed
    // Maybe just use INotebookExecutionLogger directly since we convert to ICell?
    private async kernelStateChanged(kernelStateEvent: KernelStateEventArgs) {
        if (
            kernelStateEvent.state === KernelState.executed &&
            kernelStateEvent.cell &&
            kernelStateEvent.cell.metadata.executionOrder &&
            kernelStateEvent.silent !== true
        ) {
            // IANHU: Just use a message to update execution count? Not the entire cell?
            //this.postMessage(InteractiveWindowMessages.FinishCell, {});
            this.postMessage(InteractiveWindowMessages.UpdateVariableViewExecutionCount, {
                executionCount: kernelStateEvent.cell.metadata.executionOrder
            }).ignoreErrors();
        }
    }
}
