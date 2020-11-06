// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../common/extensions';

import { injectable, unmanaged } from 'inversify';
import { ViewColumn, WebviewPanel as vscodeWebviewPanel } from 'vscode';

import {
    IWebview,
    IWebviewPanel,
    IWebviewPanelMessageListener,
    IWebviewPanelProvider,
    IWorkspaceService
} from '../../common/application/types';
import { IConfigurationService, IDisposable, Resource } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { ICodeCssGenerator, IJupyterExtraSettings, IThemeFinder, WebViewViewChangeEventArgs } from '../types';
import { WebviewHost } from './webviewHost';

@injectable() // For some reason this is necessary to get the class hierarchy to work.
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
        @unmanaged() protected configService: IConfigurationService,
        @unmanaged() private provider: IWebviewPanelProvider,
        @unmanaged() cssGenerator: ICodeCssGenerator,
        @unmanaged() protected themeFinder: IThemeFinder,
        @unmanaged() protected workspaceService: IWorkspaceService,
        @unmanaged()
        messageListenerCtor: (
            callback: (message: string, payload: {}) => void,
            viewChanged: (panel: IWebviewPanel) => void,
            disposed: () => void
        ) => IWebviewPanelMessageListener,
        @unmanaged() rootPath: string,
        @unmanaged() scripts: string[],
        @unmanaged() private _title: string,
        @unmanaged() private viewColumn: ViewColumn,
        @unmanaged() protected readonly useCustomEditorApi: boolean,
        @unmanaged() enableVariablesDuringDebugging: Promise<boolean>
    ) {
        super(
            configService,
            cssGenerator,
            themeFinder,
            workspaceService,
            rootPath,
            scripts,
            useCustomEditorApi,
            enableVariablesDuringDebugging
        );

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

    protected shareMessage<M extends IMapping, T extends keyof M>(type: T, payload?: M[T]) {
        // Send our remote message.
        this.messageListener.onMessage(type.toString(), payload);
    }

    protected onViewStateChanged(_args: WebViewViewChangeEventArgs) {
        noop();
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
