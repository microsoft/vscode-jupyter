// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { inject, injectable } from 'inversify';
import { CancellationToken, Webview, WebviewView, WebviewViewResolveContext } from 'vscode';
import { IApplicationShell, IWorkspaceService } from '../../common/application/types';
import { IConfigurationService } from '../../common/types';
import { ICodeCssGenerator, IThemeFinder } from '../types';
import { IVariableViewProvider } from './types';
import { VariableView } from './variableView';

// IANHU: Service wrapping around this? Not fully sure
@injectable()
export class VariableViewProvider implements IVariableViewProvider {
    //public resolveWebviewView(
    //webviewView: WebviewView,
    //context: WebviewViewResolveContext,
    //_token: CancellationToken
    //) {}
    public readonly viewType: string = 'jupyterViewVariables';

    private view?: WebviewView;
    private variableView?: VariableView;

    constructor(
        @inject(IConfigurationService) private readonly configuration: IConfigurationService,
        @inject(ICodeCssGenerator) private readonly cssGenerator: ICodeCssGenerator,
        @inject(IThemeFinder) private readonly themeFinder: IThemeFinder,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService
    ) {}

    public resolveWebviewView(
        webviewView: WebviewView,
        _context: WebviewViewResolveContext,
        _token: CancellationToken
    ): Thenable<void> | void {
        // IANHU: Need view?
        this.view = webviewView;

        // IANHU: Check options
        webviewView.webview.options = { enableScripts: true };

        // Create our actual variable view
        this.variableView = new VariableView(
            this.configuration,
            this.cssGenerator,
            this.themeFinder,
            this.workspaceService
        );

        //webviewView.webview.html = this.getHtml(this.view.webview);
    }

    //private getHtml(webview: Webview) {
    //const nonce = getNonce();

    //return `<!DOCTYPE html>
    //<html lang="en">
    //<head>
    //<meta charset="UTF-8">
    //<!--
    //Use a content security policy to only allow loading images from https or from our extension directory,
    //and only allow scripts that have a specific nonce.
    //-->
    //<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    //<meta name="viewport" content="width=device-width, initial-scale=1.0">

    //<title>Variables</title>
    //</head>
    //<body>
    //<ul class="color-list">
    //</ul>
    //<button class="add-color-button">Add Color</button>
    //</body>
    //</html>`;
    //}
}
