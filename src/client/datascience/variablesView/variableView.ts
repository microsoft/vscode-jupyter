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
import { IConfigurationService, IDisposable, Resource } from '../../common/types';
import { InteractiveWindowMessages } from '../../datascience/interactive-common/interactiveWindowTypes';
import {
    ICodeCssGenerator,
    IJupyterVariables,
    IJupyterVariablesRequest,
    INotebookEditorProvider,
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
        @unmanaged() private readonly notebookEditorProvider: INotebookEditorProvider
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

    // This is called when the UI side requests new variable data
    //private async requestVariables(args: IJupyterVariablesRequest): Promise<void> {
    //// For now, this just returns a fake variable that we can display in the UI
    //const response: IJupyterVariablesResponse = {
    //totalCount: 1,
    //pageResponse: [
    //{
    //name: 'test',
    //value: 'testing',
    //executionCount: args?.executionCount,
    //supportsDataExplorer: false,
    //type: 'string',
    //size: 1,
    //shape: '(1, 1)',
    //count: 1,
    //truncated: false
    //}
    //],
    //pageStartIndex: args?.startIndex,
    //executionCount: args?.executionCount,
    //refreshCount: args?.refreshCount || 0
    //};

    //this.postMessage(InteractiveWindowMessages.GetVariablesResponse, response).ignoreErrors();
    //}

    private async requestVariables(args: IJupyterVariablesRequest): Promise<void> {
        // Test to see if we can hook up to the active notebook
        // Need to test for only native notebooks here?
        if (this.notebookEditorProvider.activeEditor && this.notebookEditorProvider.activeEditor.notebook) {
            const response = await this.variables.getVariables(args, this.notebookEditorProvider.activeEditor.notebook);

            this.postMessage(InteractiveWindowMessages.GetVariablesResponse, response).ignoreErrors(); // Trace errors here?
        }
    }
}
