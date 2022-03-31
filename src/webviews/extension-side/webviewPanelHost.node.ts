// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../platform/common/extensions';

import { ViewColumn, WebviewPanel as vscodeWebviewPanel } from 'vscode';

import { WebviewHost } from './webviewHost.node';
import {
    IWebviewPanel,
    IWebviewPanelMessageListener,
    IWebviewPanelProvider,
    IWorkspaceService,
    IWebview
} from '../../platform/common/application/types';
import { IConfigurationService, IDisposable, Resource } from '../../platform/common/types';
import { ICodeCssGenerator, IThemeFinder, WebViewViewChangeEventArgs, IJupyterExtraSettings } from './types';

export abstract class WebviewPanelHost<IMapping> extends WebviewHost<IMapping> implements IDisposable {
    protected get isDisposed(): boolean {
        return this.disposed;
    }
    protected get webPanel(): IWebviewPanel | undefined {
        if (!this.webview) {
            return undefined;
        }

        return this.webview as IWebviewPanel;
    }
    protected viewState: { visible: boolean; active: boolean } = { visible: false, active: false };
    private messageListener: IWebviewPanelMessageListener;

    constructor(
        protected configService: IConfigurationService,
        private provider: IWebviewPanelProvider,
        cssGenerator: ICodeCssGenerator,
        protected themeFinder: IThemeFinder,
        protected workspaceService: IWorkspaceService,
        messageListenerCtor: (
            callback: (message: string, payload: {}) => void,
            viewChanged: (panel: IWebviewPanel) => void,
            disposed: () => void
        ) => IWebviewPanelMessageListener,
        rootPath: string,
        scripts: string[],
        private _title: string,
        private viewColumn: ViewColumn
    ) {
        super(configService, cssGenerator, themeFinder, workspaceService, rootPath, scripts);

        // Create our message listener for our web panel.
        this.messageListener = messageListenerCtor(
            this.onMessage.bind(this),
            this.webPanelViewStateChanged.bind(this),
            this.dispose.bind(this)
        );
    }

    public async show(preserveFocus: boolean): Promise<void> {
        if (!this.isDisposed) {
            // Then show our web panel.
            if (this.webPanel) {
                await this.webPanel.show(preserveFocus);
            }
        }
    }

    public updateCwd(cwd: string): void {
        if (this.webPanel) {
            this.webPanel.updateCwd(cwd);
        }
    }

    public dispose() {
        if (!this.isDisposed) {
            if (this.webPanel) {
                this.webPanel.close();
            }
        }

        super.dispose();
    }
    public get title() {
        return this._title;
    }

    public setTitle(newTitle: string) {
        this._title = newTitle;
        if (!this.isDisposed && this.webPanel) {
            this.webPanel.setTitle(newTitle);
        }
    }

    protected onViewStateChanged(_args: WebViewViewChangeEventArgs) {
        // Nothing to do here
    }

    protected async provideWebview(
        cwd: string,
        settings: IJupyterExtraSettings,
        workspaceFolder: Resource,
        vscodeWebview?: vscodeWebviewPanel
    ): Promise<IWebview> {
        // Use this script to create our web view panel. It should contain all of the necessary
        // script to communicate with this class.
        return this.provider.create({
            viewColumn: this.viewColumn,
            listener: this.messageListener,
            title: this.title,
            rootPath: this.rootPath,
            scripts: this.scripts,
            settings,
            cwd,
            webviewHost: vscodeWebview,
            additionalPaths: workspaceFolder ? [workspaceFolder.fsPath] : []
        });
    }

    private webPanelViewStateChanged = (webPanel: IWebviewPanel) => {
        const visible = webPanel.isVisible();
        const active = webPanel.isActive();
        const current = { visible, active };
        const previous = { visible: this.viewState.visible, active: this.viewState.active };
        this.viewState.visible = visible;
        this.viewState.active = active;
        this.onViewStateChanged({ current, previous });
    };
}
