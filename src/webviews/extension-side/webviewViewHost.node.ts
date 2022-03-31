// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../platform/common/extensions';

import { WebviewView as vscodeWebviewView } from 'vscode';

import { WebviewHost } from './webviewHost.node';
import {
    IWebviewView,
    IWebviewViewMessageListener,
    IWorkspaceService,
    IWebviewViewProvider,
    IWebview
} from '../../platform/common/application/types';
import { IConfigurationService, IDisposable, Resource } from '../../platform/common/types';
import { ICodeCssGenerator, IThemeFinder, IJupyterExtraSettings } from './types';

export abstract class WebviewViewHost<IMapping> extends WebviewHost<IMapping> implements IDisposable {
    protected get isDisposed(): boolean {
        return this.disposed;
    }

    // Just a small helper for derived classes to access the webviewView instead of having to cast the base webview property
    protected get webviewView(): IWebviewView | undefined {
        return this.webview && (this.webview as IWebviewView);
    }

    private messageListener: IWebviewViewMessageListener;

    constructor(
        protected configService: IConfigurationService,
        cssGenerator: ICodeCssGenerator,
        protected themeFinder: IThemeFinder,
        protected workspaceService: IWorkspaceService,
        messageListenerCtor: (
            callback: (message: string, payload: {}) => void,
            disposed: () => void
        ) => IWebviewViewMessageListener,
        protected provider: IWebviewViewProvider,
        rootPath: string,
        scripts: string[]
    ) {
        super(configService, cssGenerator, themeFinder, workspaceService, rootPath, scripts);

        // Create our message listener for our web panel.
        this.messageListener = messageListenerCtor(this.onMessage.bind(this), this.dispose.bind(this));
    }

    protected async provideWebview(
        cwd: string,
        settings: IJupyterExtraSettings,
        workspaceFolder: Resource,
        vscodeWebview?: vscodeWebviewView
    ): Promise<IWebview> {
        if (!vscodeWebview) {
            throw new Error('WebviewViews must be passed an initial VS Code Webview');
        }
        return this.provider.create({
            additionalPaths: workspaceFolder ? [workspaceFolder.fsPath] : [],
            rootPath: this.rootPath,
            cwd,
            listener: this.messageListener,
            scripts: this.scripts,
            settings,
            webviewHost: vscodeWebview
        });
    }
}
