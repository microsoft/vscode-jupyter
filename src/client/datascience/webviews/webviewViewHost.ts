// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../common/extensions';

import { injectable, unmanaged } from 'inversify';
import { WebviewView as vscodeWebviewView } from 'vscode';

import {
    IWebview,
    IWebviewViewMessageListener,
    IWebviewViewProvider,
    IWorkspaceService
} from '../../common/application/types';
import { IConfigurationService, IDisposable, Resource } from '../../common/types';
import { ICodeCssGenerator, IJupyterExtraSettings, IThemeFinder } from '../types';
import { WebviewHost } from './webviewHost';

@injectable() // For some reason this is necessary to get the class hierarchy to work.
export abstract class WebviewViewHost<IMapping> extends WebviewHost<IMapping> implements IDisposable {
    protected get isDisposed(): boolean {
        return this.disposed;
    }
    private messageListener: IWebviewViewMessageListener;

    constructor(
        @unmanaged() protected configService: IConfigurationService,
        @unmanaged() cssGenerator: ICodeCssGenerator,
        @unmanaged() protected themeFinder: IThemeFinder,
        @unmanaged() protected workspaceService: IWorkspaceService,
        @unmanaged()
        messageListenerCtor: (
            callback: (message: string, payload: {}) => void,
            disposed: () => void
        ) => IWebviewViewMessageListener,
        @unmanaged() protected provider: IWebviewViewProvider,
        @unmanaged() rootPath: string,
        @unmanaged() scripts: string[]
    ) {
        super(configService, cssGenerator, themeFinder, workspaceService, rootPath, scripts, true);

        // Create our message listener for our web panel.
        this.messageListener = messageListenerCtor(this.onMessage.bind(this), this.dispose.bind(this));
    }

    protected shareMessage<M extends IMapping, T extends keyof M>(type: T, payload?: M[T]) {
        // Send our remote message.
        this.messageListener.onMessage(type.toString(), payload);
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
