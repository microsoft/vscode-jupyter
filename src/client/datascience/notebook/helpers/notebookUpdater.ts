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
 * Easy way to see what could happen is to run python code that runs in a thread as follows:
 * With the below cell code, jupyter will send the the following messages:
 * 1. status message
 * 2. iopub messages (with output)
 * 3. Execute reply (done)
 * 4. But background thread still sends messages
 * This means, we cannot rely on execute_reply to mark the end of execution.
 * More details here https://github.com/jupyter/jupyter_client/issues/297
 *
 * ```python
 * import time
 * import threading
 * from IPython.display import display
 *
 * sleep_time = 4.
 *
 * def work():
 *     for i in range(10):
 *         print('iteration %d'%i)
 *         time.sleep(1)
 *
 * def spawn():
 *     thread = threading.Thread(target=work)
 *     thread.start()
 *     time.sleep(sleep_time)
 *
 * spawn()
 * print('main thread done\n')
 * ```
 *
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
