// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { NotebookCell, NotebookDocument } from '../../../../../types/vscode-proposed';
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
    item: NotebookCell | NotebookDocument,
    // tslint:disable-next-line: no-any
    promise: Promise<any> | Thenable<any>
): Promise<void> {
    // const updater = new NotebookUpdater('notebook' in item ? item.notebook : item);
    const notebook = 'notebook' in item ? item.notebook : item;
    const pendingUpdates = pendingCellUpdates.has(notebook) ? pendingCellUpdates.get(notebook)! : Promise.resolve();
    const newPromise = 'catch' in promise ? promise : new Promise<void>((resolve) => promise.then(resolve, resolve));
    const aggregatedPromise = pendingUpdates.finally(() => newPromise).catch(noop);
    pendingCellUpdates.set(notebook, aggregatedPromise);
    await aggregatedPromise;
}
