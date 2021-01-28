// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { IDisposable } from 'monaco-editor';
import { CancellationTokenSource } from 'vscode';
import { NotebookCell, NotebookCellRunState, NotebookEditor } from '../../../../../types/vscode-proposed';
import { disposeAllDisposables } from '../../../common/helpers';
import { traceInfo } from '../../../common/logger';
import { createDeferred } from '../../../common/utils/async';
import { noop } from '../../../common/utils/misc';
import { traceCellMessage } from '../../notebook/helpers/helpers';
import { INotebook } from '../../types';
import { CellExecution, CellExecutionFactory } from './cellExecution';
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const vscodeNotebookEnums = require('vscode') as typeof import('vscode-proposed');

export class CellExecutionStack {
    private readonly cellExecutions = new WeakMap<NotebookCell, CellExecution>();

    private readonly cancellation = new CancellationTokenSource();
    private readonly stackOfCellsToExecuteByDocument: CellExecution[] = [];

    private readonly disposables: IDisposable[] = [];
    private readonly completion = createDeferred<void>();
    private cancelledOrCompletedWithErrors = false;
    private startedRunningCells = false;
    private chainedCellExecutionPromise: Promise<NotebookCellRunState | undefined> = Promise.resolve(undefined);
    constructor(
        private readonly waitUntilPreviousExecutionCompletes: Promise<void>,
        public readonly editor: NotebookEditor,
        private readonly notebookPromise: Promise<INotebook>,
        private readonly executionFactory: CellExecutionFactory,
        private readonly isPythonKernelConnection: boolean
    ) {
        // If the editor is closed, then just stop handling the UI updates.
        this.editor.onDidDispose(() => this.cancel(true), this, this.disposables);
        this.completion.promise.finally(() => this.dispose()).catch(noop);
    }
    public queueCell(cell: NotebookCell) {
        this.queueCellForExecution(cell);
    }
    public queueAllCells() {
        this.editor.document.cells
            .filter((cell) => cell.cellKind === vscodeNotebookEnums.CellKind.Code)
            .forEach((cell) => this.queueCellForExecution(cell));

        this.startExecutingCells();
    }
    public async cancel(forced?: boolean): Promise<void> {
        this.cancelledOrCompletedWithErrors = true;
        await this.cancelAllPendingCells(forced);
    }
    public async waitForCompletion(cell?: NotebookCell): Promise<void> {
        if (!cell) {
            return this.completion.promise;
        }
        const execution = this.cellExecutions.get(cell);
        if (!execution) {
            throw new Error('Cell not queued for execution');
        }
        await Promise.race([execution.result, this.completion.promise]);
    }
    public get completed(): boolean {
        return this.cancelledOrCompletedWithErrors || this.completion.completed;
    }
    private dispose() {
        disposeAllDisposables(this.disposables);
    }
    /**
     * Cancel all cells that have been queued & wait for them to complete.
     * @param {boolean} [forced=false]
     * If `true`, then do not wait for cell execution to complete gracefully (just kill it).
     * This is used when we restart the kernel (either as a result of kernel interrupt or user initiated).
     * When restarted, the execution needs to stop as jupyter will not send more messages.
     * Hence `forced=true` is more like a hard kill.
     */
    private async cancelAllPendingCells(forced = false) {
        traceInfo('Cancel pending cells');
        // Check all cells
        const pendingCellExecutions = this.getPendingNotebookCellExecutions();
        await Promise.all(pendingCellExecutions.map((item) => item.cancel(forced)));
    }
    private getPendingNotebookCellExecutions() {
        const stackOfCellsToExecute = this.stackOfCellsToExecuteByDocument;
        if (!Array.isArray(stackOfCellsToExecute) || stackOfCellsToExecute.length === 0) {
            return [];
        }

        return stackOfCellsToExecute
            .map((cell) => this.cellExecutions.get(cell.cell))
            .filter((item) => item !== undefined)
            .map((item) => item!);
    }

    private startExecutingCells() {
        if (!this.startedRunningCells) {
            this.start().catch(noop);
        }
        this.startedRunningCells = true;
    }
    private async start() {
        try {
            // Ensure we start this new stack, only after previous stacks have completed.
            await this.waitUntilPreviousExecutionCompletes;
            await this.executeQueuedCells();
            this.completion.resolve();
        } catch (ex) {
            // Initialize this property first, so that external users of this class know whether it has completed.
            // Else its possible there was an error & then we wait (see next line) & in the mean time
            // user attempts to run another cell, then `this.completion` has not completed and we end up queuing a cell
            // but its too late.
            // Also we in `waitForCompletion` we wait on the `this.completion` promise.
            this.cancelledOrCompletedWithErrors = true;
            // Something went wrong.
            // Stop and cancel all of the remaining cells.
            await this.cancel();
            this.completion.reject(ex);
        }
    }
    private async executeQueuedCells() {
        const token = this.cancellation.token;
        const stackOfCellsToExecute = this.stackOfCellsToExecuteByDocument;
        const notebook = await this.notebookPromise;
        stackOfCellsToExecute.forEach((exec) => traceCellMessage(exec.cell, 'Ready to execute'));
        while (stackOfCellsToExecute.length) {
            // Stack of cells to be executed, this way we maintain order of cell executions.
            const cellToExecute = stackOfCellsToExecute[0];
            if (!cellToExecute) {
                continue;
            }
            traceCellMessage(cellToExecute.cell, 'Before Execute individual cell');
            const executionResult = await this.executeIndividualCell(cellToExecute, notebook);
            traceCellMessage(cellToExecute.cell, `After Execute individual cell ${executionResult}`);
            // If a cell has failed the get out.
            if (
                this.cancelledOrCompletedWithErrors ||
                executionResult === vscodeNotebookEnums.NotebookCellRunState.Error
            ) {
                this.cancelledOrCompletedWithErrors = true;
                traceInfo(`Cancel all remaining cells ${token?.isCancellationRequested} || ${executionResult}`);
                await this.cancel();
                break;
            }
            this.onCellExecutionCompleted(cellToExecute);
        }
    }
    private async executeIndividualCell(
        cellExecution: CellExecution,
        notebook: INotebook
    ): Promise<NotebookCellRunState | undefined> {
        traceCellMessage(cellExecution.cell, 'Push cell into queue for execution');
        const chainedExecution = this.chainedCellExecutionPromise.then(async () => {
            traceCellMessage(cellExecution.cell, 'Get cell from queue for execution');
            // Start execution
            await cellExecution.start(notebook);

            // The result promise will resolve when complete.
            const promise = cellExecution.result;
            promise
                .finally(() => traceCellMessage(cellExecution.cell, 'Cell from queue completed execution'))
                .catch(noop);
            return promise;
        });
        this.chainedCellExecutionPromise = chainedExecution;
        return chainedExecution;
    }

    private queueCellForExecution(cell: NotebookCell) {
        const existingCellExecution = this.cellExecutions.get(cell);
        if (existingCellExecution) {
            return existingCellExecution;
        }
        const stackOfCellsToExecute = this.stackOfCellsToExecuteByDocument;
        const cellExecution = this.executionFactory.create(cell, this.isPythonKernelConnection);
        this.cellExecutions.set(cellExecution.cell, cellExecution);
        stackOfCellsToExecute.push(cellExecution);
        cellExecution.result.finally(() => this.onCellExecutionCompleted(cellExecution));
        traceCellMessage(cell, 'User queued cell for execution');

        // Start executing the cells.
        this.startExecutingCells();
    }
    private onCellExecutionCompleted(cellExecution: CellExecution) {
        // Once the cell has completed execution, remote it from the stack.
        const index = this.stackOfCellsToExecuteByDocument.indexOf(cellExecution);
        if (index >= 0) {
            this.stackOfCellsToExecuteByDocument.splice(index, 1);
        }
    }
}
