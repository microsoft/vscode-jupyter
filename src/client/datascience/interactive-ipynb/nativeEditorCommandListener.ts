// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../common/extensions';

import { inject, injectable } from 'inversify';

import { ICommandManager, IVSCodeNotebook } from '../../common/application/types';
import { IDisposableRegistry } from '../../common/types';
import { Commands } from '../constants';
import { IDataScienceCommandListener } from '../types';
import { NotebookCellLanguageService } from '../notebook/cellLanguageService';
import { getNotebookMetadata } from '../notebook/helpers/helpers';
import { noop } from '../../common/utils/misc';
import { chainWithPendingUpdates } from '../notebook/helpers/notebookUpdater';
import { NotebookCellData, NotebookCellKind, NotebookRange } from 'vscode';

@injectable()
export class NativeEditorCommandListener implements IDataScienceCommandListener {
    constructor(
        @inject(IDisposableRegistry) private disposableRegistry: IDisposableRegistry,
        @inject(IVSCodeNotebook) private notebooks: IVSCodeNotebook,
        @inject(ICommandManager) private commandManager: ICommandManager,
        @inject(NotebookCellLanguageService) private readonly languageService: NotebookCellLanguageService
    ) {}

    public register(commandManager: ICommandManager): void {
        this.disposableRegistry.push(
            commandManager.registerCommand(Commands.NotebookEditorUndoCells, () => this.undoCells())
        );
        this.disposableRegistry.push(
            commandManager.registerCommand(Commands.NotebookEditorRedoCells, () => this.redoCells())
        );
        this.disposableRegistry.push(
            commandManager.registerCommand(Commands.NotebookEditorRemoveAllCells, () => this.removeAllCells())
        );
        this.disposableRegistry.push(
            commandManager.registerCommand(Commands.NotebookEditorRunAllCells, () => this.runAllCells())
        );
        this.disposableRegistry.push(
            commandManager.registerCommand(Commands.NotebookEditorAddCellBelow, () => this.addCellBelow())
        );
    }

    private runAllCells() {
        if (this.notebooks.activeNotebookEditor) {
            void this.commandManager.executeCommand('notebook.execute');
        }
    }

    private addCellBelow() {
        if (this.notebooks.activeNotebookEditor) {
            void this.commandManager.executeCommand('notebook.cell.insertCodeCellBelow');
        }
    }

    private undoCells() {
        if (this.notebooks.activeNotebookEditor) {
            void this.commandManager.executeCommand('notebook.undo');
        }
    }

    private redoCells() {
        if (this.notebooks.activeNotebookEditor) {
            void this.commandManager.executeCommand('notebook.redo');
        }
    }

    private removeAllCells() {
        const document = this.notebooks.activeNotebookEditor?.document;
        if (!document) {
            return;
        }
        const defaultLanguage = this.languageService.getPreferredLanguage(getNotebookMetadata(document));
        chainWithPendingUpdates(document, (edit) =>
            edit.replaceNotebookCells(document.uri, new NotebookRange(0, document.cellCount), [
                new NotebookCellData(NotebookCellKind.Code, '', defaultLanguage)
            ])
        ).then(noop, noop);
    }
}
