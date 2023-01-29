// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Uri, ViewColumn, WebviewOptions, WebviewPanel as vscodeWebviewPanel, window } from 'vscode';
import { IWebviewPanel, IWebviewPanelOptions, IWebviewPanelProvider } from '../common/application/types';
import { IFileSystem } from '../common/platform/types';
import { IDisposableRegistry, IExtensionContext } from '../common/types';
import * as path from '../vscode-path/path';
import { Webview } from './webview';

class WebviewPanel extends Webview implements IWebviewPanel {
    private get panel(): vscodeWebviewPanel | undefined {
        return this.webviewHost as vscodeWebviewPanel;
    }

    private get panelOptions(): IWebviewPanelOptions {
        return this.options as IWebviewPanelOptions;
    }

    constructor(
        fs: IFileSystem,
        disposableRegistry: IDisposableRegistry,
        context: IExtensionContext,
        panelOptions: IWebviewPanelOptions,
        additionalRootPaths: Uri[] = []
    ) {
        super(fs, disposableRegistry, context, panelOptions, additionalRootPaths);
    }

    public async show(preserveFocus: boolean) {
        await this.loadPromise;
        if (!this.panel) {
            return;
        }

        if (preserveFocus) {
            if (!this.panel.visible) {
                this.panel.reveal(this.panel.viewColumn, preserveFocus);
            }
        } else {
            if (!this.panel.active) {
                this.panel.reveal(this.panel.viewColumn, preserveFocus);
            }
        }
    }

    public close() {
        if (this.panel) {
            this.panel.dispose();
        }
    }

    public get viewColumn(): ViewColumn | undefined {
        return this.panel?.viewColumn;
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

@injectable()
export class WebviewPanelProvider implements IWebviewPanelProvider {
    constructor(
        @inject(IDisposableRegistry) private readonly disposableRegistry: IDisposableRegistry,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IExtensionContext) private readonly context: IExtensionContext
    ) {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public async create(options: IWebviewPanelOptions): Promise<IWebviewPanel> {
        // Allow loading resources from the `<extension folder>/tmp` folder when in webiviews.
        // Used by widgets to place files that are not otherwise accessible.
        const additionalRootPaths = [Uri.file(path.join(this.context.extensionPath, 'tmp'))];
        if (Array.isArray(options.additionalPaths)) {
            additionalRootPaths.push(...options.additionalPaths);
        }
        return new WebviewPanel(this.fs, this.disposableRegistry, this.context, options, additionalRootPaths);
    }
}
