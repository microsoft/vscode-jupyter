// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import type { nbformat } from '@jupyterlab/coreutils';
import type { KernelMessage } from '@jupyterlab/services';
import * as fastDeepEqual from 'fast-deep-equal';
import {
    workspace,
    Range,
    WorkspaceEdit,
    NotebookCellKind,
    NotebookCellRunState,
    NotebookCell,
    NotebookEditor,
    NotebookCellMetadata
} from 'vscode';
import { createErrorOutput } from '../../../../datascience-ui/common/cellFactory';
import {
    createIOutputFromCellOutputs,
    createVSCCellOutputsFromOutputs,
    traceCellMessage,
    translateErrorOutput
} from './helpers';
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

/**
 * Updates the cell in notebook model as well as the notebook document.
 * Update notebook document so UI is updated accordingly.
 * Notebook model is what we use to update/track changes to ipynb.
 * @returns {boolean} Returns `true` if output has changed.
 */
export async function handleUpdateDisplayDataMessage(
    msg: KernelMessage.IUpdateDisplayDataMsg,
    editor: NotebookEditor
): Promise<void> {
    const document = editor.document;
    // Find any cells that have this same display_id
    for (const cell of document.cells) {
        if (cell.cellKind !== NotebookCellKind.Code) {
            continue;
        }
        let updated = false;

        const outputs = createIOutputFromCellOutputs(cell.outputs);
        const changedOutputs = outputs.map((output) => {
            if (
                (output.output_type === 'display_data' || output.output_type === 'execute_result') &&
                output.transient &&
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (output.transient as any).display_id === msg.content.transient.display_id
            ) {
                // Remember we have updated output for this cell.
                updated = true;

                return {
                    ...output,
                    data: msg.content.data,
                    metadata: msg.content.metadata
                };
            } else {
                return output;
            }
        });

        if (updated) {
            await updateCellOutput(editor, cell, changedOutputs);
        }
    }
}

/**
 * Updates the VSC cell with the error output.
 */
export async function updateCellWithErrorStatus(
    notebookEditor: NotebookEditor,
    cell: NotebookCell,
    ex: Partial<Error>
) {
    await chainWithPendingUpdates(notebookEditor.document, (edit) => {
        traceCellMessage(cell, 'Update with error state & output');
        const metadata = cell.metadata.with({ runState: NotebookCellRunState.Error });
        edit.replaceNotebookCellMetadata(notebookEditor.document.uri, cell.index, metadata);
        edit.replaceNotebookCellOutput(notebookEditor.document.uri, cell.index, [
            translateErrorOutput(createErrorOutput(ex))
        ]);
    });
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
export async function addNewCellAfter(notebookEditor: NotebookEditor, cell: NotebookCell, text: string) {
    await chainWithPendingUpdates(notebookEditor.document, (edit) => {
        traceCellMessage(cell, 'Create new cell after current');
        edit.replaceNotebookCells(notebookEditor.document.uri, cell.index + 1, cell.index + 1, [
            {
                cellKind: NotebookCellKind.Code,
                language: cell.language,
                metadata: cell.metadata.with({ runState: NotebookCellRunState.Success }),
                outputs: [],
                source: text
            }
        ]);
    });
}

/**
 * @returns {boolean} Returns `true` if execution count has changed.
 */
export async function updateCellExecutionCount(
    editor: NotebookEditor,
    cell: NotebookCell,
    executionCount: number
): Promise<void> {
    if (cell.metadata.executionOrder !== executionCount && executionCount) {
        await chainWithPendingUpdates(editor.document, (edit) => {
            traceCellMessage(cell, 'Update execution count');
            const metadata = new NotebookCellMetadata().with(cell.metadata).with({ executionOrder: executionCount });
            edit.replaceNotebookCellMetadata(editor.document.uri, cell.index, metadata);
        });
    }
}

/**
 * Updates our Cell Model with the cell output.
 * As we execute a cell we get output from jupyter. This code will ensure the cell is updated with the output.
 */
async function updateCellOutput(editor: NotebookEditor, cell: NotebookCell, outputs: nbformat.IOutput[]) {
    const newOutput = createVSCCellOutputsFromOutputs(outputs);
    // If there was no output and still no output, then nothing to do.
    if (cell.outputs.length === 0 && newOutput.length === 0) {
        return;
    }
    // Compare outputs (at the end of the day everything is serializable).
    // Hence this is a safe comparison.
    if (cell.outputs.length === newOutput.length && fastDeepEqual(cell.outputs, newOutput)) {
        return;
    }
    await chainWithPendingUpdates(editor.document, (edit) =>
        edit.replaceNotebookCellOutput(editor.document.uri, cell.index, newOutput)
    );
}
