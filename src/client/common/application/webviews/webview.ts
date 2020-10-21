// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../extensions';

import * as path from 'path';
import { Uri, Webview as vscodeWebview } from 'vscode';
import { Identifiers } from '../../../datascience/constants';
import { IFileSystem } from '../../platform/types';
import { IWebview, IWebviewOptions, WebviewMessage } from '../types';

// Wrapper over a vscode webview. To be used with either WebviewPanel or WebviewView
export class Webview implements IWebview {
    protected webview?: vscodeWebview;
    constructor(protected fs: IFileSystem, protected options: IWebviewOptions) {}

    public asWebviewUri(localResource: Uri) {
        if (!this.webview) {
            throw new Error('WebView not initialized, too early to get a Uri');
        }
        return this.webview.asWebviewUri(localResource);
    }

    public postMessage(message: WebviewMessage) {
        if (this.webview) {
            this.webview.postMessage(message);
        }
    }

    // tslint:disable-next-line:no-any
    protected async generateLocalReactHtml() {
        if (!this.webview) {
            throw new Error('WebView not initialized, too early to get a Uri');
        }

        const uriBase = this.webview.asWebviewUri(Uri.file(this.options.cwd)).toString();
        const uris = this.options.scripts.map((script) => this.webview!.asWebviewUri(Uri.file(script)));
        const testFiles = await this.fs.getFiles(Uri.file(this.options.rootPath));

        // This method must be called so VSC is aware of files that can be pulled.
        // Allow js and js.map files to be loaded by webpack in the webview.
        testFiles
            .filter((f) => f.fsPath.toLowerCase().endsWith('.js') || f.fsPath.toLowerCase().endsWith('.js.map'))
            .forEach((f) => this.webview!.asWebviewUri(f));

        const rootPath = this.webview.asWebviewUri(Uri.file(this.options.rootPath)).toString();
        const fontAwesomePath = this.webview
            .asWebviewUri(
                Uri.file(
                    path.join(this.options.rootPath, 'node_modules', 'font-awesome', 'css', 'font-awesome.min.css')
                )
            )
            .toString();
        return `<!doctype html>
        <html lang="en">
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
                <meta http-equiv="Content-Security-Policy" content="img-src 'self' data: https: http: blob: ${
                    this.webview.cspSource
                }; default-src 'unsafe-inline' 'unsafe-eval' data: https: http: blob: ${this.webview.cspSource};">
                <meta name="theme-color" content="#000000">
                <meta name="theme" content="${Identifiers.GeneratedThemeName}"/>
                <title>VS Code Python React UI</title>
                <base href="${uriBase}${uriBase.endsWith('/') ? '' : '/'}"/>
                <link rel="stylesheet" href="${fontAwesomePath}">
                </head>
            <body>
                <noscript>You need to enable JavaScript to run this app.</noscript>
                <div id="root"></div>
                <script type="text/javascript">
                    // Public path that will be used by webpack.
                    window.__PVSC_Public_Path = "${rootPath}/";
                    function resolvePath(relativePath) {
                        if (relativePath && relativePath[0] == '.' && relativePath[1] != '.') {
                            return "${uriBase}" + relativePath.substring(1);
                        }

                        return "${uriBase}" + relativePath;
                    }
                </script>
                ${uris.map((uri) => `<script type="text/javascript" src="${uri}"></script>`).join('\n')}
            </body>
        </html>`;
    }
}
