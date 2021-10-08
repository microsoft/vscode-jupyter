// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { ICommandManager, IVSCodeNotebook } from '../../common/application/types';
import { IDisposable } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { Commands } from '../constants';
import { chainWithPendingUpdates } from '../notebook/helpers/notebookUpdater';

@injectable()
export class NotebookCommands implements IDisposable {
    private readonly disposables: IDisposable[] = [];
    constructor(
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IVSCodeNotebook) private notebooks: IVSCodeNotebook
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
        const document = this.notebooks.activeNotebookEditor?.document;
        if (!document) {
            return;
        }

        chainWithPendingUpdates(document, (edit) => {
            document.getCells().forEach((cell, index) => {
                const metadata = { ...(cell.metadata || {}), inputCollapsed: true, outputCollapsed: true };
                edit.replaceNotebookCellMetadata(document.uri, index, metadata);
            });
        }).then(noop, noop);
    }

    private expandAll() {
        const document = this.notebooks.activeNotebookEditor?.document;
        if (!document) {
            return;
        }

        chainWithPendingUpdates(document, (edit) => {
            document.getCells().forEach((cell, index) => {
                const metadata = { ...(cell.metadata || {}), inputCollapsed: false, outputCollapsed: true };
                edit.replaceNotebookCellMetadata(document.uri, index, metadata);
            });
        }).then(noop, noop);
    }
}
