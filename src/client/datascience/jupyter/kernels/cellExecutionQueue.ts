// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { IDisposable } from 'monaco-editor';
import { NotebookCell, NotebookCellRunState, NotebookEditor } from '../../../../../types/vscode-proposed';
import { disposeAllDisposables } from '../../../common/helpers';
import { traceError, traceInfo } from '../../../common/logger';
import { createDeferred } from '../../../common/utils/async';
import { noop } from '../../../common/utils/misc';
import { traceCellMessage } from '../../notebook/helpers/helpers';
import { INotebook } from '../../types';
import { CellExecution, CellExecutionFactory } from './cellExecution';
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const vscodeNotebookEnums = require('vscode') as typeof import('vscode-proposed');

/**
 * A queue responsible for execution of cells.
 * If this has not completed execution of the cells queued, we can continue to add more cells to this job.
 * All cells queued using `runCells` are added to the queue and processed in order they were added/queued.
 */
export class CellExecutionQueue {
    private readonly queueOfCellsToExecute: CellExecution[] = [];
    private readonly disposables: IDisposable[] = [];
    private readonly completion = createDeferred<void>();
    private cancelledOrCompletedWithErrors = false;
    private startedRunningCells = false;
    /**
     * Whether all cells have completed processing or cancelled, or some completed & others cancelled.
     */
    public get isEmpty(): boolean {
        return this.completion.completed;
    }
    /**
     * Whether cells have been cancelled (as a result of interrupt or some have failed).
     * Even if this property is true, its possible there is still some async operation pending (updating states of cells).
     */
    public get failed(): boolean {
        return this.cancelledOrCompletedWithErrors;
    }
    constructor(
        private readonly editor: NotebookEditor,
        private readonly notebookPromise: Promise<INotebook>,
        private readonly executionFactory: CellExecutionFactory,
        private readonly isPythonKernelConnection: boolean
    ) {
        // If the editor is closed, then just stop handling the UI updates.
        this.editor.onDidDispose(() => this.cancel(true), this, this.disposables);
        this.completion.promise.finally(() => this.dispose()).catch(noop);
    }
    /**
     * Queue the cell for execution & start processing it immediately.
     */
    public queueCell(cell: NotebookCell) {
        const existingCellExecution = this.queueOfCellsToExecute.find((item) => item.cell === cell);
        if (existingCellExecution) {
            traceCellMessage(cell, 'Use existing cell execution');
            return existingCellExecution;
        }
        const cellExecution = this.executionFactory.create(cell, this.isPythonKernelConnection);
        this.queueOfCellsToExecute.push(cellExecution);

        traceCellMessage(cell, 'User queued cell for execution');

        // Start executing the cells.
        this.startExecutingCells();
    }
    /**
     * Cancel all cells that have been queued & wait for them to complete.
     * @param {boolean} [forced=false]
     * If `true`, then do not wait for cell execution to complete gracefully (just kill it).
     * This is used when we restart the kernel (either as a result of kernel interrupt or user initiated).
     * When restarted, the execution needs to stop as jupyter will not send more messages.
     * Hence `forced=true` is more like a hard kill.
     */
    public async cancel(forced?: boolean): Promise<void> {
        this.cancelledOrCompletedWithErrors = true;
        traceInfo('Cancel pending cells');
        await Promise.all(this.queueOfCellsToExecute.map((item) => item.cancel(forced)));
    }
    /**
     * Wait for cells to complete (for for the queue of cells to be processed)
     * If cells are cancelled, they are not processed, & that too counts as completion.
     */
    public async waitForCompletion(cells: NotebookCell[] = []): Promise<void> {
        if (cells.length === 0) {
            return this.completion.promise;
        }
        const executions = Promise.all(
            this.queueOfCellsToExecute.filter((item) => cells.includes(item.cell)).map((cell) => cell.result)
        );
        await Promise.race([executions, this.completion.promise]);
    }
    private dispose() {
        disposeAllDisposables(this.disposables);
    }
    private startExecutingCells() {
        if (!this.startedRunningCells) {
            this.start().catch(noop);
        }
        this.startedRunningCells = true;
    }
    private async start() {
        try {
            await this.executeQueuedCells();
            this.completion.resolve();
        } catch (ex) {
            traceError('Failed to execute cells in CellExecutionQueue', ex);
            // Initialize this property first, so that external users of this class know whether it has completed.
            // Else its possible there was an error & then we wait (see next line) & in the mean time
            // user attempts to run another cell, then `this.completion` has not completed and we end up queuing a cell
            // but its too late.
            // Also we in `waitForCompletion` we wait on the `this.completion` promise.
            this.cancelledOrCompletedWithErrors = true;
            // If something goes wrong in execution of cells or one cell, then cancel the remaining cells.
            await this.cancel();
            this.completion.reject(ex);
        }
    }
    private async executeQueuedCells() {
        const notebook = await this.notebookPromise;
        this.queueOfCellsToExecute.forEach((exec) => traceCellMessage(exec.cell, 'Ready to execute'));
        while (this.queueOfCellsToExecute.length) {
            // Take the first item from the queue, this way we maintain order of cell executions.
            // Remove from the queue only after we process it
            // This way we don't accidentally end up queueing the same cell again (we know its in the queue).
            const cellToExecute = this.queueOfCellsToExecute[0];
            traceCellMessage(cellToExecute.cell, 'Before Execute individual cell');

            let executionResult: NotebookCellRunState | undefined;
            try {
                await cellToExecute.start(notebook);
                executionResult = await cellToExecute.result;
            } finally {
                // Once the cell has completed execution, remove it from the queue.
                traceCellMessage(cellToExecute.cell, `After Execute individual cell ${executionResult}`);
                const index = this.queueOfCellsToExecute.indexOf(cellToExecute);
                if (index >= 0) {
                    this.queueOfCellsToExecute.splice(index, 1);
                }
            }

            // If a cell has failed the get out.
            if (
                this.cancelledOrCompletedWithErrors ||
                executionResult === vscodeNotebookEnums.NotebookCellRunState.Error
            ) {
                this.cancelledOrCompletedWithErrors = true;
                traceInfo(`Cancel all remaining cells ${this.cancelledOrCompletedWithErrors} || ${executionResult}`);
                await this.cancel();
                break;
            }
        }
    }
}
