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
            this.commandManager.registerCommand(Commands.NotebookEditorExpandAllCells, this.expandAll, this)
        );
    }
    public dispose() {
        this.disposables.forEach((d) => d.dispose());
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
}
