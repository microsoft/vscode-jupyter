// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri, WebviewView as vscodeWebviewView } from 'vscode';

import { WebviewHost } from './webviewHost';
import {
    IWebviewView,
    IWebviewViewMessageListener,
    IWorkspaceService,
    IWebviewViewProvider,
    IWebview
} from '../common/application/types';
import { IConfigurationService, IDisposable, Resource } from '../common/types';
import { IJupyterExtraSettings } from './types';

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
        protected override configService: IConfigurationService,
        protected override workspaceService: IWorkspaceService,
        messageListenerCtor: (
            callback: (message: string, payload: {}) => void,
            disposed: () => void
        ) => IWebviewViewMessageListener,
        protected provider: IWebviewViewProvider,
        rootPath: Uri,
        scripts: Uri[]
    ) {
        super(configService, workspaceService, rootPath, scripts);

        // Create our message listener for our web panel.
        this.messageListener = messageListenerCtor(this.onMessage.bind(this), this.dispose.bind(this));
    }

    protected async provideWebview(
        cwd: Uri,
        settings: IJupyterExtraSettings,
        workspaceFolder: Resource,
        vscodeWebview?: vscodeWebviewView
    ): Promise<IWebview> {
        if (!vscodeWebview) {
            throw new Error('WebviewViews must be passed an initial VS Code Webview');
        }
        return this.provider.create({
            additionalPaths: workspaceFolder ? [workspaceFolder] : [],
            rootPath: this.rootPath,
            cwd,
            listener: this.messageListener,
            scripts: this.scripts,
            settings,
            webviewHost: vscodeWebview
        });
    }
}
