// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import type * as KernelMessage from '@jupyterlab/services/lib/kernel/messages';
import {
    NotebookCell,
    NotebookCellExecution,
    workspace,
    NotebookCellOutput,
    NotebookCellExecutionState,
    Event,
    EventEmitter
} from 'vscode';

import { Kernel } from '@jupyterlab/services';
import { CellExecutionCreator } from './cellExecutionCreator';
import { analyzeKernelErrors, createOutputWithErrorMessageForDisplay } from '../../platform/errors/errorUtils';
import { BaseError } from '../../platform/errors/types';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { traceError, traceInfoIfCI, traceVerbose, traceWarning } from '../../platform/logging';
import { IDisposable } from '../../platform/common/types';
import { createDeferred } from '../../platform/common/utils/async';
import { StopWatch } from '../../platform/common/utils/stopWatch';
import { noop } from '../../platform/common/utils/misc';
import { getDisplayNameOrNameOfKernelConnection, isPythonKernelConnection } from '../../kernels/helpers';
import { isCancellationError } from '../../platform/common/cancellation';
import { activeNotebookCellExecution, CellExecutionMessageHandler } from './cellExecutionMessageHandler';
import { CellExecutionMessageHandlerService } from './cellExecutionMessageHandlerService';
import {
    IKernelConnectionSession,
    IKernelController,
    KernelConnectionMetadata,
    NotebookCellRunState
} from '../../kernels/types';
import { NotebookCellStateTracker, traceCellMessage } from './helpers';
import { getDisplayPath } from '../../platform/common/platform/fs-paths';

/**
 * Factory for CellExecution objects.
 */
export class CellExecutionFactory {
    constructor(
        private readonly controller: IKernelController,
        private readonly requestListener: CellExecutionMessageHandlerService
    ) {}

    public create(cell: NotebookCell, code: string | undefined, metadata: Readonly<KernelConnectionMetadata>) {
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        return CellExecution.fromCell(cell, code, metadata, this.controller, this.requestListener);
    }
}

/**
 * Responsible for execution of an individual cell and manages the state of the cell as it progresses through the execution phases.
 * Execution phases include - enqueue for execution (done in ctor), start execution, completed execution with/without errors, cancel execution or dequeue.
 *
 * WARNING: Do not dispose `request: Kernel.IShellFuture` object.
 * Even after request.done & execute_reply is sent we could have more messages coming from iopub.
 * Further details here https://github.com/microsoft/vscode-jupyter/issues/232 & https://github.com/jupyter/jupyter_client/issues/297
 *
 */
export class CellExecution implements IDisposable {
    public get result(): Promise<NotebookCellRunState> {
        return this._result.promise;
    }
    public get preExecute(): Event<NotebookCell> {
        return this._preExecuteEmitter.event;
    }

    private stopWatch = new StopWatch();

    private readonly _result = createDeferred<NotebookCellRunState>();

    private started?: boolean;

    private _completed?: boolean;
    private startTime?: number;
    private endTime?: number;
    private execution?: NotebookCellExecution;
    private cancelHandled = false;
    private disposed?: boolean;
    private request: Kernel.IShellFuture<KernelMessage.IExecuteRequestMsg, KernelMessage.IExecuteReplyMsg> | undefined;
    private readonly disposables: IDisposable[] = [];
    private _preExecuteEmitter = new EventEmitter<NotebookCell>();
    private cellExecutionHandler?: CellExecutionMessageHandler;
    private constructor(
        public readonly cell: NotebookCell,
        private readonly codeOverride: string | undefined,
        private readonly kernelConnection: Readonly<KernelConnectionMetadata>,
        private readonly controller: IKernelController,
        private readonly requestListener: CellExecutionMessageHandlerService
    ) {
        workspace.onDidCloseTextDocument(
            (e) => {
                // If the cell is deleted, then dispose the request object.
                // No point keeping it alive, just chewing resources.
                if (e === this.cell.document) {
                    traceVerbose(`Disposing request as the cell was deleted ${getDisplayPath(this.cell.notebook.uri)}`);
                    try {
                        this.request?.dispose(); // NOSONAR
                    } catch (e) {
                        traceError(`Error during cell execution dispose: ${e}`);
                    }
                    if (this.started && !this._completed) {
                        this.completedDueToCancellation();
                    }
                }
            },
            this,
            this.disposables
        );
        NotebookCellStateTracker.setCellState(cell, NotebookCellExecutionState.Idle);
        const execution = CellExecutionCreator.get(cell);
        if (this.canExecuteCell()) {
            // This has been queued for execution, hence clear all the output.
            // (possible solution for ) https://github.com/microsoft/vscode-jupyter/issues/7123
            // But this breaks all tests, as we get events for state changes in cells when they aren't really executions.
            // Could also effect other parts of the code where we monitor state changes in cells (if it moves to executing, that's wrong).
            // const tempTask = controller.createNotebookCellExecution(this.cell);
            // void tempTask.start();
            // tempTask.executionOrder = undefined;
            // void tempTask.clearOutput();
            // void tempTask.end(undefined);
            this.execution = CellExecutionCreator.getOrCreate(cell, this.controller);
            NotebookCellStateTracker.setCellState(cell, NotebookCellExecutionState.Pending);
        } else if (execution) {
            execution.start();
            execution.end(undefined);
        }
    }

    public static fromCell(
        cell: NotebookCell,
        code: string | undefined,
        metadata: Readonly<KernelConnectionMetadata>,
        controller: IKernelController,
        requestListener: CellExecutionMessageHandlerService
    ) {
        return new CellExecution(cell, code, metadata, controller, requestListener);
    }
    public async start(session: IKernelConnectionSession) {
        if (this.cancelHandled) {
            traceCellMessage(this.cell, 'Not starting as it was cancelled');
            return;
        }
        traceCellMessage(this.cell, 'Start execution');
        traceInfoIfCI(`Cell Exec contents ${this.cell.document.getText().substring(0, 50)}...`);
        if (!this.canExecuteCell()) {
            // End state is bool | undefined not optional. Undefined == not success or failure
            this.execution?.end(undefined);
            this.execution = undefined;
            this._result.resolve();
            return;
        }
        if (this.started) {
            traceCellMessage(this.cell, 'Cell has already been started yet CellExecution.Start invoked again');
            traceError(`Cell has already been started yet CellExecution.Start invoked again ${this.cell.index}`);
            // TODO: Send telemetry this should never happen, if it does we have problems.
            return this.result;
        }
        this.started = true;

        this.startTime = new Date().getTime();
        activeNotebookCellExecution.set(this.cell.notebook, this.execution);
        this.execution?.start(this.startTime);
        NotebookCellStateTracker.setCellState(this.cell, NotebookCellExecutionState.Executing);
        // Await here, so that the UI updates on the progress & we clear the output.
        // Else when running cells with existing outputs, the outputs don't get cleared & it doesn't look like its running.
        // Ideally we shouldn't have any awaits, but here we want the UI to get updated.
        await this.execution?.clearOutput();
        this.stopWatch.reset();

        // Begin the request that will modify our cell.
        this.execute(this.codeOverride || this.cell.document.getText().replace(/\r\n/g, '\n'), session)
            .catch((e) => this.completedWithErrors(e))
            .catch(noop);
    }
    /**
     * Cancel execution.
     * If execution has commenced, then wait for execution to complete or kernel to start.
     * If execution has not commenced, then ensure dequeue it & revert the status to not-queued (remove spinner, etc).
     * @param {boolean} [forced=false]
     * If `true`, then do not wait for cell execution to complete gracefully (just kill it).
     * This is used when we restart the kernel (either as a result of kernel interrupt or user initiated).
     * When restarted, the execution needs to stop as jupyter will not send more messages.
     * Hence `forced=true` is more like a hard kill.
     */
    public async cancel(forced = false) {
        if (this.cancelHandled) {
            return;
        }
        if (this.started && !forced) {
            // At this point the cell execution can only be stopped from kernel & we should not
            // stop handling execution results & the like from the kernel.
            // The result will resolve when execution completes or kernel is restarted.
            traceCellMessage(this.cell, 'Cell is already running, waiting for it to finish or kernel to start');
            await this.result;
            return;
        }
        if (this.cancelHandled || this._completed) {
            return;
        }
        traceCellMessage(this.cell, 'Execution cancelled');
        this.cancelHandled = true;

        this.completedDueToCancellation();
        this.dispose();
    }
    /**
     * This method is called when all execution has been completed (successfully or failed).
     * Or when execution has been cancelled.
     */
    public dispose() {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        traceCellMessage(this.cell, 'Execution disposed');
        disposeAllDisposables(this.disposables);
    }
    private completedWithErrors(error: Partial<Error>) {
        traceWarning(`Cell completed with errors`, error);
        traceCellMessage(this.cell, 'Completed with errors');

        traceCellMessage(this.cell, 'Update with error state & output');
        let errorMessage: string | undefined;
        let output: NotebookCellOutput | undefined;
        // If the error doesn't derive from BaseError, it came from execution
        if (!(error instanceof BaseError)) {
            errorMessage = error.message || error.name || error.stack;
        } else {
            // Otherwise it's an error from the kernel itself. Put it into the cell
            const failureInfo = analyzeKernelErrors(
                workspace.workspaceFolders || [],
                error,
                getDisplayNameOrNameOfKernelConnection(this.kernelConnection),
                this.kernelConnection.interpreter?.sysPrefix
            );
            errorMessage = failureInfo?.message;
        }
        output = createOutputWithErrorMessageForDisplay(errorMessage || '');
        if (output) {
            this.execution?.appendOutput(output).then(noop, noop);
        }

        this.endCellTask('failed');
        this._completed = true;
        traceCellMessage(this.cell, 'Completed with errors, & resolving');
        this._result.resolve(NotebookCellRunState.Error);
    }
    private get isEmptyCodeCell(): boolean {
        return this.cell.document.getText().trim().length === 0;
    }
    private completedSuccessfully() {
        traceCellMessage(this.cell, 'Completed successfully');
        // If we requested a cancellation, then assume it did not even run.
        // If it did, then we'd get an interrupt error in the output.
        let runState = this.isEmptyCodeCell ? NotebookCellRunState.Idle : NotebookCellRunState.Success;

        let success: 'success' | 'failed' = 'success';
        // If there are any errors in the cell, then change status to error.
        if (this.cellExecutionHandler?.hasErrorOutput) {
            success = 'failed';
            runState = NotebookCellRunState.Error;
        }

        this.endCellTask(success);
        this._completed = true;
        traceCellMessage(this.cell, `Completed successfully & resolving with status = ${success}`);
        this._result.resolve(runState);
    }
    private endCellTask(success: 'success' | 'failed' | 'cancelled') {
        if (this.isEmptyCodeCell) {
            // Undefined for not success or failures
            if (this.execution) {
                this.execution.executionOrder = undefined;
            }
            this.execution?.end(undefined);
        } else if (success === 'success' || success === 'failed') {
            this.endTime = new Date().getTime();
            this.execution?.end(success === 'success', this.endTime);
        } else {
            // Cell was cancelled.
            // Undefined for not success or failures
            this.execution?.end(undefined);
        }
        if (activeNotebookCellExecution.get(this.cell.notebook) === this.execution) {
            activeNotebookCellExecution.set(this.cell.notebook, undefined);
        }
        NotebookCellStateTracker.setCellState(this.cell, NotebookCellExecutionState.Idle);
        this.execution = undefined;
    }

    private completedDueToCancellation() {
        traceCellMessage(this.cell, 'Completed due to cancellation');
        this.endCellTask('cancelled');
        this._completed = true;
        traceCellMessage(this.cell, 'Cell cancelled & resolving');
        this._result.resolve(NotebookCellRunState.Idle);
    }

    private canExecuteCell() {
        // Raw cells cannot be executed.
        if (isPythonKernelConnection(this.kernelConnection) && this.cell.document.languageId === 'raw') {
            return false;
        }

        return !this.cell.document.isClosed;
    }

    private async execute(code: string, session: IKernelConnectionSession) {
        traceCellMessage(this.cell, 'Send code for execution');
        await this.executeCodeCell(code, session);
    }

    private async executeCodeCell(code: string, session: IKernelConnectionSession) {
        // Skip if no code to execute
        if (code.trim().length === 0 || this.cell.document.isClosed) {
            traceCellMessage(this.cell, 'Empty cell execution');
            return this.completedSuccessfully();
        }

        // Generate metadata from our cell (some kernels expect this.)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const metadata: any = {
            ...{ cellId: this.cell.document.uri.toString() },
            ...(this.cell.metadata?.custom?.metadata || {}) // Send the Cell Metadata
        };

        try {
            // At this point we're about to ACTUALLY execute some code. Fire an event to indicate that
            this._preExecuteEmitter.fire(this.cell);

            // For Jupyter requests, silent === don't output, while store_history === don't update execution count
            // https://jupyter-client.readthedocs.io/en/stable/api/client.html#jupyter_client.KernelClient.execute
            this.request = session.requestExecute(
                {
                    code: code,
                    silent: false,
                    stop_on_error: false,
                    allow_stdin: true,
                    store_history: true
                },
                false,
                metadata
            );
        } catch (ex) {
            traceError(`Cell execution failed without request, for cell Index ${this.cell.index}`, ex);
            return this.completedWithErrors(ex);
        }
        this.cellExecutionHandler = this.requestListener.registerListener(this.cell, {
            kernel: session.kernel!,
            cellExecution: this.execution!,
            request: this.request,
            onErrorHandlingExecuteRequestIOPubMessage: (error) => {
                traceError(`Cell (index = ${this.cell.index}) execution completed with errors (2).`, error);
                // If not a restart error, then tell the subscriber
                this.completedWithErrors(error);
            }
        });

        // WARNING: Do not dispose `request`.
        // Even after request.done & execute_reply is sent we could have more messages coming from iopub.
        // We have tests for this & check https://github.com/microsoft/vscode-jupyter/issues/232 & https://github.com/jupyter/jupyter_client/issues/297

        try {
            // When the request finishes we are done
            // request.done resolves even before all iopub messages have been sent through.
            // Solution is to wait for all messages to get processed.
            traceCellMessage(this.cell, 'Wait for jupyter execution');
            await this.request.done;
            traceCellMessage(this.cell, 'Jupyter execution completed');
            this.completedSuccessfully();
            traceCellMessage(this.cell, 'Executed successfully in executeCell');
        } catch (ex) {
            // @jupyterlab/services throws a `Canceled` error when the kernel is interrupted.
            // Or even when the kernel dies when running a cell with the code `os.kill(os.getpid(), 9)`
            traceError('Error in waiting for cell to complete', ex);
            traceCellMessage(this.cell, 'Some other execution error');
            if (ex && ex instanceof Error && isCancellationError(ex, true)) {
                // No point displaying the error stack trace from Jupyter npm package.
                // Just display the error message and log details in output.
                // Note: This could be an error from cancellation (interrupt) or due to kernel dying as well.
                this.completedWithErrors({ message: ex.message });
            } else {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                this.completedWithErrors(ex as any);
            }
        }
    }
}
