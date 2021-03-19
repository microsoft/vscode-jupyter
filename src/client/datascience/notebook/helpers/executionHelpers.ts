// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import type { nbformat } from '@jupyterlab/coreutils';
import { workspace, Range, WorkspaceEdit, NotebookCellKind, NotebookCell } from 'vscode';
import { traceCellMessage } from './helpers';
import { chainWithPendingUpdates } from './notebookUpdater';

// After executing %tensorboard --logdir <log directory> to launch
// TensorBoard inline, TensorBoard sends back an IFrame to display as output.
// The TensorBoard app hardcodes the source URL of the IFrame to `window.location`.
// In the VSCode context this results in the URL taking on the internal
// vscode-webview:// scheme which doesn't work. Hence rewrite it to use
// http://localhost:<port number>.
export function handleTensorBoardDisplayDataOutput(data: nbformat.IMimeBundle) {
    if (data.hasOwnProperty('text/html')) {
        const text = data['text/html'];
        if (typeof text === 'string' && text.includes('<iframe id="tensorboard-frame-')) {
            data['text/html'] = text.replace(/new URL\((.*), window.location\)/, 'new URL("http://localhost")');
        }
    }
    return data;
}

// Update the code contents of the cell
export async function updateCellCode(cell: NotebookCell, text: string) {
    // Use Workspace edit to apply a replace to the full cell text
    const edit = new WorkspaceEdit();
    edit.replace(
        cell.document.uri,
        new Range(cell.document.lineAt(0).range.start, cell.document.lineAt(cell.document.lineCount - 1).range.end),
        text
    );
    await workspace.applyEdit(edit);
}

// Add a new cell with the given contents after the current
export async function addNewCellAfter(cell: NotebookCell, text: string) {
    await chainWithPendingUpdates(cell.notebook, (edit) => {
        traceCellMessage(cell, 'Create new cell after current');
        edit.replaceNotebookCells(cell.notebook.uri, cell.index + 1, cell.index + 1, [
            {
                kind: NotebookCellKind.Code,
                language: cell.document.languageId,
                metadata: cell.metadata.with({}),
                outputs: [],
                source: text
            }
        ]);
    });
}
