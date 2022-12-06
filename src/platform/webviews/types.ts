// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Event, Uri } from 'vscode';
import { WebviewViewProvider } from 'vscode';
import { IJupyterSettings } from '../common/types';

export interface IJupyterExtraSettings extends IJupyterSettings {
    extraSettings: {
        editor: {
            cursor: string;
            cursorBlink: string;
            fontLigatures: boolean;
            autoClosingBrackets: string;
            autoClosingQuotes: string;
            autoSurround: string;
            autoIndent: boolean;
            scrollBeyondLastLine: boolean;
            horizontalScrollbarSize: number;
            verticalScrollbarSize: number;
            fontSize: number;
            fontFamily: string;
        };
        theme: string;
        hasPythonExtension: boolean;
        isWeb: boolean;
    };
}

type WebViewViewState = {
    readonly visible: boolean;
    readonly active: boolean;
};
export type WebViewViewChangeEventArgs = { current: WebViewViewState; previous: WebViewViewState };

// Wraps the VS Code WebviewViewProvider. VSC Prefix as we also have our own IWebviewViewProvider
export interface IVSCWebviewViewProvider extends WebviewViewProvider {
    readonly viewType: 'jupyterViewVariables';
}

/**
 * Handles communications between the WebView (used to render oututs in Notebooks) & extension host.
 */
export interface IWebviewCommunication {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly onDidReceiveMessage: Event<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    postMessage(message: any): Thenable<boolean>;
    asWebviewUri(localResource: Uri): Uri;
}
