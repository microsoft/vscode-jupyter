// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { NotebookDocument } from 'vscode';
import { IExtensionSingleActivationService } from '../../../activation/types';
import { IVSCodeNotebook } from '../../../common/application/types';
import { IDisposableRegistry } from '../../../common/types';
import { IInterpreterService } from '../../../interpreter/contracts';
import { PythonEnvironment } from '../../../pythonEnvironments/info';
import { areInterpretersSame } from '../../../pythonEnvironments/info/interpreter';
import { INotebookControllerManager } from '../types';
import { VSCodeNotebookController } from '../vscodeNotebookController';
import { LanguageServer } from './languageServer';

/**
 * This class sets up the concatenated intellisense for every notebook as it changes its kernel.
 */
@injectable()
export class IntellisenseProvider implements IExtensionSingleActivationService {
    private servers: Map<string, LanguageServer> = new Map<string, LanguageServer>();

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
    }

    private controllerChanged(e: { notebook: NotebookDocument; controller: VSCodeNotebookController }) {
        return this.createLanguageServer(e.notebook, e.controller.connection.interpreter);
    }

    private async openedNotebook(n: NotebookDocument) {
        // Create a language server as soon as we open. Otherwise intellisense will wait until we run.
        const controller = this.notebookControllerManager.getSelectedNotebookController(n);
        // If the controller is empty, default to the active interpreter
        const interpreter =
            controller?.connection.interpreter || (await this.interpreterService.getActiveInterpreter(n.uri));
        return this.createLanguageServer(n, interpreter);
    }

    private async createLanguageServer(notebook: NotebookDocument, interpreter: PythonEnvironment | undefined) {
        // Delete the old language server if we have one and it is using a different controller
        let oldServer = this.servers.get(notebook.uri.toString());
        const oldServerIsMatch = oldServer ? areInterpretersSame(oldServer.interpreter, interpreter) : false;
        if (oldServer && !oldServerIsMatch) {
            await oldServer.dispose();
        }

        // Create a new one if we can (and need to) based on this controller
        const newServer =
            !oldServerIsMatch && interpreter
                ? await LanguageServer.createLanguageServer(notebook.uri, interpreter)
                : undefined;
        if (newServer) {
            this.servers.set(notebook.uri.toString(), newServer);
            this.disposables.push(newServer);
        }
    }
}
