// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Disposable, EventEmitter, NotebookCell } from 'vscode';
import { traceError, traceVerbose, traceWarning } from '../../platform/logging';
import { noop } from '../../platform/common/utils/misc';
import { traceCellMessage } from './helpers';
import { CellExecution, CellExecutionFactory } from './cellExecution';
import { IKernelConnectionSession, KernelConnectionMetadata, NotebookCellRunState } from '../../kernels/types';
import { Resource } from '../../platform/common/types';

/**
 * A queue responsible for execution of cells.
 * If this has not completed execution of the cells queued, we can continue to add more cells to this job.
 * All cells queued using `queueCell` are added to the queue and processed in order they were added/queued.
 */
export class CellExecutionQueue implements Disposable {
    private readonly queueOfCellsToExecute: CellExecution[] = [];
    private cancelledOrCompletedWithErrors = false;
    private startedRunningCells = false;
    private readonly _onPreExecute = new EventEmitter<NotebookCell>();
    private readonly _onPostExecute = new EventEmitter<NotebookCell>();
    private disposables: Disposable[] = [];
    private lastCellExecution?: CellExecution;
    /**
     * Whether all cells have completed processing or cancelled, or some completed & others cancelled.
     */
    public get isEmpty(): boolean {
        return this.queueOfCellsToExecute.length === 0;
    }
    /**
     * Whether cells have been cancelled (as a result of interrupt or some have failed).
     * Even if this property is true, its possible there is still some async operation pending (updating states of cells).
     */
    public get failed(): boolean {
        return this.cancelledOrCompletedWithErrors;
    }
    public get queue(): Readonly<NotebookCell[]> {
        return this.queueOfCellsToExecute.map((cell) => cell.cell);
    }
    constructor(
        private readonly session: Promise<IKernelConnectionSession>,
        private readonly executionFactory: CellExecutionFactory,
        readonly metadata: Readonly<KernelConnectionMetadata>,
        readonly resourceUri: Resource
    ) {}

    public dispose() {
        this.disposables.forEach((d) => d.dispose());
        this.lastCellExecution?.dispose();
    }

    public get onPreExecute() {
        return this._onPreExecute.event;
    }

    public get onPostExecute() {
        return this._onPostExecute.event;
    }

    /**
     * Queue the cell for execution & start processing it immediately.
     */
    public queueCell(cell: NotebookCell, codeOverride?: string): void {
        const existingCellExecution = this.queueOfCellsToExecute.find((item) => item.cell === cell);
        if (existingCellExecution) {
            traceCellMessage(cell, 'Use existing cell execution');
            return;
        }
        const cellExecution = this.executionFactory.create(cell, codeOverride, this.metadata);
        this.disposables.push(cellExecution);
        cellExecution.preExecute((c) => this._onPreExecute.fire(c), this, this.disposables);
        this.queueOfCellsToExecute.push(cellExecution);

        traceCellMessage(cell, 'User queued cell for execution');

        // Start executing the cells.
        this.startExecutingCells();
    }

    /**
     * Queue the cell for execution & start processing it immediately.
     */
    public resumeCell(cell: NotebookCell, msg_id: string): void {
        const existingCellExecution = this.queueOfCellsToExecute.find((item) => item.cell === cell);
        if (existingCellExecution) {
            traceCellMessage(cell, 'Use existing cell execution');
            return;
        }
        const cellExecution = this.executionFactory.create(cell, '', this.metadata, msg_id);
        this.disposables.push(cellExecution);
        this.queueOfCellsToExecute.push(cellExecution);

        traceCellMessage(cell, 'User queued cell for execution');

        // Start executing the cells.
        this.startExecutingCells();
    }

    /**
     * Queue the cell for execution & start processing it immediately.
     */
    public restoreOutput(cell: NotebookCell): void {
        const existingCellExecution = this.queueOfCellsToExecute.find((item) => item.cell === cell);
        if (existingCellExecution) {
            traceCellMessage(cell, 'Use existing cell execution');
            return;
        }
        const cellExecution = this.executionFactory.create(cell, '', this.metadata, undefined, true);
        this.disposables.push(cellExecution);
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
        traceVerbose('Cancel pending cells');
        await Promise.all(this.queueOfCellsToExecute.map((item) => item.cancel(forced)));
        this.lastCellExecution?.dispose();
        this.queueOfCellsToExecute.splice(0, this.queueOfCellsToExecute.length);
    }
    /**
     * Wait for cells to complete (for for the queue of cells to be processed)
     * If cells are cancelled, they are not processed, & that too counts as completion.
     * If no cells are provided, then wait on all cells in the current queue.
     */
    public async waitForCompletion(cells?: NotebookCell[]): Promise<NotebookCellRunState[]> {
        const cellsToCheck =
            Array.isArray(cells) && cells.length > 0
                ? this.queueOfCellsToExecute.filter((item) => cells.includes(item.cell))
                : this.queueOfCellsToExecute;

        return Promise.all(cellsToCheck.map((cell) => cell.result));
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
        }
    }
    private async executeQueuedCells() {
        let notebookClosed: boolean | undefined;
        const kernelConnection = await this.session;
        this.queueOfCellsToExecute.forEach((exec) => traceCellMessage(exec.cell, 'Ready to execute'));
        while (this.queueOfCellsToExecute.length) {
            // Dispose the previous cell execution.
            // We should keep the last cell execution alive, as we could get messages even after
            // cell execution has completed, leaving it alive, allows it to process the messages.
            // If we run another cell, then the background messages from previous cell will be picked up
            // by the next cell execution (which is now the last cell execution).
            this.lastCellExecution?.dispose();

            // Take the first item from the queue, this way we maintain order of cell executions.
            // Remove from the queue only after we process it
            // This way we don't accidentally end up queueing the same cell again (we know its in the queue).
            const cellToExecute = this.queueOfCellsToExecute[0];
            this.lastCellExecution = cellToExecute;
            traceCellMessage(cellToExecute.cell, 'Before Execute individual cell');

            let executionResult: NotebookCellRunState | undefined;
            try {
                if (cellToExecute.cell.notebook.isClosed) {
                    notebookClosed = true;
                } else if (this.cancelledOrCompletedWithErrors) {
                    // Noop.
                } else {
                    await cellToExecute.start(kernelConnection);
                    executionResult = await cellToExecute.result;
                }
            } finally {
                // Once the cell has completed execution, remove it from the queue.
                traceCellMessage(cellToExecute.cell, `After Execute individual cell ${executionResult}`);
                const index = this.queueOfCellsToExecute.indexOf(cellToExecute);
                if (index >= 0) {
                    this.queueOfCellsToExecute.splice(index, 1);
                }

                this._onPostExecute.fire(cellToExecute.cell);
            }

            // If notebook was closed or a cell has failed the get out.
            if (
                notebookClosed ||
                this.cancelledOrCompletedWithErrors ||
                executionResult === NotebookCellRunState.Error
            ) {
                this.cancelledOrCompletedWithErrors = true;
                const reasons: string[] = [];
                if (this.cancelledOrCompletedWithErrors) {
                    reasons.push('cancellation or failure in execution');
                }
                if (notebookClosed) {
                    reasons.push('Notebook being closed');
                }
                if (typeof executionResult === 'number' && executionResult === NotebookCellRunState.Error) {
                    reasons.push('failure in cell execution');
                }
                if (reasons.length === 0) {
                    reasons.push('an unknown reason');
                }
                traceWarning(`Cancel all remaining cells due to ${reasons.join(' or ')}`);
                await this.cancel();
                break;
            }
            // If the kernel is dead, then no point trying the rest.
            if (kernelConnection.status === 'dead' || kernelConnection.status === 'terminating') {
                this.cancelledOrCompletedWithErrors = true;
                traceWarning(`Cancel all remaining cells due to dead kernel`);
                await this.cancel();
                break;
            }
        }
    }
}
