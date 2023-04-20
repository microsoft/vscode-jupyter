// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Disposable, extensions, NotebookDocument, workspace, window, Uri, NotebookDocumentChangeEvent } from 'vscode';
import {
    ClientCapabilities,
    DynamicFeature,
    ExecuteCommandRegistrationOptions,
    ExecuteCommandRequest,
    FeatureState,
    LanguageClient,
    LanguageClientOptions,
    RegistrationData,
    RegistrationType,
    RevealOutputChannelOn,
    ServerCapabilities,
    ServerOptions,
    StaticFeature
} from 'vscode-languageclient/node';
import * as path from '../../platform/vscode-path/path';
import * as fs from 'fs-extra';
import { createNotebookMiddleware, NotebookMiddleware } from '@vscode/jupyter-lsp-middleware';
import uuid from 'uuid/v4';
import { NOTEBOOK_SELECTOR, PYTHON_LANGUAGE } from '../../platform/common/constants';
import { traceInfo, traceInfoIfCI } from '../../platform/logging';
import { noop } from '../../platform/common/utils/misc';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { getDisplayPath, getFilePath } from '../../platform/common/platform/fs-paths';
import { getComparisonKey } from '../../platform/vscode-path/resources';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ensure(target: any, key: string) {
    if (target[key] === undefined) {
        target[key] = {};
    }
    return target[key];
}

/**
 * Swallows message from pylance to allow both Jupyter and Python to have a pylance server running.
 * Specifically pylance attempts to register a set of commands. Commands can only be registered once.
 */
class NerfedExecuteCommandFeature implements DynamicFeature<ExecuteCommandRegistrationOptions> {
    private _id = uuid();
    private _commands: Map<string, Disposable[]> = new Map<string, Disposable[]>();

    fillInitializeParams = undefined;
    preInitialize = undefined;

    getState(): FeatureState {
        return {
            kind: 'workspace',
            id: this._id,
            registrations: true
        };
    }

    public get registrationType(): RegistrationType<ExecuteCommandRegistrationOptions> {
        return ExecuteCommandRequest.type;
    }

    public fillClientCapabilities(capabilities: ClientCapabilities): void {
        ensure(ensure(capabilities, 'workspace'), 'executeCommand').dynamicRegistration = true;
    }

    public initialize(capabilities: ServerCapabilities): void {
        if (!capabilities.executeCommandProvider) {
            return;
        }
        this.register({
            id: this._id,
            registerOptions: Object.assign({}, capabilities.executeCommandProvider)
        });
    }

    public register(_data: RegistrationData<ExecuteCommandRegistrationOptions>): void {
        // Do nothing. Otherwise we end up with double registration
        traceInfo('Registering dummy command feature');
    }

    public unregister(id: string): void {
        let disposables = this._commands.get(id);
        if (disposables) {
            disposables.forEach((disposable) => disposable.dispose());
        }
    }

    public dispose(): void {
        this._commands.forEach((value) => {
            value.forEach((disposable) => disposable.dispose());
        });
        this._commands.clear();
    }
}

/**
 * This class wraps an instance of the language server (either Pylance or Jedi LSP) per interpreter.
 *
 * If you need to debug pylance's messages, set this setting:
 *     "notebook-intellisense.trace.server.verbosity": "Verbose",
 */
export class LanguageServer implements Disposable {
    private _client: LanguageClient | undefined;
    private _interpreterId: String;

    private constructor(
        client: LanguageClient,
        public interpreter: PythonEnvironment,
        private readonly middleware: NotebookMiddleware,
        private disposables: Disposable[]
    ) {
        // Client should be already started. We can expose it right away.
        this._client = client;
        this._interpreterId = getComparisonKey(interpreter.uri);
        workspace.onDidChangeNotebookDocument(this.onDidChangeNotebookDocument, this, disposables);
    }

    public async dispose() {
        if (!this._client) {
            return;
        }
        traceInfoIfCI(`Disposing Language Server for ${getDisplayPath(this.interpreter.id)}`);
        const client = this._client;

        // Stop exposing language client so that no one can access it while stopping.
        this._client = undefined;

        this.disposables.forEach((d) => d.dispose());

        // Make sure we dispose middleware before stopping client.
        this.middleware.dispose();

        await client.stop();
        await client.dispose();
    }

    public get client(): LanguageClient | undefined {
        return this._client;
    }

    public get interpreterId() {
        return this._interpreterId;
    }

    public stopWatching(notebook: NotebookDocument) {
        // Tell the middleware to stop watching this document
        try {
            this.middleware.stopWatching(notebook);
        } catch (ex) {
            traceInfoIfCI(`Error shutting down the LS.`, ex);
        }
    }

    public startWatching(notebook: NotebookDocument) {
        // Tell the middleware to start watching this document
        this.middleware.startWatching(notebook);
    }

    public static async createLanguageServer(
        interpreter: PythonEnvironment,
        shouldAllowIntellisense: (uri: Uri, interpreterId: string, interpreterPath: Uri) => boolean,
        getNotebookHeader: (uri: Uri) => string
    ): Promise<LanguageServer | undefined> {
        const serverOptions = await LanguageServer.createServerOptions(interpreter);
        if (serverOptions) {
            let languageClient: LanguageClient | undefined;
            const outputChannel = window.createOutputChannel(`${interpreter.displayName || 'notebook'}-languageserver`);
            const interpreterId = getComparisonKey(interpreter.uri);
            const middleware = createNotebookMiddleware(
                () => languageClient,
                () => noop, // Don't trace output. Slows things down too much
                NOTEBOOK_SELECTOR,
                getFilePath(interpreter.uri),
                (uri) => shouldAllowIntellisense(uri, interpreterId, interpreter.uri),
                getNotebookHeader
            );

            // Client options should be the same for all servers we support.
            const clientOptions: LanguageClientOptions = {
                documentSelector: NOTEBOOK_SELECTOR,
                workspaceFolder: undefined,
                synchronize: {
                    configurationSection: PYTHON_LANGUAGE
                },
                outputChannel,
                revealOutputChannelOn: RevealOutputChannelOn.Never,
                middleware,
                initializationOptions: {
                    // Let LSP server know that it is created for notebook.
                    notebookServer: true
                }
            };

            const client = new LanguageClient('notebook-intellisense', serverOptions, clientOptions);

            // Before starting do a little hack to prevent the pylance double command registration (working with Jake to have an option to skip commands)
            /* eslint-disable @typescript-eslint/no-explicit-any */
            const features: (StaticFeature | DynamicFeature<any>)[] = (client as unknown as any)._features;
            const minusCommands = features.filter(
                (f) => (f as any).registrationType?.method != 'workspace/executeCommand'
            );
            minusCommands.push(new NerfedExecuteCommandFeature());
            (client as any)._features = minusCommands;

            // Then start (which will cause the initialize request to be sent to pylance)
            await client.start();

            // Expose client once it is fully initialized.
            languageClient = client;

            return new LanguageServer(client, interpreter, middleware, [outputChannel]);
        }
    }

    private onDidChangeNotebookDocument(e: NotebookDocumentChangeEvent) {
        if (e.notebook && e.contentChanges.length) {
            // Tell the middleware to refresh its concat document (pylance or notebook)
            this.middleware.refresh(e.notebook);
        }
    }

    private static async createServerOptions(interpreter: PythonEnvironment): Promise<ServerOptions | undefined> {
        // Use jedi. Pylance will never reach here.
        return LanguageServer.createJediLSPServerOptions(interpreter);
    }

    private static async createJediLSPServerOptions(
        interpreter: PythonEnvironment
    ): Promise<ServerOptions | undefined> {
        // Jedi ships with python. Use that to find it.
        const python = extensions.getExtension('ms-python.python');
        if (python) {
            const runJediPath = path.join(python.extensionPath, 'pythonFiles', 'run-jedi-language-server.py');
            if (await fs.pathExists(runJediPath)) {
                const interpreterPath = getFilePath(interpreter.uri);
                const serverOptions: ServerOptions = {
                    command: interpreterPath.length > 0 ? interpreterPath : 'python',
                    args: [runJediPath]
                };
                return serverOptions;
            }
        }
    }
}
