// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { ConfigurationChangeEvent, NotebookDocument, Uri } from 'vscode';
import { IExtensionSyncActivationService } from '../../../activation/types';
import { IPythonExtensionChecker } from '../../../api/types';
import { IVSCodeNotebook, IWorkspaceService } from '../../../common/application/types';
import { IConfigurationService, IDisposableRegistry } from '../../../common/types';
import { IInterpreterService } from '../../../interpreter/contracts';
import { PythonEnvironment } from '../../../pythonEnvironments/info';
import { getInterpreterId } from '../../../pythonEnvironments/info/interpreter';
import { IInteractiveWindowProvider } from '../../types';
import { findAssociatedNotebookDocument, isJupyterNotebook } from '../helpers/helpers';
import { INotebookControllerManager, INotebookLanguageClientProvider } from '../types';
import { VSCodeNotebookController } from '../vscodeNotebookController';
import { LanguageServer } from './languageServer';

/**
 * This class sets up the concatenated intellisense for every notebook as it changes its kernel.
 */
@injectable()
export class IntellisenseProvider implements INotebookLanguageClientProvider, IExtensionSyncActivationService {
    private servers = new Map<string, Promise<LanguageServer | undefined>>();
    private activeInterpreterCache = new Map<string, PythonEnvironment | undefined>();
    private interpreterIdCache: Map<string, string> = new Map<string, string>();
    private knownControllers: WeakMap<NotebookDocument, VSCodeNotebookController> = new WeakMap<
        NotebookDocument,
        VSCodeNotebookController
    >();

    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(INotebookControllerManager) private readonly notebookControllerManager: INotebookControllerManager,
        @inject(IVSCodeNotebook) private readonly notebooks: IVSCodeNotebook,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IPythonExtensionChecker) private readonly extensionChecker: IPythonExtensionChecker,
        @inject(IInteractiveWindowProvider) private readonly interactiveWindowProvider: IInteractiveWindowProvider,
        @inject(IConfigurationService) private readonly configService: IConfigurationService
    ) {}
    public activate() {
        // Sign up for kernel change events on notebooks
        this.notebookControllerManager.onNotebookControllerSelected(this.controllerChanged, this, this.disposables);
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
        const controller = this.notebookControllerManager.getSelectedNotebookController(notebook);
        const interpreter = controller
            ? controller.connection.interpreter
            : await this.interpreterService.getActiveInterpreter(notebook.uri);
        const interpreterId = interpreter ? this.getInterpreterIdFromCache(interpreter) : undefined;
        const server = interpreterId ? await this.servers.get(interpreterId) : undefined;
        return server?.client;
    }

    private handleInterpreterChange() {
        const folders = [...this.activeInterpreterCache.keys()];
        this.activeInterpreterCache.clear();
        folders.forEach((f) => this.getActiveInterpreterSync(f));
    }

    private getActiveInterpreterSync(fsPath: string | undefined): PythonEnvironment | undefined {
        const folder =
            this.workspaceService.getWorkspaceFolder(fsPath ? Uri.file(fsPath) : undefined)?.uri ||
            (this.workspaceService.rootPath ? Uri.file(this.workspaceService.rootPath) : undefined);
        if (folder && !this.activeInterpreterCache.has(folder.fsPath)) {
            this.interpreterService
                .getActiveInterpreter(folder)
                .then((a) => {
                    this.activeInterpreterCache.set(folder.fsPath, a);
                })
                .ignoreErrors();
        }
        return folder ? this.activeInterpreterCache.get(folder.fsPath) : undefined;
    }

    private async controllerChanged(e: { notebook: NotebookDocument; controller: VSCodeNotebookController }) {
        // Create the language server for this connection
        const newServer = await this.ensureLanguageServer(e.controller.connection.interpreter, e.notebook);

        // Get the language server for the old connection (if we have one)
        const oldController = this.knownControllers.get(e.notebook);
        const oldInterpreter = oldController
            ? oldController.connection.interpreter
            : this.getActiveInterpreterSync(e.notebook.uri.fsPath);
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

        // Update the new controller
        this.knownControllers.set(e.notebook, e.controller);
    }

    private async openedNotebook(n: NotebookDocument) {
        if (isJupyterNotebook(n) && this.extensionChecker.isPythonExtensionInstalled) {
            // Create a language server as soon as we open. Otherwise intellisense will wait until we run.
            const controller = this.notebookControllerManager.getSelectedNotebookController(n);

            // Save mapping from notebook to controller
            if (controller) {
                this.knownControllers.set(n, controller);
            }

            // Make sure the active interpreter cache is up to date
            this.getActiveInterpreterSync(n.uri.fsPath);

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
        let id = this.interpreterIdCache.get(interpreter.path);
        if (!id) {
            // Making an assumption that the id for an interpreter never changes.
            id = getInterpreterId(interpreter);
            this.interpreterIdCache.set(interpreter.path, id);
        }
        return id;
    }

    private shouldAllowIntellisense(uri: Uri, interpreterId: string, _interpreterPath: string) {
        // We should allow intellisense for a URI when the interpreter matches
        // the controller for the uri
        const notebook = findAssociatedNotebookDocument(uri, this.notebooks, this.interactiveWindowProvider);
        const controller = notebook
            ? this.notebookControllerManager.getSelectedNotebookController(notebook)
            : undefined;
        const notebookInterpreter = controller
            ? controller.connection.interpreter
            : this.getActiveInterpreterSync(uri.fsPath);
        const notebookId = notebookInterpreter ? this.getInterpreterIdFromCache(notebookInterpreter) : undefined;

        return interpreterId == notebookId;
    }

    private async ensureLanguageServer(interpreter: PythonEnvironment | undefined, notebook: NotebookDocument) {
        // We should have one language server per active interpreter.

        // Check the setting to determine if we let pylance handle notebook intellisense or not
        const middlewareType = this.configService.getSettings(notebook.uri).pylanceHandlesNotebooks
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
                this.shouldAllowIntellisense.bind(this)
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
