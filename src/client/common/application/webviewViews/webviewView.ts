// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../extensions';

import { Event, EventEmitter, Uri, WebviewOptions, WebviewView as vscodeWebviewView, window } from 'vscode';
import { traceError } from '../../logger';
import { IFileSystem } from '../../platform/types';
import { IDisposableRegistry } from '../../types';
import * as localize from '../../utils/localize';
import { IWebviewView, IWebviewViewOptions } from '../types';
import { Webview } from '../webviews/webview';

export class WebviewView extends Webview implements IWebviewView {
    private view: vscodeWebviewView | undefined;
    private loadPromise: Promise<void>;
    private loadFailedEmitter = new EventEmitter<void>();

    constructor(
        fs: IFileSystem,
        private disposableRegistry: IDisposableRegistry,
        private panelOptions: IWebviewViewOptions,
        additionalRootPaths: Uri[] = []
    ) {
        super(fs, panelOptions);

        const webViewOptions: WebviewOptions = {
            enableScripts: true,
            localResourceRoots: [
                Uri.file(this.panelOptions.rootPath),
                Uri.file(this.panelOptions.cwd),
                ...additionalRootPaths
            ]
        };

        //if (panelOptions.webViewPanel) {
        //this.panel = panelOptions.webViewPanel;
        //this.panel.webview.options = webViewOptions;
        //} else {
        //this.panel = window.createWebviewPanel(
        //panelOptions.title.toLowerCase().replace(' ', ''),
        //panelOptions.title,
        //{ viewColumn: panelOptions.viewColumn, preserveFocus: true },
        //{
        //retainContextWhenHidden: true,
        //enableFindWidget: true,
        //...webViewOptions
        //}
        //);
        //}

        // Set our base webview from the panel
        this.webview = this.view.webview;

        this.loadPromise = this.load();
    }

    public get loadFailed(): Event<void> {
        return this.loadFailedEmitter.event;
    }

    public async show(preserveFocus: boolean) {
        await this.loadPromise;
        if (this.view) {
            //this.view.reveal(this.panel.viewColumn, preserveFocus);
            // Show the view here
        }
    }

    public setTitle(newTitle: string) {
        this.panelOptions.title = newTitle;
        if (this.view) {
            this.view.title = newTitle;
        }
    }

    // tslint:disable-next-line:no-any
    private async load() {
        try {
            if (this.view) {
                const localFilesExist = await Promise.all(
                    this.panelOptions.scripts.map((s) => this.fs.localFileExists(s))
                );
                if (localFilesExist.every((exists) => exists === true)) {
                    // Call our special function that sticks this script inside of an html page
                    // and translates all of the paths to vscode-resource URIs
                    this.view.webview.html = await this.generateLocalReactHtml();

                    // Reset when the current panel is closed
                    this.disposableRegistry.push(
                        this.view.onDidDispose(() => {
                            this.view = undefined;
                            //this.panelOptions.listener.dispose().ignoreErrors();
                        })
                    );

                    this.disposableRegistry.push(
                        this.view.webview.onDidReceiveMessage((message) => {
                            // Pass the message onto our listener
                            //this.panelOptions.listener.onMessage(message.type, message.payload);
                        })
                    );
                } else {
                    // Indicate that we can't load the file path
                    const badPanelString = localize.DataScience.badWebPanelFormatString();
                    this.view.webview.html = badPanelString.format(this.panelOptions.scripts.join(', '));
                }
            }
        } catch (error) {
            // If our web panel failes to load, report that out so whatever
            // is hosting the panel can clean up
            traceError(`Error Loading WebPanel: ${error}`);
            this.loadFailedEmitter.fire();
        }
    }
}
