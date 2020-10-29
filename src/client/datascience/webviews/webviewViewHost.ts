// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../common/extensions';

import { injectable, unmanaged } from 'inversify';
import { Uri, ViewColumn, WebviewView as vscodeWebviewView } from 'vscode';

import {
    IWebviewPanelProvider,
    IWebviewView,
    IWebviewViewMessageListener,
    IWebviewViewProvider,
    IWorkspaceService
} from '../../common/application/types';
import { traceInfo } from '../../common/logger';
import { IConfigurationService, IDisposable } from '../../common/types';
import { createDeferred } from '../../common/utils/async';
import { noop } from '../../common/utils/misc';
import { StopWatch } from '../../common/utils/stopWatch';
import { sendTelemetryEvent } from '../../telemetry';
import { Telemetry } from '../constants';
import { SharedMessages } from '../messages';
import { ICodeCssGenerator, IThemeFinder, WebViewViewChangeEventArgs } from '../types';
import { WebviewHost } from './webviewHost';

@injectable() // For some reason this is necessary to get the class hierarchy to work.
export abstract class WebviewViewHost<IMapping> extends WebviewHost<IMapping> implements IDisposable {
    protected get isDisposed(): boolean {
        return this.disposed;
    }
    private webView: IWebviewView | undefined;
    //private messageListener: IWebviewViewMessageListener;
    private startupStopwatch = new StopWatch();

    constructor(
        @unmanaged() protected configService: IConfigurationService,
        @unmanaged() cssGenerator: ICodeCssGenerator,
        @unmanaged() protected themeFinder: IThemeFinder,
        @unmanaged() protected workspaceService: IWorkspaceService,
        @unmanaged() protected provider: IWebviewViewProvider,
        codeWebview: vscodeWebviewView
        //@unmanaged() //messageListenerCtor: ( //callback: (message: string, payload: {}) => void, //viewChanged: (panel: IWebviewView) => void, //disposed: () => void
    ) //) => IWebviewViewMessageListener,
    //@unmanaged() protected readonly useCustomEditorApi: boolean,
    //@unmanaged() enableVariablesDuringDebugging: Promise<boolean>
    {
        // IANHU: Add back in message handlers and config options
        super(configService, cssGenerator, themeFinder, workspaceService, true, Promise.resolve(true));

        // Create our message listener for our web panel.
        //this.messageListener = messageListenerCtor(
        //this.onMessage.bind(this),
        //this.webPanelViewStateChanged.bind(this),
        //this.dispose.bind(this)
        //);
    }

    public dispose() {
        if (!this.isDisposed) {
            this.disposed = true;
        }

        super.dispose();
    }
    public get title() {
        // IANHU: Needed in this class?
        return 'Testing';
        //return this._title;
    }

    //tslint:disable-next-line:no-any
    protected onMessage(message: string, payload: any) {
        switch (message) {
            case SharedMessages.Started:
                this.webViewRendered();
                break;

            default:
                // Forward unhandled messages to the base class
                super.onMessage(message, payload);
                break;
        }
    }

    protected shareMessage<M extends IMapping, T extends keyof M>(type: T, payload?: M[T]) {
        // Send our remote message.
        //this.messageListener.onMessage(type.toString(), payload);
    }

    protected onViewStateChanged(_args: WebViewViewChangeEventArgs) {
        noop();
    }

    // IANHU: Rename / move to base class?
    protected async loadWebPanel(cwd: string, webviewView?: vscodeWebviewView) {
        // Make not disposed anymore
        this.disposed = false;

        // Setup our init promise for the webview view. We use this to make sure we're in sync with our
        // react control.
        this.webviewInit = this.webviewInit || createDeferred();

        // Setup a promise that will wait until the webview passes back
        // a message telling us what them is in use
        this.themeIsDarkPromise = this.themeIsDarkPromise ? this.themeIsDarkPromise : createDeferred<boolean>();

        // Load our actual web panel

        traceInfo(`Loading webview view. View is ${this.webView ? 'set' : 'notset'}`);

        // Create our webview view
        if (this.webView === undefined) {
            // Get our settings to pass along to the react control
            const settings = await this.generateDataScienceExtraSettings();

            traceInfo('Loading web view...');

            const workspaceFolder = this.workspaceService.getWorkspaceFolder(Uri.file(cwd))?.uri;

            // Use this script to create our web view panel. It should contain all of the necessary
            // script to communicate with this class.
            //this.webPanel = await this.provider.create({
            //viewColumn: this.viewColumn,
            //listener: this.messageListener,
            //title: this.title,
            //rootPath: this.rootPath,
            //scripts: this.scripts,
            //settings,
            //cwd,
            //webViewPanel,
            //additionalPaths: workspaceFolder ? [workspaceFolder.fsPath] : []
            //});

            // Set our webview after load
            //this.webview = this.webPanel;

            // Track if the load of our webview fails
            // IANHU: We still need this
            //this._disposables.push(this.webView.loadFailed(this.onWebViewLoadFailed, this));

            traceInfo('Web view created.');
        }

        // Send the first settings message
        this.onDataScienceSettingsChanged().ignoreErrors();

        // Send the loc strings (skip during testing as it takes up a lot of memory)
        this.sendLocStrings().ignoreErrors();
    }

    private onWebViewLoadFailed = async () => {
        this.dispose();
    };

    // tslint:disable-next-line:no-any
    private webViewRendered() {
        if (this.webviewInit && !this.webviewInit.resolved) {
            // Send telemetry for startup
            sendTelemetryEvent(Telemetry.WebviewStartup, this.startupStopwatch.elapsedTime, { type: this.title });

            // Resolve our started promise. This means the webpanel is ready to go.
            this.webviewInit.resolve();

            traceInfo('Web view react rendered');
        }

        // On started, resend our init data.
        this.sendLocStrings().ignoreErrors();
        this.onDataScienceSettingsChanged().ignoreErrors();
    }
}
