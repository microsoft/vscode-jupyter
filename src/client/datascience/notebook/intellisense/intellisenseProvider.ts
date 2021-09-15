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

    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(INotebookControllerManager) private readonly notebookControllerManager: INotebookControllerManager,
        @inject(IVSCodeNotebook) private readonly notebooks: IVSCodeNotebook,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService
    ) {}
    public async activate(): Promise<void> {
        // Sign up for kernel change events on notebooks
        this.notebookControllerManager.onNotebookControllerSelected(this.controllerChanged, this, this.disposables);
        // Sign up for notebook open events.
        this.notebooks.onDidOpenNotebookDocument(this.openedNotebook, this, this.disposables);

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

    private controllerChanged(e: { notebook: NotebookDocument; controller: VSCodeNotebookController }) {
        return this.ensureLanguageServer(e.controller.connection.interpreter);
    }

    private async openedNotebook(n: NotebookDocument) {
        // Create a language server as soon as we open. Otherwise intellisense will wait until we run.
        const controller = this.notebookControllerManager.getSelectedNotebookController(n);
        // If the controller is empty, default to the active interpreter
        const interpreter =
            controller?.connection.interpreter || (await this.interpreterService.getActiveInterpreter(n.uri));
        return this.ensureLanguageServer(interpreter);
    }

    private shouldAllowIntellisense(uri: Uri, interpreter: PythonEnvironment) {
        // We should allow intellisense for a URI when the interpreter matches
        // the controller for the uri
        const notebook = this.notebooks.notebookDocuments.find((n) => arePathsSame(n.uri.fsPath, uri.fsPath));
        const controller = notebook
            ? this.notebookControllerManager.getSelectedNotebookController(notebook)
            : undefined;
        const id = getInterpreterId(interpreter);
        const notebookInterpreter = controller ? controller.connection.interpreter : this.activeInterpreter;
        const notebookId = notebookInterpreter ? getInterpreterId(notebookInterpreter) : undefined;

        return id == notebookId;
    }

    private async ensureLanguageServer(interpreter: PythonEnvironment | undefined) {
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
            }
        }
    }
}
