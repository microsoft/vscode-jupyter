// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../extensions';

import { Uri, WebviewOptions, WebviewView as vscodeWebviewView } from 'vscode';

import { IFileSystem } from '../../platform/types';
import { IDisposableRegistry } from '../../types';
import { IWebviewView, IWebviewViewOptions } from '../types';
import { Webview } from '../webviews/webview';

export class WebviewView extends Webview implements IWebviewView {
    constructor(
        fs: IFileSystem,
        disposableRegistry: IDisposableRegistry,
        private panelOptions: IWebviewViewOptions,
        additionalRootPaths: Uri[] = []
    ) {
        super(fs, disposableRegistry, panelOptions, additionalRootPaths);
    }

    protected createWebview(_webviewOptions: WebviewOptions): vscodeWebviewView {
        throw new Error('Webview Views must be passed in an initial view');
    }

    protected postLoad(webviewHost: vscodeWebviewView) {
        // Reset when the current panel is closed
        this.disposableRegistry.push(
            webviewHost.onDidDispose(() => {
                this.webviewHost = undefined;
                this.panelOptions.listener.dispose().ignoreErrors();
            })
        );

        this.disposableRegistry.push(
            webviewHost.webview.onDidReceiveMessage((message) => {
                // Pass the message onto our listener
                this.panelOptions.listener.onMessage(message.type, message.payload);
            })
        );
    }
}
