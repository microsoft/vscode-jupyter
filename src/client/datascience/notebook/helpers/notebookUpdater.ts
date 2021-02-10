// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { workspace, WorkspaceEdit } from 'vscode';
import { NotebookDocument, NotebookEditor } from '../../../../../typings/vscode-proposed';
import { createDeferred } from '../../../common/utils/async';
import { noop } from '../../../common/utils/misc';

/**
 * Use this class to perform updates on all cells.
 * We cannot update cells in parallel, this could result in data loss.
 * E.g. assume we update execution order, while that's going on, assume we update the output (as output comes back from jupyter).
 * At this point, VSC is still updating the execution order & we then update the output.
 * Depending on the sequence its possible for some of the updates to get lost.
 *
 * Excellent example:
 * Assume we perform the following updates without awaiting on the promise.
 * Without awaiting, its very easy to replicate issues where the output is never displayed.
 * - We update execution count
 * - We update output
 * - We update status after completion
 */
const pendingCellUpdates = new WeakMap<NotebookDocument, Promise<unknown>>();

export async function chainWithPendingUpdates(
    document: NotebookDocument,
    update: (edit: WorkspaceEdit) => void
): Promise<boolean> {
    const notebook = document;
    const pendingUpdates = pendingCellUpdates.has(notebook) ? pendingCellUpdates.get(notebook)! : Promise.resolve();
    const deferred = createDeferred<boolean>();
    const aggregatedPromise = pendingUpdates
        // We need to ensure the update operation gets invoked after previous updates have been completed.
        // This way, the callback making references to cell metadata will have the latest information.
        // Even if previous update fails, we should not fail this current update.
        .finally(async () => {
            const edit = new WorkspaceEdit();
            update(edit);
            return workspace.applyEdit(edit).then(
                (result) => deferred.resolve(result),
                (ex) => deferred.reject(ex)
            );
        })
        .catch(noop);
    pendingCellUpdates.set(notebook, aggregatedPromise);
    return deferred.promise;
}

export function clearPendingChainedUpdatesForTests() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports
    const vsc = require('vscode') as any;
    const editor: NotebookEditor | undefined = vsc.notebook.activeNotebookEditor;
    if (editor?.document) {
        pendingCellUpdates.delete(editor.document);
    }
}
