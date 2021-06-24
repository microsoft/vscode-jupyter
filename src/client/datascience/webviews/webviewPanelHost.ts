// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../common/extensions';

import * as fsextra from 'fs-extra';
import * as path from 'path';
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
import { serializeLanguageConfiguration } from '../interactive-common/serialization';
import { traceInfo, traceWarning } from '../../common/logger';
import { EXTENSION_ROOT_DIR, PYTHON_LANGUAGE } from '../../common/constants';
import { InteractiveWindowMessages } from '../interactive-common/interactiveWindowTypes';

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
        @unmanaged() protected readonly useCustomEditorApi: boolean
    ) {
        super(configService, cssGenerator, themeFinder, workspaceService, rootPath, scripts, useCustomEditorApi);

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

    protected async requestTmLanguage(languageId: string = PYTHON_LANGUAGE) {
        // Get the contents of the appropriate tmLanguage file.
        traceInfo('Request for tmlanguage file.');
        const languageJson = await this.themeFinder.findTmLanguage(languageId);
        const languageConfiguration = serializeLanguageConfiguration(
            await this.themeFinder.findLanguageConfiguration(languageId)
        );
        const extensions = languageId === PYTHON_LANGUAGE ? ['.py'] : [];
        const scopeName = `scope.${languageId}`; // This works for python, not sure about c# etc.
        this.postMessageInternal(InteractiveWindowMessages.LoadTmLanguageResponse, {
            languageJSON: languageJson ?? '',
            languageConfiguration,
            extensions,
            scopeName,
            languageId
        }).ignoreErrors();
    }

    protected async requestOnigasm(): Promise<void> {
        // Look for the file next or our current file (this is where it's installed in the vsix)
        let filePath = path.join(__dirname, 'node_modules', 'onigasm', 'lib', 'onigasm.wasm');
        traceInfo(`Request for onigasm file at ${filePath}`);
        if (await fsextra.pathExists(filePath)) {
            const contents = await fsextra.readFile(filePath);
            this.postMessageInternal(InteractiveWindowMessages.LoadOnigasmAssemblyResponse, contents).ignoreErrors();
        } else {
            // During development it's actually in the node_modules folder
            filePath = path.join(EXTENSION_ROOT_DIR, 'node_modules', 'onigasm', 'lib', 'onigasm.wasm');
            traceInfo(`Backup request for onigasm file at ${filePath}`);
            if (await fsextra.pathExists(filePath)) {
                const contents = await fsextra.readFile(filePath);
                this.postMessageInternal(
                    InteractiveWindowMessages.LoadOnigasmAssemblyResponse,
                    contents
                ).ignoreErrors();
            } else {
                traceWarning('Onigasm file not found. Colorization will not be available.');
                this.postMessageInternal(InteractiveWindowMessages.LoadOnigasmAssemblyResponse).ignoreErrors();
            }
        }
    }
}
