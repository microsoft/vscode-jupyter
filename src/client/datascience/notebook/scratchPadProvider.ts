// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { inject, injectable } from 'inversify';
import { CancellationToken, WebviewView, WebviewViewResolveContext } from 'vscode';
import { IWebviewViewProvider, IWorkspaceService } from '../../common/application/types';
import { IConfigurationService, IDisposableRegistry } from '../../common/types';
import { ICodeCssGenerator, IThemeFinder } from '../types';
import { INotebookWatcher, IScratchPadProvider } from './types';
import { ScratchPad } from './scratchPad';

// This class creates our UI for our variable view and links it to the vs code webview view
@injectable()
export class ScratchPadProvider implements IScratchPadProvider {
    public readonly viewType = 'jupyterScratchPad';
    private scratchPad?: ScratchPad;

    constructor(
        @inject(IConfigurationService) private readonly configuration: IConfigurationService,
        @inject(ICodeCssGenerator) private readonly cssGenerator: ICodeCssGenerator,
        @inject(IThemeFinder) private readonly themeFinder: IThemeFinder,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IWebviewViewProvider) private readonly webviewViewProvider: IWebviewViewProvider,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(INotebookWatcher) private readonly notebookWatcher: INotebookWatcher
    ) {}

    public async resolveWebviewView(
        webviewView: WebviewView,
        _context: WebviewViewResolveContext,
        _token: CancellationToken
    ): Promise<void> {
        webviewView.webview.options = { enableScripts: true };

        // Create our actual variable view
        this.scratchPad = new ScratchPad(
            this.configuration,
            this.cssGenerator,
            this.themeFinder,
            this.workspaceService,
            this.webviewViewProvider,
            this.disposables,
            this.notebookWatcher
        );

        await this.scratchPad.load(webviewView);
    }
}
