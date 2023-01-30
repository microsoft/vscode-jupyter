// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import '../common/extensions';

import {
    Event,
    EventEmitter,
    Uri,
    WebviewOptions,
    WebviewPanel as vscodeWebviewPanel,
    WebviewView as vscodeWebviewView
} from 'vscode';
import { IWebview, IWebviewOptions, WebviewMessage } from '../common/application/types';
import { traceError } from '../logging';
import { Identifiers } from '../common/constants';
import { IFileSystem } from '../common/platform/types';
import { IDisposableRegistry, IExtensionContext } from '../common/types';
import * as localize from '../common/utils/localize';
import { joinPath } from '../vscode-path/resources';

// Wrapper over a vscode webview. To be used with either WebviewPanel or WebviewView
export abstract class Webview implements IWebview {
    public get loadFailed(): Event<void> {
        return this.loadFailedEmitter.event;
    }
    protected webviewHost?: vscodeWebviewView | vscodeWebviewPanel;
    protected loadFailedEmitter = new EventEmitter<void>();
    protected loadPromise: Promise<void>;

    constructor(
        protected fs: IFileSystem,
        protected disposableRegistry: IDisposableRegistry,
        private readonly context: IExtensionContext,
        protected options: IWebviewOptions,
        additionalRootPaths: Uri[] = []
    ) {
        const webViewOptions: WebviewOptions = {
            enableScripts: true,
            localResourceRoots: [this.options.rootPath, this.options.cwd, ...additionalRootPaths]
        };
        if (options.webviewHost) {
            this.webviewHost = options.webviewHost;
            this.webviewHost.webview.options = webViewOptions;
        } else {
            // Delegate to derived classes for creation
            this.webviewHost = this.createWebview(webViewOptions);
        }

        this.loadPromise = this.load();
    }

    public asWebviewUri(localResource: Uri) {
        if (!this.webviewHost?.webview) {
            throw new Error('WebView not initialized, too early to get a Uri');
        }
        return this.webviewHost.webview.asWebviewUri(localResource);
    }

    public postMessage(message: WebviewMessage) {
        if (this.webviewHost?.webview) {
            void this.webviewHost?.webview.postMessage(message);
        }
    }

    // WebviewPanel and WebviewView need their own way to create a webview if not supplied one
    protected abstract createWebview(webviewOptions: WebviewOptions): vscodeWebviewView | vscodeWebviewPanel;

    // After load is finished allow derived classes to hook up class specific code
    protected abstract postLoad(webviewHost: vscodeWebviewView | vscodeWebviewPanel): void;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected async generateLocalReactHtml() {
        if (!this.webviewHost?.webview) {
            throw new Error('WebView not initialized, too early to get a Uri');
        }

        const uriBase = this.webviewHost.webview.asWebviewUri(this.options.cwd).toString();
        const uris = this.options.scripts.map((script) => this.webviewHost!.webview!.asWebviewUri(script));

        const rootPath = this.webviewHost.webview.asWebviewUri(this.options.rootPath).toString();
        const fontAwesomePath = this.webviewHost.webview
            .asWebviewUri(
                joinPath(
                    this.context.extensionUri,
                    'out',
                    'fontAwesome',
                    'node_modules',
                    'font-awesome',
                    'css',
                    'font-awesome.min.css'
                )
            )
            .toString();

        // Change to `true` to force on Test middleware for our react code
        const forceTestMiddleware = 'false';
        return `<!doctype html>
        <html lang="en">
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
                <meta http-equiv="Content-Security-Policy" content="img-src 'self' data: https: http: blob: ${
                    this.webviewHost.webview.cspSource
                }; default-src 'unsafe-inline' 'unsafe-eval' data: https: http: blob: ${
            this.webviewHost.webview.cspSource
        };">
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
                    function forceTestMiddleware() {
                        return ${forceTestMiddleware};
                    }
                </script>
                ${uris.map((uri) => `<script type="text/javascript" src="${uri}"></script>`).join('\n')}
            </body>
        </html>`;
    }

    private async load() {
        try {
            if (this.webviewHost?.webview) {
                const localFilesExist = await Promise.all(this.options.scripts.map((s) => this.fs.exists(s)));
                if (localFilesExist.every((exists) => exists === true)) {
                    // Call our special function that sticks this script inside of an html page
                    // and translates all of the paths to vscode-resource URIs
                    this.webviewHost.webview.html = await this.generateLocalReactHtml();

                    // Hook up class specific events after load
                    this.postLoad(this.webviewHost);
                } else {
                    // Indicate that we can't load the file path
                    this.webviewHost.webview.html = localize.DataScience.badWebPanelFormatString(
                        this.options.scripts.join(', ')
                    );
                }
            }
        } catch (error) {
            // If our web panel failes to load, report that out so whatever
            // is hosting the panel can clean up
            traceError(`Error Loading WebviewPanel: ${error}`);
            this.loadFailedEmitter.fire();
        }
    }
}
