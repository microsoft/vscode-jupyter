// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { NotebookCell } from 'vscode';
import { traceError, traceInfo } from '../../../common/logger';
import { noop } from '../../../common/utils/misc';
import { traceCellMessage } from '../../notebook/helpers/helpers';
import { INotebook } from '../../types';
import { CellExecution, CellExecutionFactory } from './cellExecution';
import { CodeExecution, CodeExecutionFactory } from './codeExecution';
import { KernelConnectionMetadata, NotebookCellRunState } from './types';
import type { nbformat } from '@jupyterlab/coreutils';

interface Execution {
    cellExecution?: CellExecution;
    codeExecution?: CodeExecution;
}

/**
 * A queue responsible for execution of cells.
 * If this has not completed execution of the cells queued, we can continue to add more cells to this job.
 * All cells queued using `queueCell` are added to the queue and processed in order they were added/queued.
 */
export class CellExecutionQueue {
    private readonly queueToExecute: Execution[] = [];
    private cancelledOrCompletedWithErrors = false;
    private startedRunningCells = false;
    /**
     * Whether all cells have completed processing or cancelled, or some completed & others cancelled.
     */
    public get isEmpty(): boolean {
        return this.queueToExecute.length === 0;
    }
    /**
     * Whether cells have been cancelled (as a result of interrupt or some have failed).
     * Even if this property is true, its possible there is still some async operation pending (updating states of cells).
     */
    public get failed(): boolean {
        return this.cancelledOrCompletedWithErrors;
    }
    constructor(
        private readonly notebookPromise: Promise<INotebook>,
        private readonly cellExecutionFactory: CellExecutionFactory,
        private readonly codeExecutionFactory: CodeExecutionFactory,
        readonly metadata: Readonly<KernelConnectionMetadata>
    ) {}
    /**
     * Queue the cell for execution & start processing it immediately.
     */
    public queueCell(cell?: NotebookCell, code?: string): void {
        if (cell) {
            const cellQueue = this.getCellExecutions(this.queueToExecute);
            const existingCellExecution = cellQueue.find((item) => item.cell === cell);
            if (existingCellExecution) {
                traceCellMessage(cell, 'Use existing cell execution');
                return;
            }
            const cellExecution = this.cellExecutionFactory.create(cell, this.metadata);
            this.queueToExecute.push({ cellExecution });

            traceCellMessage(cell, 'User queued cell for execution');
        } else if (code) {
            const codeExecution = this.codeExecutionFactory.create(code);
            this.queueToExecute.push({ codeExecution });

            traceInfo('Hidden cell queued for execution', codeExecution.code.substring(0, 50));
        }

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
        await Promise.all(
            this.queueToExecute.map((item) => {
                if (item.cellExecution) {
                    item.cellExecution.cancel(forced);
                } else {
                    item.codeExecution?.cancel(forced);
                }
            })
        );
    }
    /**
     * Wait for cells to complete (for for the queue of cells to be processed)
     * If cells are cancelled, they are not processed, & that too counts as completion.
     * If no cells are provided, then wait on all cells in the current queue.
     */
    public async waitForCompletion(cells?: NotebookCell[]): Promise<NotebookCellRunState[]> {
        const queue: CellExecution[] = this.getCellExecutions(this.queueToExecute);
        const cellsToCheck =
            Array.isArray(cells) && cells.length > 0 ? queue.filter((item) => cells.includes(item.cell)) : queue;

        return Promise.all(cellsToCheck.map((cell) => cell.result));
    }
    public async waitForHiddenOutput(code: string): Promise<nbformat.IOutput[]> {
        const queue: CodeExecution[] = this.getCodeExecutions(this.queueToExecute);
        const execution = queue.find((exec) => exec.code === code);

        if (execution) {
            return Promise.resolve(execution.output);
        }

        return [];
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
        const notebook = await this.notebookPromise;
        this.queueToExecute.forEach((exec) => {
            if (exec.cellExecution) {
                traceCellMessage(exec.cellExecution.cell, 'Ready to execute');
            } else if (exec.codeExecution) {
                traceInfo('Ready to execute hidden code', exec.codeExecution.code.substring(0, 50));
            }
        });
        while (this.queueToExecute.length) {
            // Take the first item from the queue, this way we maintain order of cell executions.
            // Remove from the queue only after we process it
            // This way we don't accidentally end up queueing the same cell again (we know its in the queue).
            const toExecute = this.queueToExecute[0];
            if (toExecute.cellExecution) {
                traceCellMessage(toExecute.cellExecution.cell, 'Before Execute individual cell');
            } else if (toExecute.codeExecution) {
                traceInfo('Before Execute hidden code', toExecute.codeExecution.code.substring(0, 50));
            }

            let executionResult: NotebookCellRunState | undefined;
            try {
                if (toExecute.cellExecution) {
                    await toExecute.cellExecution.start(notebook);
                    executionResult = await toExecute.cellExecution.result;
                } else if (toExecute.codeExecution) {
                    await toExecute.codeExecution.start(notebook);
                }
            } finally {
                // Once the cell has completed execution, remove it from the queue.
                if (toExecute.cellExecution) {
                    traceCellMessage(toExecute.cellExecution.cell, `After Execute individual cell ${executionResult}`);
                } else if (toExecute.codeExecution) {
                    traceInfo('After Execute hidden code', toExecute.codeExecution.code.substring(0, 50));
                }
                const index = this.queueToExecute.indexOf(toExecute);
                if (index >= 0) {
                    this.queueToExecute.splice(index, 1);
                }
            }

            // If a cell has failed the get out.
            if (this.cancelledOrCompletedWithErrors || executionResult === NotebookCellRunState.Error) {
                this.cancelledOrCompletedWithErrors = true;
                traceInfo(`Cancel all remaining cells ${this.cancelledOrCompletedWithErrors} || ${executionResult}`);
                await this.cancel();
                break;
            }
        }
    }

    private getCellExecutions(executionList: Execution[]): CellExecution[] {
        const cellExecutions: CellExecution[] = [];

        executionList.forEach((execution) => {
            if (execution.cellExecution) {
                cellExecutions.push(execution.cellExecution);
            }
        });

        return cellExecutions;
    }

    private getCodeExecutions(executionList: Execution[]): CodeExecution[] {
        const codeExecutions: CodeExecution[] = [];

        executionList.forEach((execution) => {
            if (execution.codeExecution) {
                codeExecutions.push(execution.codeExecution);
            }
        });

        return codeExecutions;
    }
}
