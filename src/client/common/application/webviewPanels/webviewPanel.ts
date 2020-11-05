// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../extensions';

import { Uri, WebviewOptions, WebviewPanel as vscodeWebviewPanel, window } from 'vscode';
import { IFileSystem } from '../../platform/types';
import { IDisposableRegistry } from '../../types';
import { IWebviewPanel, IWebviewPanelOptions } from '../types';
import { Webview } from '../webviews/webview';

export class WebviewPanel extends Webview implements IWebviewPanel {
    //private panel: vscodeWebviewPanel | undefined;
    //private loadPromise: Promise<void>;

    private get panel(): vscodeWebviewPanel | undefined {
        return this.webviewHost as vscodeWebviewPanel;
    }

    private get panelOptions(): IWebviewPanelOptions {
        return this.options as IWebviewPanelOptions;
    }

    constructor(
        fs: IFileSystem,
        disposableRegistry: IDisposableRegistry,
        panelOptions: IWebviewPanelOptions,
        additionalRootPaths: Uri[] = []
    ) {
        super(fs, disposableRegistry, panelOptions, additionalRootPaths);
    }

    public async show(preserveFocus: boolean) {
        await this.loadPromise;
        if (this.panel) {
            this.panel.reveal(this.panel.viewColumn, preserveFocus);
        }
    }

    public updateCwd(_cwd: string) {
        // See issue https://github.com/microsoft/vscode-python/issues/8933 for implementing this.
    }

    public close() {
        if (this.panel) {
            this.panel.dispose();
        }
    }

    public isVisible(): boolean {
        return this.panel ? this.panel.visible : false;
    }

    public isActive(): boolean {
        return this.panel ? this.panel.active : false;
    }

    public setTitle(newTitle: string) {
        this.panelOptions.title = newTitle;
        if (this.panel) {
            this.panel.title = newTitle;
        }
    }

    protected createWebview(webviewOptions: WebviewOptions): vscodeWebviewPanel {
        return window.createWebviewPanel(
            this.panelOptions.title.toLowerCase().replace(' ', ''),
            this.panelOptions.title,
            { viewColumn: this.panelOptions.viewColumn, preserveFocus: true },
            {
                retainContextWhenHidden: true,
                enableFindWidget: true,
                ...webviewOptions
            }
        );
    }

    protected postLoad(webviewHost: vscodeWebviewPanel) {
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
            webviewHost.onDidChangeViewState((_e) => {
                // Pass the state change onto our listener
                this.panelOptions.listener.onChangeViewState(this);
            })
        );

        // Set initial state
        this.panelOptions.listener.onChangeViewState(this);
    }
}
