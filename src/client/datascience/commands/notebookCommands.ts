// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { ICommandManager } from '../../common/application/types';
import { IDisposable } from '../../common/types';
import { Commands } from '../constants';
import { INotebookEditorProvider } from '../types';

@injectable()
export class NotebookCommands implements IDisposable {
    private readonly disposables: IDisposable[] = [];
    constructor(
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(INotebookEditorProvider) private notebookEditorProvider: INotebookEditorProvider
    ) {}
    public register() {
        this.disposables.push(
            this.commandManager.registerCommand(Commands.NotebookEditorCollapseAllCells, this.collapseAll, this),
            this.commandManager.registerCommand(Commands.NotebookEditorExpandAllCells, this.expandAll, this),
            this.commandManager.registerCommand(Commands.NotebookEditorKeybindSave, this.keybindSave, this),
            this.commandManager.registerCommand(Commands.NotebookEditorKeybindUndo, this.keybindUndo, this),
            this.commandManager.registerCommand(Commands.NotebookEditorToggleOutput, this.toggleOutput, this),
            this.commandManager.registerCommand(Commands.NotebookEditorKeybindExecuteCell, this.executeCell, this),
            this.commandManager.registerCommand(
                Commands.NotebookEditorKeybindRenderMarkdownAndSelectBelow,
                this.renderMarkdownAndSelectBelow,
                this
            )
        );
    }
    public dispose() {
        this.disposables.forEach((d) => d.dispose());
    }

    private toggleOutput() {
        if (this.notebookEditorProvider.activeEditor?.toggleOutput) {
            this.notebookEditorProvider.activeEditor.toggleOutput();
        }
    }

    private executeCell() {
        void this.commandManager
            .executeCommand('notebook.cell.quitEdit')
            .then(() => this.commandManager.executeCommand('notebook.cell.execute'));
    }

    private renderMarkdownAndSelectBelow() {
        void this.commandManager
            .executeCommand('notebook.cell.quitEdit')
            .then(() => this.commandManager.executeCommand('notebook.cell.executeAndSelectBelow'));
    }

    private collapseAll() {
        if (this.notebookEditorProvider.activeEditor) {
            this.notebookEditorProvider.activeEditor.collapseAllCells();
        }
    }

    private expandAll() {
        if (this.notebookEditorProvider.activeEditor) {
            this.notebookEditorProvider.activeEditor.expandAllCells();
        }
    }

    private keybindSave() {
        if (this.notebookEditorProvider.activeEditor) {
            void this.commandManager.executeCommand(
                'workbench.action.files.save',
                this.notebookEditorProvider.activeEditor.file
            );
        }
    }

    private keybindUndo() {
        void this.commandManager.executeCommand('undo');
    }
}
