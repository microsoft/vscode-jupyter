// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../platform/common/extensions';

import { inject, injectable } from 'inversify';

import { NotebookCellData, NotebookCellKind, NotebookEdit, NotebookRange } from 'vscode';
import { IVSCodeNotebook, ICommandManager } from '../platform/common/application/types';
import { IDataScienceCommandListener, IDisposableRegistry } from '../platform/common/types';
import { Commands } from '../webviews/webview-side/common/constants';
import { noop } from '../platform/common/utils/misc';
import { NotebookCellLanguageService } from '../intellisense/cellLanguageService';
import { chainWithPendingUpdates } from '../kernels/execution/notebookUpdater';
import { getNotebookMetadata } from '../platform/common/utils';

@injectable()
export class NotebookCommandListener implements IDataScienceCommandListener {
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
        this.disposableRegistry.push(
            this.commandManager.registerCommand(Commands.NotebookEditorCollapseAllCells, this.collapseAll, this)
        );
        this.disposableRegistry.push(
            this.commandManager.registerCommand(Commands.NotebookEditorExpandAllCells, this.expandAll, this)
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
        const document = this.notebooks.activeNotebookEditor?.notebook;
        if (!document) {
            return;
        }
        const defaultLanguage = this.languageService.getPreferredLanguage(getNotebookMetadata(document));
        chainWithPendingUpdates(document, (edit) => {
            const nbEdit = NotebookEdit.replaceCells(new NotebookRange(0, document.cellCount), [
                new NotebookCellData(NotebookCellKind.Code, '', defaultLanguage)
            ]);
            edit.set(document.uri, [nbEdit]);
        }).then(noop, noop);
    }
    private collapseAll() {
        const document = this.notebooks.activeNotebookEditor?.notebook;
        if (!document) {
            return;
        }

        chainWithPendingUpdates(document, (edit) => {
            document.getCells().forEach((cell, index) => {
                const metadata = { ...(cell.metadata || {}), inputCollapsed: true, outputCollapsed: true };
                edit.set(document.uri, [NotebookEdit.updateCellMetadata(index, metadata)]);
            });
        }).then(noop, noop);
    }

    private expandAll() {
        const document = this.notebooks.activeNotebookEditor?.notebook;
        if (!document) {
            return;
        }

        chainWithPendingUpdates(document, (edit) => {
            document.getCells().forEach((cell, index) => {
                const metadata = { ...(cell.metadata || {}), inputCollapsed: false, outputCollapsed: true };
                edit.set(document.uri, [NotebookEdit.updateCellMetadata(index, metadata)]);
            });
        }).then(noop, noop);
    }
}
