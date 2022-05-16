// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { Event, EventEmitter, Uri, WebviewOptions, WebviewView as vscodeWebviewView } from 'vscode';
import { IWebviewView, IWebviewViewOptions } from '../../../platform/common/application/types';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { IDisposableRegistry } from '../../../platform/common/types';
import { Webview } from '../webviews/webview.node';

export class WebviewView extends Webview implements IWebviewView {
    public get visible(): boolean {
        if (!this.webviewHost) {
            return false;
        } else {
            return this.webviewHost.visible;
        }
    }
    public get onDidChangeVisiblity(): Event<void> {
        return this._onDidChangeVisibility.event;
    }
    private readonly _onDidChangeVisibility = new EventEmitter<void>();
    constructor(
        fs: IFileSystemNode,
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

        this.disposableRegistry.push(
            webviewHost.onDidChangeVisibility(() => {
                this._onDidChangeVisibility.fire();
            })
        );

        // Fire one inital visibility change once now as we have loaded
        this._onDidChangeVisibility.fire();
    }
}
