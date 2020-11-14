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
import { ICodeCssGenerator, IJupyterVariablesRequest, IJupyterVariablesResponse, IThemeFinder } from '../types';
import { WebviewViewHost } from '../webviews/webviewViewHost';
import { IVariableViewPanelMapping } from './types';
import { VariableViewMessageListener } from './variableViewMessageListener';

const variableViewDir = path.join(EXTENSION_ROOT_DIR, 'out', 'datascience-ui', 'viewers');

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
        @unmanaged() provider: IWebviewViewProvider
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
        this.postMessage(InteractiveWindowMessages.ForceVariableRefresh).ignoreErrors();
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
        // Request our new list of variables
        const response: IJupyterVariablesResponse = {
            totalCount: 1,
            pageResponse: [
                {
                    name: 'test',
                    value: 'testing',
                    executionCount: args?.executionCount,
                    supportsDataExplorer: false,
                    type: 'string',
                    size: 1,
                    shape: '(1, 1)',
                    count: 1,
                    truncated: false
                }
            ],
            pageStartIndex: args?.startIndex,
            executionCount: args?.executionCount,
            refreshCount: args?.refreshCount || 0
        };

        this.postMessage(InteractiveWindowMessages.GetVariablesResponse, response).ignoreErrors();
        //sendTelemetryEvent(Telemetry.VariableExplorerVariableCount, undefined, { variableCount: response.totalCount });
    }
}
