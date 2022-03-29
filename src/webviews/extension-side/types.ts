// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { WebviewViewProvider } from 'vscode';
import { Resource, IJupyterSettings } from '../../platform/common/types';

export const ICodeCssGenerator = Symbol('ICodeCssGenerator');
export interface ICodeCssGenerator {
    generateThemeCss(resource: Resource, isDark: boolean, theme: string): Promise<string>;
}

export const IThemeFinder = Symbol('IThemeFinder');
export interface IThemeFinder {
    findThemeRootJson(themeName: string): Promise<string | undefined>;
    isThemeDark(themeName: string): Promise<boolean | undefined>;
}

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
