// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../common/extensions';

import { inject, injectable, unmanaged } from 'inversify';
import * as path from 'path';
import { WebviewView as vscodeWebviewView } from 'vscode';

import {
    IApplicationShell,
    IWebviewPanelProvider,
    IWebviewViewProvider,
    IWorkspaceService
} from '../../common/application/types';
import { EXTENSION_ROOT_DIR, UseCustomEditorApi } from '../../common/constants';
import { traceError } from '../../common/logger';
import { IConfigurationService, IDisposable, Resource } from '../../common/types';
import { ICodeCssGenerator, IThemeFinder } from '../types';
import { WebviewViewHost } from '../webviews/webviewViewHost';
import { IVariableViewMapping } from './types';
import { VariableViewMessageListener } from './variableViewMessageListener';

const variableViewDir = path.join(EXTENSION_ROOT_DIR, 'out', 'datascience-ui', 'viewers');

@injectable()
export class VariableView extends WebviewViewHost<IVariableViewMapping> implements IDisposable {
    constructor(
        @unmanaged() configuration: IConfigurationService,
        @unmanaged() cssGenerator: ICodeCssGenerator,
        @unmanaged() themeFinder: IThemeFinder,
        @unmanaged() workspaceService: IWorkspaceService,
        @unmanaged() provider: IWebviewViewProvider,
        private readonly codeWebview: vscodeWebviewView // If we save this here and use it with show, then remove from constructor?
    ) {
        super(
            configuration,
            cssGenerator,
            themeFinder,
            workspaceService,
            (c, d) => new VariableViewMessageListener(c, d),
            provider,
            variableViewDir,
            [path.join(variableViewDir, 'commons.initial.bundle.js'), path.join(variableViewDir, 'variableView.js')],
            codeWebview
        );
    }

    // IANHU: Have this? Or part of the WebviewViewHost class?
    public async load() {
        await super.loadWebPanel(process.cwd(), this.codeWebview).catch(traceError);
    }

    //tslint:disable-next-line:no-any
    protected onMessage(message: string, payload: any) {
        switch (message) {
            default:
                break;
        }

        super.onMessage(message, payload);
    }

    protected get owningResource(): Resource {
        return undefined;
    }
}
