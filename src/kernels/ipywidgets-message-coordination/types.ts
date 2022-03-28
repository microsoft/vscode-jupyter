// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { Event } from 'vscode';
import { IDisposable } from '../../platform/common/types';
import { IPyWidgetMessages } from '../../platform/messageTypes';

export interface IPyWidgetMessage {
    message: IPyWidgetMessages;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload: any;
}

/**
 * Used to send/receive messages related to IPyWidgets
 */
export interface IIPyWidgetMessageDispatcher extends IDisposable {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    postMessage: Event<IPyWidgetMessage>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    receiveMessage(message: IPyWidgetMessage): void;
    initialize(): void;
}

/**
 * Name value pair of widget name/module along with the Uri to the script.
 */
export type WidgetScriptSource = {
    moduleName: string;
    /**
     * Where is the script being source from.
     */
    source?: 'cdn' | 'local' | 'remote';
    /**
     * Resource Uri (not using Uri type as this needs to be sent from extension to UI).
     */
    scriptUri?: string;
};

/**
 * Used to get an entry for widget (or all of them).
 */
export interface IWidgetScriptSourceProvider extends IDisposable {
    /**
     * Return the script path for the requested module.
     * This is called when ipywidgets needs a source for a particular widget.
     */
    getWidgetScriptSource(moduleName: string, moduleVersion: string): Promise<Readonly<WidgetScriptSource>>;
}

/**
 * Given a local resource this will convert the Uri into a form such that it can be used in a WebView.
 */
export interface ILocalResourceUriConverter {
    /**
     * Root folder that scripts should be copied to.
     */
    readonly rootScriptFolder: Uri;
    /**
     * Convert a uri for the local file system to one that can be used inside webviews.
     *
     * Webviews cannot directly load resources from the workspace or local file system using `file:` uris. The
     * `asWebviewUri` function takes a local `file:` uri and converts it into a uri that can be used inside of
     * a webview to load the same resource:
     *
     * ```ts
     * webview.html = `<img src="${webview.asWebviewUri(vscode.Uri.file('/Users/codey/workspace/cat.gif'))}">`
     * ```
     */
    asWebviewUri(localResource: Uri): Promise<Uri>;
}
