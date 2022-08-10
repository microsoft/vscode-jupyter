// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { inject, injectable } from 'inversify';
import {
    CancellationToken,
    CompletionContext,
    ConfigurationChangeEvent,
    NotebookDocument,
    Position,
    TextDocument,
    Uri
} from 'vscode';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IPythonExtensionChecker } from '../../platform/api/types';
import { IVSCodeNotebook, IWorkspaceService } from '../../platform/common/application/types';
import { IDisposableRegistry, IConfigurationService, IsPreRelease } from '../../platform/common/types';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { getInterpreterId } from '../../platform/pythonEnvironments/info/interpreter';
import { INotebookCompletionProvider, INotebookEditorProvider } from '../../notebooks/types';
import { LanguageServer } from './languageServer.node';
import { IControllerSelection, IVSCodeNotebookController } from '../../notebooks/controllers/types';
import { getComparisonKey } from '../../platform/vscode-path/resources';
import { CompletionRequest } from 'vscode-languageclient';
import { NotebookPythonPathService } from './notebookPythonPathService.node';
import { isJupyterNotebook } from '../../platform/common/utils';

const EmptyWorkspaceKey = '';

/**
 * This class sets up the concatenated intellisense for every notebook as it changes its kernel.
 */
@injectable()
export class IntellisenseProvider implements INotebookCompletionProvider, IExtensionSyncActivationService {
    private servers = new Map<string, Promise<LanguageServer | undefined>>();
    private activeInterpreterCache = new Map<string, PythonEnvironment | undefined>();
    private interpreterIdCache: Map<string, string> = new Map<string, string>();
    private knownControllers: WeakMap<NotebookDocument, IVSCodeNotebookController> = new WeakMap<
        NotebookDocument,
        IVSCodeNotebookController
    >();

    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IControllerSelection) private readonly notebookControllerSelection: IControllerSelection,
        @inject(INotebookEditorProvider) private readonly notebookEditorProvider: INotebookEditorProvider,
        @inject(IVSCodeNotebook) private readonly notebooks: IVSCodeNotebook,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IsPreRelease) private readonly isPreRelease: Promise<boolean>,
        @inject(NotebookPythonPathService) private readonly notebookPythonPathService: NotebookPythonPathService
    ) {}

    public activate() {
        // Sign up for kernel change events on notebooks
        this.notebookControllerSelection.onControllerSelected(this.controllerChanged, this, this.disposables);
        // Sign up for notebook open and close events.
        this.notebooks.onDidOpenNotebookDocument(this.openedNotebook, this, this.disposables);
        this.notebooks.onDidCloseNotebookDocument(this.closedNotebook, this, this.disposables);

        // For all currently open notebooks, launch their language server
        this.notebooks.notebookDocuments.forEach((n) => this.openedNotebook(n).ignoreErrors());

        // Track active interpreter, but synchronously. We need synchronously so we
        // can compare during intellisense operations.
        this.getActiveInterpreterSync(undefined);
        this.interpreterService.onDidChangeInterpreter(this.handleInterpreterChange, this, this.disposables);

        // If we change the language server type, we need to restart
        this.workspaceService.onDidChangeConfiguration(this.onDidChangeConfiguration, this, this.disposables);
    }

    public async getLanguageClient(notebook: NotebookDocument) {
        const controller = this.notebookControllerSelection.getSelected(notebook);
        const interpreter = controller
            ? controller.connection.interpreter
            : await this.interpreterService.getActiveInterpreter(notebook.uri);
        const interpreterId = interpreter ? this.getInterpreterIdFromCache(interpreter) : undefined;
        const server = interpreterId ? await this.servers.get(interpreterId) : undefined;
        return server?.client;
    }

    public async getCompletions(
        notebook: NotebookDocument,
        document: TextDocument,
        position: Position,
        context: CompletionContext,
        cancelToken: CancellationToken
    ) {
        const client = await this.getLanguageClient(notebook);
        if (client) {
            // Use provider so it gets translated by middleware
            const feature = client.getFeature(CompletionRequest.method);
            const provider = feature.getProvider(document);
            if (provider) {
                const results = await provider.provideCompletionItems(document, position, cancelToken, context);
                if (results && 'items' in results) {
                    return results.items;
                } else {
                    return results;
                }
            }
        }
    }

    private handleInterpreterChange() {
        this.activeInterpreterCache.clear();
        this.getActiveInterpreterSync(undefined);
    }

    private getActiveInterpreterSync(uri: Uri | undefined): PythonEnvironment | undefined {
        if (!this.extensionChecker.isPythonExtensionInstalled) {
            return;
        }
        const folder =
            this.workspaceService.getWorkspaceFolder(uri)?.uri ||
            (this.workspaceService.rootFolder ? this.workspaceService.rootFolder : undefined);
        const key = folder ? getComparisonKey(folder) : EmptyWorkspaceKey;
        if (!this.activeInterpreterCache.has(key)) {
            this.interpreterService
                .getActiveInterpreter(folder)
                .then((a) => {
                    this.activeInterpreterCache.set(key, a);
                })
                .ignoreErrors();
        }
        return this.activeInterpreterCache.get(key);
    }

    private async controllerChanged(e: { notebook: NotebookDocument; controller: IVSCodeNotebookController }) {
        if (!this.notebookPythonPathService.isPylanceUsingLspNotebooks()) {
            // Create the language server for this connection
            const newServer = await this.ensureLanguageServer(e.controller.connection.interpreter, e.notebook);

            // Get the language server for the old connection (if we have one)
            const oldController = this.knownControllers.get(e.notebook);
            const oldInterpreter = oldController
                ? oldController.connection.interpreter
                : this.getActiveInterpreterSync(e.notebook.uri);
            const oldInterpreterId = oldInterpreter ? this.getInterpreterIdFromCache(oldInterpreter) : undefined;
            const oldLanguageServer = oldInterpreterId ? await this.servers.get(oldInterpreterId) : undefined;

            // If we had one, tell the old language server to stop watching this notebook
            if (oldLanguageServer && newServer?.interpreterId != oldLanguageServer.interpreterId) {
                oldLanguageServer.stopWatching(e.notebook);
            }

            // Tell the new server about the file
            if (newServer) {
                newServer.startWatching(e.notebook);
            }
        }

        // Update the new controller
        this.knownControllers.set(e.notebook, e.controller);
    }

    private async openedNotebook(n: NotebookDocument) {
        if (
            isJupyterNotebook(n) &&
            this.extensionChecker.isPythonExtensionInstalled &&
            !this.notebookPythonPathService.isPylanceUsingLspNotebooks()
        ) {
            // Create a language server as soon as we open. Otherwise intellisense will wait until we run.
            const controller = this.notebookControllerSelection.getSelected(n);

            // Save mapping from notebook to controller
            if (controller) {
                this.knownControllers.set(n, controller);
            }

            // Make sure the active interpreter cache is up to date
            this.getActiveInterpreterSync(n.uri);

            // If the controller is empty, default to the active interpreter
            const interpreter =
                controller?.connection.interpreter || (await this.interpreterService.getActiveInterpreter(n.uri));
            const server = await this.ensureLanguageServer(interpreter, n);

            // If we created one, make sure the server thinks this file is open
            if (server) {
                server.startWatching(n);
            }
        }
    }

    private closedNotebook(n: NotebookDocument) {
        // We don't know the controller after closing
        this.knownControllers.delete(n);
    }

    private getInterpreterIdFromCache(interpreter: PythonEnvironment) {
        const key = getComparisonKey(interpreter.uri);
        let id = this.interpreterIdCache.get(key);
        if (!id) {
            // Making an assumption that the id for an interpreter never changes.
            id = getInterpreterId(interpreter);
            this.interpreterIdCache.set(key, id);
        }
        return id;
    }

    private shouldAllowIntellisense(uri: Uri, interpreterId: string, _interpreterPath: Uri) {
        // We should allow intellisense for a URI when the interpreter matches
        // the controller for the uri
        const notebook = this.notebookEditorProvider.findAssociatedNotebookDocument(uri);
        const controller = notebook ? this.notebookControllerSelection.getSelected(notebook) : undefined;
        const notebookInterpreter = controller ? controller.connection.interpreter : this.getActiveInterpreterSync(uri);
        let notebookId = notebookInterpreter ? this.getInterpreterIdFromCache(notebookInterpreter) : undefined;

        // Special case. For remote use the active interpreter as the controller's interpreter isn't
        // usable by pylance.
        if (
            interpreterId !== notebookId &&
            (controller?.connection.kind === 'startUsingRemoteKernelSpec' ||
                controller?.connection.kind === 'connectToLiveRemoteKernel')
        ) {
            const activeInterpreter = this.getActiveInterpreterSync(uri);
            notebookId = activeInterpreter ? this.getInterpreterIdFromCache(activeInterpreter) : undefined;
        }

        // Cell also have to support python
        const cell = notebook?.getCells().find((c) => c.document.uri.toString() === uri.toString());

        return interpreterId == notebookId && (!cell || cell.document.languageId === 'python');
    }

    private getNotebookHeader(uri: Uri) {
        const settings = this.configService.getSettings(uri);
        // Run any startup commands that we specified. Support the old form too
        let setting = settings.runStartupCommands;

        // Convert to string in case we get an array of startup commands.
        if (Array.isArray(setting)) {
            setting = setting.join(`\n`);
        }

        if (setting) {
            // Cleanup the line feeds. User may have typed them into the settings UI so they will have an extra \\ on the front.
            return setting.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
        }
        return '';
    }

    private async ensureLanguageServer(interpreter: PythonEnvironment | undefined, notebook: NotebookDocument) {
        // We should have one language server per active interpreter.

        // Check the setting to determine if we let pylance handle notebook intellisense or not
        const middlewareType =
            this.configService.getSettings(notebook.uri).pylanceHandlesNotebooks || (await this.isPreRelease)
                ? 'pylance'
                : 'jupyter';

        // See if we already have one for this interpreter or not
        const id = interpreter ? getInterpreterId(interpreter) : undefined;
        if (id && !this.servers.has(id) && interpreter) {
            // We don't already have one. Create a new one for this interpreter.
            // The logic for whether or not
            const languageServerPromise = LanguageServer.createLanguageServer(
                middlewareType,
                interpreter,
                this.shouldAllowIntellisense.bind(this),
                this.getNotebookHeader.bind(this)
            ).then((l) => {
                // If we just created it, indicate to the language server to start watching this notebook
                l?.startWatching(notebook);
                return l;
            });
            this.servers.set(id, languageServerPromise);
        }

        return id ? this.servers.get(id) : undefined;
    }

    private onDidChangeConfiguration(event: ConfigurationChangeEvent) {
        if (
            event.affectsConfiguration('jupyter.pylanceHandlesNotebooks') ||
            event.affectsConfiguration('python.languageServer')
        ) {
            // Dispose all servers and start over for each open notebook
            this.servers.forEach((p) => p.then((s) => s?.dispose()));
            this.servers.clear();

            // For all currently open notebooks, launch their language server
            this.notebooks.notebookDocuments.forEach((n) => this.openedNotebook(n).ignoreErrors());
        }
    }
}
