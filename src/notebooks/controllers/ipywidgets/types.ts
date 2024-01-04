// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Event, Uri } from 'vscode';
import { IDisposable } from '../../../platform/common/types';
import { IPyWidgetMessages } from '../../../messageTypes';
import { IKernel } from '../../../kernels/types';

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
    requestId?: string;
};

/**
 * Used to get an entry for widget (or all of them).
 */
export interface IWidgetScriptSourceProvider extends IDisposable {
    readonly id: string;
    /**
     * Return the script path for the requested module.
     * This is called when ipywidgets needs a source for a particular widget.
     * @param {boolean} [isWebViewOnline] Whether the webview has access to the internet (in particular access CDN websites).
     */
    getWidgetScriptSource(
        moduleName: string,
        moduleVersion: string,
        isWebViewOnline?: boolean
    ): Promise<Readonly<WidgetScriptSource>>;
    /**
     * Returns all of the widgets found for a kernel.
     * This will return all of the widgets found in the nbextensions folder along with the entry point for those widgets.
     */
    getWidgetScriptSources?(): Promise<Readonly<WidgetScriptSource[]>>;
    /**
     * Jupyter Notebook widgets expect the attribute `data-base-url` to be set and point to the directory
     * containing the `nbextensions` folder.
     * This method returns the Url to the directory that contains that folder.
     * On local we return the path to the parent folder of in tmp/scripts/<kernel hash>/share/jupyter/nbextensions
     * On remote we just return the base url, as nbextensions is accessible via <baseUrl>/nbextensions.
     */
    getBaseUrl?(): Promise<Uri | undefined>;
}

export const IWidgetScriptSourceProviderFactory = Symbol('IWidgetScriptSourceProviderFactory');

export interface IWidgetScriptSourceProviderFactory {
    getProviders(kernel: IKernel, uriConverter: ILocalResourceUriConverter): IWidgetScriptSourceProvider[];
}

/**
 * Given a local resource this will convert the Uri into a form such that it can be used in a WebView.
 */
export interface ILocalResourceUriConverter {
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

export const INbExtensionsPathProvider = Symbol('INbExtensionsPathProvider');
export interface INbExtensionsPathProvider {
    getNbExtensionsParentPath(kernel: IKernel): Promise<Uri | undefined>;
}

export const IIPyWidgetScriptManagerFactory = Symbol('IIPyWidgetScriptManagerFactory');
export interface IIPyWidgetScriptManagerFactory {
    getOrCreate(kernel: IKernel): IIPyWidgetScriptManager;
}
export const IIPyWidgetScriptManager = Symbol('IIPyWidgetScriptManager');
export interface IIPyWidgetScriptManager {
    /**
     * Returns the path to the local nbextensions folder.
     * This is where Jupyter Notebooks app stores all of the static files related to widgets.
     * This is typically of the form `<python env>/share/jupyter/nbextensions`.
     * In Jupyter extension we copy this into `tmp/<hash of kernel id>/jupyter/nbextensions` folder.
     *
     * Can be undefined for non-python kernels.
     *
     * Note: This is specific to Jupyter Notebook (not jupyter Lab).
     */
    getBaseUrl?(): Promise<Uri | undefined>;
    /**
     * The extension.js file in each widget folder is the definition file for widgets in Jupyter Notebooks.
     * E.g. assume we have a widget ipyvolume, this will be in `<python env>/share/jupyter/nbextensions/ipyvolume/extension.js`.
     * This file contains the name of the widget & the location where the widget source is located, this is registered in the js file as follows:
     * ```js
     *  require.config({
     *      "*": {
     *          "ipyvolume": "nbextensions/ipyvolume/index.js"
     *          }
     *  })
     * ```
     * Based on the above, the entry point for the widget is index.js file.
     * For widgets to work, we need to ensure require.js in the webview (used to render widgets) is configured accordingly.
     *
     * Note:
     * - We cannot always assume the entry point is index.js
     * - We cannot always assume the name of the widget is the same as the name of the folder in nbextensions
     * Because of these assumptions a hello world widget did not work in the past, see https://github.com/microsoft/vscode-jupyter/issues/10319.
     */
    getWidgetModuleMappings(): Promise<Record<string, Uri> | undefined>;
}
