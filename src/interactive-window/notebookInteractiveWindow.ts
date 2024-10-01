// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { NotebookDocument, NotebookCellData, NotebookCell, NotebookEdit, WorkspaceEdit, workspace } from 'vscode';
import { InteractiveWindow } from './interactiveWindow';

export class NotebookInteractiveWindow extends InteractiveWindow {
    protected override async appendCell(
        notebookDocument: NotebookDocument,
        cell: NotebookCellData
    ): Promise<NotebookCell> {
        const { replOptions } = await this.showInteractiveEditor();
        if (!replOptions) {
            throw new Error('Interactive editor not found');
        }

        const cellIndex = replOptions.appendIndex;
        const notebookEdit = NotebookEdit.insertCells(replOptions.appendIndex, [cell]);
        const workspaceEdit = new WorkspaceEdit();
        workspaceEdit.set(notebookDocument!.uri, [notebookEdit]);
        await workspace.applyEdit(workspaceEdit);

        return notebookDocument.cellAt(cellIndex)!;
    }
}
