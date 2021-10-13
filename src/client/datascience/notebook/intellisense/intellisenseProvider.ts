// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { NotebookDocument, Uri } from 'vscode';
import { arePathsSame } from '../../../../datascience-ui/react-common/arePathsSame';
import { IExtensionSingleActivationService } from '../../../activation/types';
import { IVSCodeNotebook } from '../../../common/application/types';
import { IDisposableRegistry } from '../../../common/types';
import { IInterpreterService } from '../../../interpreter/contracts';
import { PythonEnvironment } from '../../../pythonEnvironments/info';
import { getInterpreterId } from '../../../pythonEnvironments/info/interpreter';
import { INotebookControllerManager } from '../types';
import { VSCodeNotebookController } from '../vscodeNotebookController';
import { LanguageServer } from './languageServer';

/**
 * This class sets up the concatenated intellisense for every notebook as it changes its kernel.
 */
@injectable()
export class IntellisenseProvider implements IExtensionSingleActivationService {
    private servers: Map<string, LanguageServer> = new Map<string, LanguageServer>();
    private activeInterpreter: PythonEnvironment | undefined;
    private interpreterIdCache: Map<PythonEnvironment, string> = new Map<PythonEnvironment, string>();
    private knownControllers: WeakMap<NotebookDocument, VSCodeNotebookController> = new WeakMap<
        NotebookDocument,
        VSCodeNotebookController
    >();

    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(INotebookControllerManager) private readonly notebookControllerManager: INotebookControllerManager,
        @inject(IVSCodeNotebook) private readonly notebooks: IVSCodeNotebook,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService
    ) {}
    public async activate(): Promise<void> {
        // Sign up for kernel change events on notebooks
        this.notebookControllerManager.onNotebookControllerSelected(this.controllerChanged, this, this.disposables);
        // Sign up for notebook open and close events.
        this.notebooks.onDidOpenNotebookDocument(this.openedNotebook, this, this.disposables);
        this.notebooks.onDidCloseNotebookDocument(this.closedNotebook, this, this.disposables);

        // For all currently open notebooks, launch their language server
        this.notebooks.notebookDocuments.forEach((n) => this.openedNotebook(n).ignoreErrors());

        // Track active interpreter, but synchronously. We need synchronously so we
        // can compare during intellisense operations.
        this.interpreterService
            .getActiveInterpreter()
            .then((r) => (this.activeInterpreter = r))
            .ignoreErrors();
        this.interpreterService.onDidChangeInterpreter(
            async () => {
                this.activeInterpreter = await this.interpreterService.getActiveInterpreter();
            },
            this,
            this.disposables
        );
    }

    private async controllerChanged(e: { notebook: NotebookDocument; controller: VSCodeNotebookController }) {
        // Create the language server for this connection
        const newServer = await this.ensureLanguageServer(e.controller.connection.interpreter, e.notebook);

        // Get the language server for the old connection (if we have one)
        const oldController = this.knownControllers.get(e.notebook);
        if (oldController && oldController.connection.interpreter) {
            const oldLanguageServer = this.servers.get(getInterpreterId(oldController.connection.interpreter));

            // If we had one, tell the old language server to stop watching this notebook
            if (oldLanguageServer) {
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
        // Create a language server as soon as we open. Otherwise intellisense will wait until we run.
        const controller = this.notebookControllerManager.getSelectedNotebookController(n);

        // Save mapping from notebook to controller
        if (controller) {
            this.knownControllers.set(n, controller);
        }

        // If the controller is empty, default to the active interpreter
        const interpreter =
            controller?.connection.interpreter || (await this.interpreterService.getActiveInterpreter(n.uri));
        return this.ensureLanguageServer(interpreter, n);
    }

    private closedNotebook(n: NotebookDocument) {
        // We don't know the controller after closing
        this.knownControllers.delete(n);
    }

    private getInterpreterIdFromCache(interpreter: PythonEnvironment) {
        let id = this.interpreterIdCache.get(interpreter);
        if (!id) {
            // Making an assumption that the id for an interpreter never changes.
            id = getInterpreterId(interpreter);
            this.interpreterIdCache.set(interpreter, id);
        }
        return id;
    }

    private shouldAllowIntellisense(uri: Uri, interpreterId: string) {
        // We should allow intellisense for a URI when the interpreter matches
        // the controller for the uri
        const notebook = this.notebooks.notebookDocuments.find((n) => arePathsSame(n.uri.fsPath, uri.fsPath));
        const controller = notebook
            ? this.notebookControllerManager.getSelectedNotebookController(notebook)
            : undefined;
        const notebookInterpreter = controller ? controller.connection.interpreter : this.activeInterpreter;
        const notebookId = notebookInterpreter ? this.getInterpreterIdFromCache(notebookInterpreter) : undefined;

        return interpreterId == notebookId;
    }

    private async ensureLanguageServer(interpreter: PythonEnvironment | undefined, notebook: NotebookDocument) {
        // We should have one language server per active interpreter.

        // See if we already have one for this interpreter or not
        const id = interpreter ? getInterpreterId(interpreter) : undefined;
        if (id && !this.servers.has(id) && interpreter) {
            // We don't already have one. Create a new one for this interpreter.
            // The logic for whether or not
            const languageServer = await LanguageServer.createLanguageServer(
                interpreter,
                this.shouldAllowIntellisense.bind(this)
            );
            if (languageServer) {
                this.servers.set(id, languageServer);

                // If we just created it, indicate to the language server to start watching this notebook
                languageServer.startWatching(notebook);
            }
        }

        return id ? this.servers.get(id) : undefined;
    }
}
