// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../extensions';

import { Uri, Webview as vscodeWebview, WebviewOptions, WebviewView as vscodeWebviewView } from 'vscode';
import { traceError } from '../../logger';
import { IFileSystem } from '../../platform/types';
import { IDisposableRegistry } from '../../types';
import * as localize from '../../utils/localize';
import { IWebviewView, IWebviewViewOptions } from '../types';
import { Webview } from '../webviews/webview';

export class WebviewView extends Webview implements IWebviewView {
    private view: vscodeWebviewView | undefined;

    constructor(
        fs: IFileSystem,
        disposableRegistry: IDisposableRegistry,
        private panelOptions: IWebviewViewOptions,
        additionalRootPaths: Uri[] = []
    ) {
        super(fs, disposableRegistry, panelOptions, additionalRootPaths);

        //const webViewOptions: WebviewOptions = {
        //enableScripts: true,
        //localResourceRoots: [
        //Uri.file(this.panelOptions.rootPath),
        //Uri.file(this.panelOptions.cwd),
        //...additionalRootPaths
        //]
        //};

        //if (panelOptions.webviewView) {
        //this.view = panelOptions.webviewView;
        //this.view.webview.options = webViewOptions;
        //} else {
        //throw new Error('Webview Views must be passed in an initial view');
        //}

        //// Set our base webview from the panel
        //this.webview = this.view.webview;

        //this.load().catch((error) => {
        //traceError(`Error Loading WebviewView: ${error}`);
        //});
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

    // tslint:disable-next-line:no-any
    //private async load() {
    //try {
    //if (this.view) {
    //const localFilesExist = await Promise.all(
    //this.panelOptions.scripts.map((s) => this.fs.localFileExists(s))
    //);
    //if (localFilesExist.every((exists) => exists === true)) {
    //// Call our special function that sticks this script inside of an html page
    //// and translates all of the paths to vscode-resource URIs
    //this.view.webview.html = await this.generateLocalReactHtml();

    //// Reset when the current panel is closed
    //this.disposableRegistry.push(
    //this.view.onDidDispose(() => {
    //this.view = undefined;
    //this.panelOptions.listener.dispose().ignoreErrors();
    //})
    //);

    //this.disposableRegistry.push(
    //this.view.webview.onDidReceiveMessage((message) => {
    //// Pass the message onto our listener
    //this.panelOptions.listener.onMessage(message.type, message.payload);
    //})
    //);
    //} else {
    //// Indicate that we can't load the file path
    //const badPanelString = localize.DataScience.badWebPanelFormatString();
    //this.view.webview.html = badPanelString.format(this.panelOptions.scripts.join(', '));
    //}
    //}
    //} catch (error) {
    //// If our web panel failes to load, report that out so whatever
    //// is hosting the panel can clean up
    //traceError(`Error Loading WebviewView: ${error}`);
    //this.loadFailedEmitter.fire();
    //}
    //}
}
