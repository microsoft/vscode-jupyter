// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken, Disposable, EventEmitter, NotebookCell } from 'vscode';
import { traceError, traceVerbose, traceWarning } from '../../platform/logging';
import { noop } from '../../platform/common/utils/misc';
import { traceCellMessage } from './helpers';
import { CellExecutionFactory } from './cellExecution';
import {
    IKernelSession,
    KernelConnectionMetadata,
    NotebookCellRunState,
    ResumeCellExecutionInformation
} from '../../kernels/types';
import { Resource } from '../../platform/common/types';
import { ICellExecution, ICodeExecution } from './types';
import { CodeExecution } from './codeExecution';
import { once } from '../../platform/common/utils/events';

/**
 * A queue responsible for execution of cells.
 * If this has not completed execution of the cells queued, we can continue to add more cells to this job.
 * All cells queued using `queueCell` are added to the queue and processed in order they were added/queued.
 */
export class CellExecutionQueue implements Disposable {
    private readonly queueOfItemsToExecute: (ICellExecution | ICodeExecution)[] = [];
    private get queueOfCellsToExecute(): ICellExecution[] {
        return this.queueOfItemsToExecute.filter((c) => c.type === 'cell').map((c) => c as ICellExecution);
    }
    private cancelledOrCompletedWithErrors = false;
    private startedRunningCells = false;
    private readonly _onPreExecute = new EventEmitter<NotebookCell>();
    private readonly _onPostExecute = new EventEmitter<NotebookCell>();
    private disposables: Disposable[] = [];
    private lastCellExecution?: ICellExecution | ICodeExecution;
    /**
     * Whether all cells have completed processing or cancelled, or some completed & others cancelled.
     */
    public get isEmpty(): boolean {
        return this.queueOfItemsToExecute.length === 0;
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
        private readonly session: Promise<IKernelSession>,
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
        this.enqueue({ cell, codeOverride });
    }
    /**
     * Queue the code for execution & start processing it immediately.
     */
    public queueCode(code: string, extensionId: string, token: CancellationToken): ICodeExecution {
        const item = this.enqueue({ code, extensionId, token });
        return item as ICodeExecution;
    }
    private enqueue(
        options:
            | { cell: NotebookCell; codeOverride?: string }
            | { code: string; extensionId: string; token: CancellationToken }
    ) {
        let executionItem: ICellExecution | ICodeExecution;
        if ('cell' in options) {
            const { cell, codeOverride } = options;
            const existingCellExecution = this.queueOfCellsToExecute.find((item) => item.cell === cell);
            if (existingCellExecution) {
                traceCellMessage(cell, 'Use existing cell execution');
                return existingCellExecution;
            }
            const cellExecution = this.executionFactory.create(cell, codeOverride, this.metadata);
            executionItem = cellExecution;
            this.disposables.push(cellExecution);
            cellExecution.preExecute((c) => this._onPreExecute.fire(c), this, this.disposables);
            this.queueOfItemsToExecute.push(cellExecution);

            traceCellMessage(cell, 'User queued cell for execution');
        } else {
            const { code, extensionId, token } = options;
            const codeExecution = CodeExecution.fromCode(code, extensionId);
            executionItem = codeExecution;
            this.disposables.push(codeExecution);
            this.queueOfItemsToExecute.push(codeExecution);
            this.disposables.push(once(token.onCancellationRequested)(() => codeExecution.cancel()));
            traceVerbose(`Extension ${extensionId} queued code for execution`);
        }
        // Start executing the cells.
        this.startExecutingCells();
        return executionItem;
    }

    /**
     * Queue the cell for execution & start processing it immediately.
     */
    public resumeCell(cell: NotebookCell, info: ResumeCellExecutionInformation): void {
        const existingCellExecution = this.queueOfCellsToExecute.find((item) => item.cell === cell);
        if (existingCellExecution) {
            traceCellMessage(cell, 'Use existing cell execution');
            return;
        }
        const cellExecution = this.executionFactory.create(cell, '', this.metadata, info);
        this.disposables.push(cellExecution);
        this.queueOfItemsToExecute.push(cellExecution);

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
        await Promise.all(this.queueOfItemsToExecute.map((item) => item.cancel(forced)));
        this.lastCellExecution?.dispose();
        this.queueOfItemsToExecute.splice(0, this.queueOfItemsToExecute.length);
    }
    /**
     * Cancel all queued cells, but not any 3rd party execution.
     */
    private async cancelQueuedCells(): Promise<void> {
        this.cancelledOrCompletedWithErrors = true;
        traceVerbose('Cancel pending cells');
        await Promise.all(this.queueOfCellsToExecute.map((item) => item.cancel()));
        if (this.lastCellExecution?.type === 'cell') {
            this.lastCellExecution?.dispose();
        }
        this.queueOfItemsToExecute.push(...this.queueOfItemsToExecute.filter((item) => item.type === 'code'));
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
                : this.queueOfItemsToExecute;

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
            await this.cancelQueuedCells();
        }
    }
    private async executeQueuedCells() {
        let notebookClosed: boolean | undefined;
        const kernelConnection = await this.session;
        this.queueOfItemsToExecute.forEach((exec) =>
            exec.type === 'cell'
                ? traceCellMessage(exec.cell, 'Ready to execute')
                : traceVerbose(`Ready to execute code ${exec.code.substring(0, 50)}...`)
        );
        while (this.queueOfItemsToExecute.length) {
            // Dispose the previous cell execution.
            // We should keep the last cell execution alive, as we could get messages even after
            // cell execution has completed, leaving it alive, allows it to process the messages.
            // If we run another cell, then the background messages from previous cell will be picked up
            // by the next cell execution (which is now the last cell execution).
            this.lastCellExecution?.dispose();

            // Take the first item from the queue, this way we maintain order of cell executions.
            // Remove from the queue only after we process it
            // This way we don't accidentally end up queueing the same cell again (we know its in the queue).
            const itemToExecute = this.queueOfItemsToExecute[0];
            this.lastCellExecution = itemToExecute;
            if (itemToExecute.type === 'cell') {
                traceCellMessage(itemToExecute.cell, 'Before Execute individual cell');
            }

            let executionResult: NotebookCellRunState | undefined;
            try {
                if (itemToExecute.type === 'cell' && itemToExecute.cell.notebook.isClosed) {
                    notebookClosed = true;
                } else if (itemToExecute.type === 'cell' && this.cancelledOrCompletedWithErrors) {
                    // Noop.
                } else {
                    await itemToExecute.start(kernelConnection);
                    executionResult = await itemToExecute.result;
                }
            } finally {
                if (itemToExecute.type === 'cell') {
                    // Once the cell has completed execution, remove it from the queue.
                    traceCellMessage(itemToExecute.cell, `After Execute individual cell ${executionResult}`);
                }
                const index = this.queueOfItemsToExecute.indexOf(itemToExecute);
                if (index >= 0) {
                    this.queueOfItemsToExecute.splice(index, 1);
                }

                if (itemToExecute.type === 'cell') {
                    this._onPostExecute.fire(itemToExecute.cell);
                }
            }

            // If notebook was closed or a cell has failed then bail out.
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
                if (
                    this.queueOfCellsToExecute.length > 0 &&
                    this.queueOfCellsToExecute.length === this.queueOfItemsToExecute.length
                ) {
                    // Only dealing with cells
                    // Cancel evertyting and stop execution.
                    traceWarning(`Cancel all remaining cells due to ${reasons.join(' or ')}`);
                    await this.cancel();
                    break;
                } else if (
                    this.queueOfCellsToExecute.length > 0 &&
                    this.queueOfCellsToExecute.length !== this.queueOfItemsToExecute.length
                ) {
                    // Dealing with some cells and some code
                    // Cancel execution of cells and
                    // Continue with the execution of code.
                    traceWarning(`Cancel all remaining cells due to ${reasons.join(' or ')}`);
                    await this.cancelQueuedCells();
                } else if (notebookClosed) {
                    // Code execution failed, as its not related to a cell
                    // there's no need to cancel anything.
                    // Unless the notebook was closed.
                    traceWarning(`Cancel all remaining cells due to ${reasons.join(' or ')}`);
                    await this.cancel();
                    break;
                }
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
