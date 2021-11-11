// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as fastDeepEqual from 'fast-deep-equal';
import type * as nbformat from '@jupyterlab/nbformat';
import type * as KernelMessage from '@jupyterlab/services/lib/kernel/messages';
import {
    NotebookCell,
    NotebookCellExecution,
    NotebookCellKind,
    NotebookCellExecutionSummary,
    NotebookDocument,
    workspace,
    NotebookController,
    WorkspaceEdit,
    NotebookCellData,
    NotebookRange,
    Range,
    notebooks,
    NotebookCellOutput,
    NotebookCellExecutionState,
    CancellationTokenSource,
    Event,
    EventEmitter
} from 'vscode';
import { concatMultilineString, formatStreamText } from '../../../../datascience-ui/common';
import { createErrorOutput } from '../../../../datascience-ui/common/cellFactory';
import { IApplicationShell } from '../../../common/application/types';
import { traceError, traceInfoIfCI, traceWarning } from '../../../common/logger';
import { RefBool } from '../../../common/refBool';
import { IDisposable, IDisposableRegistry } from '../../../common/types';
import { createDeferred, Deferred } from '../../../common/utils/async';
import { swallowExceptions } from '../../../common/utils/decorators';
import { noop } from '../../../common/utils/misc';
import { StopWatch } from '../../../common/utils/stopWatch';
import { sendTelemetryEvent } from '../../../telemetry';
import { Telemetry } from '../../constants';
import { handleTensorBoardDisplayDataOutput } from '../../notebook/helpers/executionHelpers';
import {
    cellOutputToVSCCellOutput,
    NotebookCellStateTracker,
    traceCellMessage,
    translateCellDisplayOutput,
    translateErrorOutput
} from '../../notebook/helpers/helpers';
import { ICellHash, ICellHashProvider, IDataScienceErrorHandler, IJupyterSession } from '../../types';
import { isPythonKernelConnection } from './helpers';
import { IKernel, KernelConnectionMetadata, NotebookCellRunState } from './types';
import { Kernel } from '@jupyterlab/services';
import { CellOutputDisplayIdTracker } from './cellDisplayIdTracker';
import { disposeAllDisposables } from '../../../common/helpers';
import { CellHashProviderFactory } from '../../editor-integration/cellHashProviderFactory';
import { InteractiveWindowView } from '../../notebook/constants';
import { BaseError } from '../../../common/errors/types';

// Helper interface for the set_next_input execute reply payload
interface ISetNextInputPayload {
    replace: boolean;
    source: 'set_next_input';
    text: string;
}

type ExecuteResult = nbformat.IExecuteResult & {
    transient?: { display_id?: string };
};
type DisplayData = nbformat.IDisplayData & {
    transient?: { display_id?: string };
};

export class CellExecutionFactory {
    constructor(
        private readonly kernel: IKernel,
        private readonly errorHandler: IDataScienceErrorHandler,
        private readonly appShell: IApplicationShell,
        private readonly disposables: IDisposableRegistry,
        private readonly controller: NotebookController,
        private readonly outputTracker: CellOutputDisplayIdTracker,
        private readonly cellHashProviderFactory: CellHashProviderFactory
    ) {}

    public create(cell: NotebookCell, metadata: Readonly<KernelConnectionMetadata>) {
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        return CellExecution.fromCell(
            cell,
            this.errorHandler,
            this.appShell,
            metadata,
            this.disposables,
            this.controller,
            this.outputTracker,
            this.cellHashProviderFactory.getOrCreate(this.kernel)
        );
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
    /**
     * To be used only in tests.
     */
    public static cellsCompletedForTesting = new WeakMap<NotebookCell, Deferred<void>>();
    /**
     * At any given point in time, we can only have one cell actively running.
     * This will keep track of that task.
     */
    private static activeNotebookCellExecution = new WeakMap<NotebookDocument, NotebookCellExecution | undefined>();

    private static sentExecuteCellTelemetry?: boolean;

    private stopWatch = new StopWatch();

    private readonly _result = createDeferred<NotebookCellRunState>();

    private started?: boolean;

    private _completed?: boolean;
    private startTime?: number;
    private endTime?: number;
    private execution?: NotebookCellExecution;
    private temporaryExecution?: NotebookCellExecution;
    private previousResultsToRestore?: NotebookCellExecutionSummary;
    private cancelHandled = false;
    private cellHasErrorsInOutput?: boolean;
    /**
     * We keep track of the last output that was used to store stream text.
     * We need this so that we can update it later on (when we get new data for the same stream).
     * If users clear outputs or if we have a new output other than stream, then clear this item.
     * Because if after the stream we have an image, then the stream is not the last output item, hence its cleared.
     */
    private lastUsedStreamOutput?: { stream: 'stdout' | 'stderr'; text: string; output: NotebookCellOutput };
    private request: Kernel.IShellFuture<KernelMessage.IExecuteRequestMsg, KernelMessage.IExecuteReplyMsg> | undefined;
    private readonly disposables: IDisposable[] = [];
    private readonly prompts = new Set<CancellationTokenSource>();
    private _preExecuteEmitter = new EventEmitter<NotebookCell>();
    private session?: IJupyterSession;
    private constructor(
        public readonly cell: NotebookCell,
        private readonly errorHandler: IDataScienceErrorHandler,
        private readonly applicationService: IApplicationShell,
        private readonly kernelConnection: Readonly<KernelConnectionMetadata>,
        disposables: IDisposableRegistry,
        private readonly controller: NotebookController,
        private readonly outputDisplayIdTracker: CellOutputDisplayIdTracker,
        private readonly cellHashProvider: ICellHashProvider
    ) {
        disposables.push(this);
        workspace.onDidCloseTextDocument(
            (e) => {
                // If the cell is deleted, then dispose the request object.
                // No point keeping it alive, just chewing resources.
                if (e === this.cell.document) {
                    this.request?.dispose(); // NOSONAR
                    if (this.started && !this._completed) {
                        this.completedDueToCancellation();
                    }
                }
            },
            this,
            this.disposables
        );
        notebooks.onDidChangeCellOutputs(
            (e) => {
                if (e.cells.includes(this.cell) && this.cell.outputs.length === 0) {
                    // keep track of the fact that user has cleared the output.
                    this.clearLastUsedStreamOutput();
                }
            },
            this,
            this.disposables
        );
        NotebookCellStateTracker.setCellState(cell, NotebookCellExecutionState.Idle);
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
            this.execution = controller.createNotebookCellExecution(this.cell);
            NotebookCellStateTracker.setCellState(cell, NotebookCellExecutionState.Pending);
        }
    }

    public static fromCell(
        cell: NotebookCell,
        errorHandler: IDataScienceErrorHandler,
        appService: IApplicationShell,
        metadata: Readonly<KernelConnectionMetadata>,
        disposables: IDisposableRegistry,
        controller: NotebookController,
        outputTracker: CellOutputDisplayIdTracker,
        cellHashProvider: ICellHashProvider
    ) {
        return new CellExecution(
            cell,
            errorHandler,
            appService,
            metadata,
            disposables,
            controller,
            outputTracker,
            cellHashProvider
        );
    }
    public async start(session: IJupyterSession) {
        this.session = session;
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
        CellExecution.activeNotebookCellExecution.set(this.cell.notebook, this.execution);
        this.execution?.start(this.startTime);
        NotebookCellStateTracker.setCellState(this.cell, NotebookCellExecutionState.Executing);
        this.clearLastUsedStreamOutput();
        // Await here, so that the UI updates on the progress & we clear the output.
        // Else when running cells with existing outputs, the outputs don't get cleared & it doesn't look like its running.
        // Ideally we shouldn't have any awaits, but here we want the UI to get updated.
        await this.execution?.clearOutput();
        this.stopWatch.reset();

        // Begin the request that will modify our cell.
        this.execute(session)
            .catch((e) => this.completedWithErrors(e))
            .finally(() => this.dispose())
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
        // Close all of the prompts (if we any any UI prompts asking user for input).
        this.prompts.forEach((item) => item.cancel());
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
        traceCellMessage(this.cell, 'Execution disposed');
        disposeAllDisposables(this.disposables);
        this.prompts.forEach((item) => item.dispose());
        this.prompts.clear();
    }
    private clearLastUsedStreamOutput() {
        this.lastUsedStreamOutput = undefined;
    }
    private completedWithErrors(error: Partial<Error>) {
        traceWarning(`Cell completed with errors`, error);
        traceCellMessage(this.cell, 'Completed with errors');
        this.sendPerceivedCellExecute();

        traceCellMessage(this.cell, 'Update with error state & output');
        // No need to append errors related to failures in Kernel execution in output.
        // We will display messages for those.
        if (!(error instanceof BaseError)) {
            this.execution?.appendOutput([translateErrorOutput(createErrorOutput(error))]).then(noop, noop);
        }

        this.endCellTask('failed');
        this._completed = true;

        // If the kernel is dead, then no point handling errors.
        // We have other code that deals with kernels dying.
        // We're only concerned with failures in execution while kernel is still running.
        let handleError = true;
        if (this.session?.disposed || this.session?.status === 'terminating' || this.session?.status === 'dead') {
            handleError = false;
        }
        if (handleError) {
            this.errorHandler
                .handleKernelError((error as unknown) as Error, 'execution', this.kernelConnection)
                .ignoreErrors();
        }
        traceCellMessage(this.cell, 'Completed with errors, & resolving');
        this._result.resolve(NotebookCellRunState.Error);
    }
    private get isEmptyCodeCell(): boolean {
        return this.cell.document.getText().trim().length === 0;
    }
    private completedSuccessfully() {
        traceCellMessage(this.cell, 'Completed successfully');
        this.sendPerceivedCellExecute();
        // If we requested a cancellation, then assume it did not even run.
        // If it did, then we'd get an interrupt error in the output.
        let runState = this.isEmptyCodeCell ? NotebookCellRunState.Idle : NotebookCellRunState.Success;

        let success: 'success' | 'failed' = 'success';
        // If there are any errors in the cell, then change status to error.
        if (this.cellHasErrorsInOutput) {
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
        if (CellExecution.activeNotebookCellExecution.get(this.cell.notebook) === this.execution) {
            CellExecution.activeNotebookCellExecution.set(this.cell.notebook, undefined);
        }
        NotebookCellStateTracker.setCellState(this.cell, NotebookCellExecutionState.Idle);
        this.execution = undefined;
    }
    /**
     * Assume we run cell A
     * Now run cell B, and this will update cell A.
     * The way it works is, the request object created for cell A will get a message saying update your output.
     * Cell A has completed, hence there's no execution task, we should create one or re-use an existing one.
     * Creating one results in side effects such as execution order getting reset and timers starting.
     * Hence where possible re-use an existing cell execution task associated with this document.
     */
    private createTemporaryTask() {
        if (this.cell.document.isClosed) {
            return;
        }
        // If we have an active task, use that instead of creating a new task.
        const existingTask = CellExecution.activeNotebookCellExecution.get(this.cell.notebook);
        if (existingTask) {
            return existingTask;
        }

        // Create a temporary task.
        this.previousResultsToRestore = { ...(this.cell.executionSummary || {}) };
        this.temporaryExecution = this.controller.createNotebookCellExecution(this.cell);
        this.temporaryExecution?.start();
        if (this.previousResultsToRestore?.executionOrder && this.execution) {
            this.execution.executionOrder = this.previousResultsToRestore.executionOrder;
        }
        return this.temporaryExecution;
    }
    private endTemporaryTask() {
        if (this.previousResultsToRestore?.executionOrder && this.execution) {
            this.execution.executionOrder = this.previousResultsToRestore.executionOrder;
        }
        if (this.previousResultsToRestore && this.temporaryExecution) {
            if (this.previousResultsToRestore.executionOrder) {
                this.temporaryExecution.executionOrder = this.previousResultsToRestore.executionOrder;
            }
            this.temporaryExecution.end(
                this.previousResultsToRestore.success,
                this.previousResultsToRestore.timing?.endTime
            );
        } else {
            // Undefined for not success or failure
            this.temporaryExecution?.end(undefined);
        }
        this.previousResultsToRestore = undefined;
        this.temporaryExecution = undefined;
    }

    private completedDueToCancellation() {
        traceCellMessage(this.cell, 'Completed due to cancellation');
        this.endCellTask('cancelled');
        this._completed = true;
        traceCellMessage(this.cell, 'Cell cancelled & resolving');
        this._result.resolve(NotebookCellRunState.Idle);
    }

    private sendPerceivedCellExecute() {
        const props = { notebook: true };
        if (!CellExecution.sentExecuteCellTelemetry) {
            CellExecution.sentExecuteCellTelemetry = true;
            sendTelemetryEvent(Telemetry.ExecuteCellPerceivedCold, this.stopWatch.elapsedTime, props);
        } else {
            sendTelemetryEvent(Telemetry.ExecuteCellPerceivedWarm, this.stopWatch.elapsedTime, props);
        }
    }
    private canExecuteCell() {
        // Raw cells cannot be executed.
        if (isPythonKernelConnection(this.kernelConnection) && this.cell.document.languageId === 'raw') {
            return false;
        }

        return !this.cell.document.isClosed;
    }

    private async execute(session: IJupyterSession) {
        traceCellMessage(this.cell, 'Send code for execution');
        await this.executeCodeCell(this.cell.document.getText().replace(/\r\n/g, '\n'), session);
    }

    private async executeCodeCell(code: string, session: IJupyterSession) {
        // Skip if no code to execute
        if (code.trim().length === 0 || this.cell.document.isClosed) {
            traceCellMessage(this.cell, 'Empty cell execution');
            return this.completedSuccessfully();
        }

        // Generate metadata from our cell (some kernels expect this.)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const metadata: any = {
            ...(this.cell.metadata?.custom?.metadata || {}), // Send the Cell Metadata
            ...{ cellId: this.cell.document.uri.toString() }
        };

        try {
            // Compute the hash for the cell we're about to execute if on the interactive window
            let hash: ICellHash | undefined = undefined;
            if (this.cell.notebook.notebookType === InteractiveWindowView) {
                hash = await this.cellHashProvider.addCellHash(this.cell);

                // If using ipykernel 6, we need to set the IPYKERNEL_CELL_NAME so that
                // debugging can work. However this code is harmless for IPYKERNEL 5 so just always do it
                // No need to wait for the result.
                session.requestExecute(
                    {
                        code: `import os;os.environ["IPYKERNEL_CELL_NAME"] = '${hash?.runtimeFile}'`,
                        silent: false,
                        stop_on_error: false,
                        allow_stdin: true,
                        store_history: false
                    },
                    true
                );
            }

            // At this point we're about to ACTUALLY execute some code. Fire an event to indicate that
            this._preExecuteEmitter.fire(this.cell);

            // For Jupyter requests, silent === don't output, while store_history === don't update execution count
            // https://jupyter-client.readthedocs.io/en/stable/api/client.html#jupyter_client.KernelClient.execute
            this.request = session.requestExecute(
                {
                    code: hash?.code || code,
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
        // Listen to messages and update our cell execution state appropriately
        // Keep track of our clear state
        const clearState = new RefBool(false);

        const request = this.request;
        request.onIOPub = (msg) => {
            // Cell has been deleted or the like.
            if (this.cell.document.isClosed) {
                request.dispose();
            }
            this.handleIOPub(clearState, msg);
        };
        request.onReply = (msg) => {
            // Cell has been deleted or the like.
            if (this.cell.document.isClosed) {
                request.dispose();
            }
            this.handleReply(clearState, msg);
        };
        request.onStdin = this.handleInputRequest.bind(this, session);

        // WARNING: Do not dispose `request`.
        // Even after request.done & execute_reply is sent we could have more messages coming from iopub.
        // We have tests for this & check https://github.com/microsoft/vscode-jupyter/issues/232 & https://github.com/jupyter/jupyter_client/issues/297

        try {
            // When the request finishes we are done
            // request.done resolves even before all iopub messages have been sent through.
            // Solution is to wait for all messages to get processed.
            traceCellMessage(this.cell, 'Wait for jupyter execution');
            await request.done;
            traceCellMessage(this.cell, 'Jupyter execution completed');
            this.completedSuccessfully();
            traceCellMessage(this.cell, 'Executed successfully in executeCell');
        } catch (ex) {
            traceError('Error in waiting for cell to complete', ex);
            // @jupyterlab/services throws a `Canceled` error when the kernel is interrupted.
            // Such an error must be ignored.
            if (ex && ex instanceof Error && ex.message.includes('Canceled')) {
                this.completedSuccessfully();
                traceCellMessage(this.cell, 'Cancellation execution error');
            } else {
                traceCellMessage(this.cell, 'Some other execution error');
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                this.completedWithErrors(ex as any);
            }
        }
    }
    @swallowExceptions()
    private handleIOPub(clearState: RefBool, msg: KernelMessage.IIOPubMessage) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services');

        try {
            if (jupyterLab.KernelMessage.isExecuteResultMsg(msg)) {
                traceInfoIfCI('KernelMessage = ExecuteResult');
                this.handleExecuteResult(msg as KernelMessage.IExecuteResultMsg, clearState);
            } else if (jupyterLab.KernelMessage.isExecuteInputMsg(msg)) {
                this.handleExecuteInput(msg as KernelMessage.IExecuteInputMsg, clearState);
            } else if (jupyterLab.KernelMessage.isStatusMsg(msg)) {
                traceInfoIfCI('KernelMessage = StatusMessage');
                // Status is handled by the result promise. While it is running we are active. Otherwise we're stopped.
                // So ignore status messages.
                const statusMsg = msg as KernelMessage.IStatusMsg;
                this.handleStatusMessage(statusMsg, clearState);
            } else if (jupyterLab.KernelMessage.isStreamMsg(msg)) {
                traceInfoIfCI(
                    'KernelMessage = StreamMessage',
                    `Cell Index ${this.cell.index}, Stream '${msg.content.name}`,
                    msg.content.text
                );
                this.handleStreamMessage(msg as KernelMessage.IStreamMsg, clearState);
            } else if (jupyterLab.KernelMessage.isDisplayDataMsg(msg)) {
                traceInfoIfCI('KernelMessage = DisplayMessage');
                this.handleDisplayData(msg as KernelMessage.IDisplayDataMsg, clearState);
            } else if (jupyterLab.KernelMessage.isUpdateDisplayDataMsg(msg)) {
                traceInfoIfCI('KernelMessage = UpdateDisplayMessage');
                this.handleUpdateDisplayDataMessage(msg);
            } else if (jupyterLab.KernelMessage.isClearOutputMsg(msg)) {
                traceInfoIfCI('KernelMessage = CleanOutput');
                this.handleClearOutput(msg as KernelMessage.IClearOutputMsg, clearState);
            } else if (jupyterLab.KernelMessage.isErrorMsg(msg)) {
                traceInfoIfCI('KernelMessage = ErrorMessage');
                this.handleError(msg as KernelMessage.IErrorMsg, clearState);
            } else if (jupyterLab.KernelMessage.isCommOpenMsg(msg)) {
                // Noop.
            } else if (jupyterLab.KernelMessage.isCommMsgMsg(msg)) {
                // Noop.
            } else if (jupyterLab.KernelMessage.isCommCloseMsg(msg)) {
                // Noop.
            } else {
                traceWarning(`Unknown message ${msg.header.msg_type} : hasData=${'data' in msg.content}`);
            }

            // Set execution count, all messages should have it
            if ('execution_count' in msg.content && typeof msg.content.execution_count === 'number' && this.execution) {
                traceInfoIfCI(`Exec Count = ${msg.content.execution_count}`);
                this.execution.executionOrder = msg.content.execution_count;
            }
        } catch (err) {
            traceError(`Cell (index = ${this.cell.index}) execution completed with errors (2).`, err);
            // If not a restart error, then tell the subscriber
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.completedWithErrors(err as any);
        }
    }

    private addToCellData(
        output: ExecuteResult | DisplayData | nbformat.IStream | nbformat.IError | nbformat.IOutput,
        clearState: RefBool
    ) {
        const cellOutput = cellOutputToVSCCellOutput(output);
        const displayId =
            'transient' in output &&
            typeof output.transient === 'object' &&
            output.transient &&
            'display_id' in output.transient &&
            typeof output.transient?.display_id === 'string'
                ? output.transient?.display_id
                : undefined;
        if (this.cell.document.isClosed) {
            return;
        }
        traceCellMessage(this.cell, 'Update output');
        // Clear if necessary
        if (clearState.value) {
            this.clearLastUsedStreamOutput();
            this.execution?.clearOutput().then(noop, noop);
            clearState.update(false);
        }
        // Keep track of the displa_id against the output item, we might need this to update this later.
        if (displayId) {
            this.outputDisplayIdTracker.trackOutputByDisplayId(this.cell, displayId, cellOutput);
        }

        // Append to the data (we would push here but VS code requires a recreation of the array)
        // Possible execution of cell has completed (the task would have been disposed).
        // This message could have come from a background thread.
        // In such circumstances, create a temporary task & use that to update the output (only cell execution tasks can update cell output).
        const task = this.execution || this.createTemporaryTask();
        this.clearLastUsedStreamOutput();
        task?.appendOutput([cellOutput]).then(noop, noop);
        this.endTemporaryTask();
    }

    private async handleInputRequest(session: IJupyterSession, msg: KernelMessage.IStdinMessage) {
        // Ask the user for input
        if (msg.content && 'prompt' in msg.content) {
            const cancelToken = new CancellationTokenSource();
            this.prompts.add(cancelToken);
            const hasPassword = msg.content.password !== null && (msg.content.password as boolean);
            await this.applicationService
                .showInputBox(
                    {
                        prompt: msg.content.prompt ? msg.content.prompt.toString() : '',
                        ignoreFocusOut: true,
                        password: hasPassword
                    },
                    cancelToken.token
                )
                .then((v) => {
                    session.sendInputReply({ value: v || '', status: 'ok' });
                }, noop);

            this.prompts.delete(cancelToken);
        }
    }

    // See this for docs on the messages:
    // https://jupyter-client.readthedocs.io/en/latest/messaging.html#messaging-in-jupyter
    private handleExecuteResult(msg: KernelMessage.IExecuteResultMsg, clearState: RefBool) {
        this.addToCellData(
            {
                output_type: 'execute_result',
                data: msg.content.data,
                metadata: msg.content.metadata,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                transient: msg.content.transient as any, // NOSONAR
                execution_count: msg.content.execution_count
            },
            clearState
        );
    }

    private handleExecuteReply(msg: KernelMessage.IExecuteReplyMsg, clearState: RefBool) {
        const reply = msg.content as KernelMessage.IExecuteReply;
        if (reply.payload) {
            reply.payload.forEach((payload) => {
                if (
                    payload.source &&
                    payload.source === 'set_next_input' &&
                    'text' in payload &&
                    'replace' in payload
                ) {
                    this.handleSetNextInput((payload as unknown) as ISetNextInputPayload);
                }
                if (payload.data && payload.data.hasOwnProperty('text/plain')) {
                    this.addToCellData(
                        {
                            // Mark as stream output so the text is formatted because it likely has ansi codes in it.
                            output_type: 'stream',
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            text: (payload.data as any)['text/plain'].toString(),
                            name: 'stdout',
                            metadata: {},
                            execution_count: reply.execution_count
                        },
                        clearState
                    );
                }
            });
        }
    }

    // Handle our set_next_input message, which can either replace or insert a new cell with text
    private handleSetNextInput(payload: ISetNextInputPayload) {
        const edit = new WorkspaceEdit();
        if (payload.replace) {
            // Replace the contents of the current cell with text
            edit.replace(
                this.cell.document.uri,
                new Range(
                    this.cell.document.lineAt(0).range.start,
                    this.cell.document.lineAt(this.cell.document.lineCount - 1).range.end
                ),
                payload.text
            );
        } else {
            // Add a new cell after the current with text
            traceCellMessage(this.cell, 'Create new cell after current');
            const cellData = new NotebookCellData(NotebookCellKind.Code, payload.text, this.cell.document.languageId);
            cellData.outputs = [];
            cellData.metadata = {};
            edit.replaceNotebookCells(
                this.cell.notebook.uri,
                new NotebookRange(this.cell.index + 1, this.cell.index + 1),
                [cellData]
            );
        }
        workspace.applyEdit(edit).then(noop, noop);
    }

    private handleExecuteInput(msg: KernelMessage.IExecuteInputMsg, _clearState: RefBool) {
        if (msg.content.execution_count && this.execution) {
            this.execution.executionOrder = msg.content.execution_count;
        }
    }

    private handleStatusMessage(msg: KernelMessage.IStatusMsg, _clearState: RefBool) {
        traceCellMessage(this.cell, `Kernel switching to ${msg.content.execution_state}`);
    }
    private handleStreamMessage(msg: KernelMessage.IStreamMsg, clearState: RefBool) {
        // eslint-disable-next-line complexity
        traceCellMessage(this.cell, 'Update streamed output');
        // Possible execution of cell has completed (the task would have been disposed).
        // This message could have come from a background thread.
        // In such circumstances, create a temporary task & use that to update the output (only cell execution tasks can update cell output).
        const task = this.execution || this.createTemporaryTask();

        // Clear output if waiting for a clear
        const clearOutput = clearState.value;
        if (clearOutput) {
            this.clearLastUsedStreamOutput();
            task?.clearOutput().then(noop, noop);
            clearState.update(false);
        }
        // Ensure we append to previous output, only if the streams as the same &
        // If the last output is the desired stream type.
        if (this.lastUsedStreamOutput?.stream === msg.content.name) {
            // Get the jupyter output from the vs code output (so we can concatenate the text ourselves).
            let existingOutputText = this.lastUsedStreamOutput.text;
            let newContent = msg.content.text;
            // Look for the ansi code `<char27>[A`. (this means move up)
            // Not going to support `[2A` (not for now).
            const moveUpCode = `${String.fromCharCode(27)}[A`;
            if (msg.content.text.startsWith(moveUpCode)) {
                // Split message by lines & strip out the last n lines (where n = number of lines to move cursor up).
                const existingOutputLines = existingOutputText.splitLines({
                    trim: false,
                    removeEmptyEntries: false
                });
                if (existingOutputLines.length) {
                    existingOutputLines.pop();
                }
                existingOutputText = existingOutputLines.join('\n');
                newContent = newContent.substring(moveUpCode.length);
            }
            // Create a new output item with the concatenated string.
            this.lastUsedStreamOutput.text = formatStreamText(
                concatMultilineString(`${existingOutputText}${newContent}`)
            );
            const output = cellOutputToVSCCellOutput({
                output_type: 'stream',
                name: msg.content.name,
                text: this.lastUsedStreamOutput.text
            });
            task?.replaceOutputItems(output.items, this.lastUsedStreamOutput.output).then(noop, noop);
        } else if (clearOutput) {
            // Replace the current outputs with a single new output.
            const text = formatStreamText(concatMultilineString(msg.content.text));
            const output = cellOutputToVSCCellOutput({
                output_type: 'stream',
                name: msg.content.name,
                text
            });
            this.lastUsedStreamOutput = { output, stream: msg.content.name, text };
            task?.replaceOutput([output]).then(noop, noop);
        } else {
            // Create a new output
            const text = formatStreamText(concatMultilineString(msg.content.text));
            const output = cellOutputToVSCCellOutput({
                output_type: 'stream',
                name: msg.content.name,
                text
            });
            this.lastUsedStreamOutput = { output, stream: msg.content.name, text };
            task?.appendOutput([output]).then(noop, noop);
        }
        this.endTemporaryTask();
    }

    private handleDisplayData(msg: KernelMessage.IDisplayDataMsg, clearState: RefBool) {
        const output = {
            output_type: 'display_data',
            data: handleTensorBoardDisplayDataOutput(msg.content.data),
            metadata: msg.content.metadata,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            transient: msg.content.transient as any // NOSONAR
        };
        this.addToCellData(output, clearState);
    }

    private handleClearOutput(msg: KernelMessage.IClearOutputMsg, clearState: RefBool) {
        // If the message says wait, add every message type to our clear state. This will
        // make us wait for this type of output before we clear it.
        if (msg && msg.content.wait) {
            clearState.update(true);
        } else {
            // Possible execution of cell has completed (the task would have been disposed).
            // This message could have come from a background thread.
            // In such circumstances, create a temporary task & use that to update the output (only cell execution tasks can update cell output).
            // Clear all outputs and start over again.
            const task = this.execution || this.createTemporaryTask();
            this.clearLastUsedStreamOutput();
            task?.clearOutput().then(noop, noop);
            this.endTemporaryTask();
        }
    }

    private handleError(msg: KernelMessage.IErrorMsg, clearState: RefBool) {
        const output: nbformat.IError = {
            output_type: 'error',
            ename: msg.content.ename,
            evalue: msg.content.evalue,
            traceback: this.cellHashProvider.modifyTraceback(msg.content.traceback)
        };

        this.addToCellData(output, clearState);
        this.cellHasErrorsInOutput = true;
    }

    @swallowExceptions()
    private handleReply(clearState: RefBool, msg: KernelMessage.IShellControlMessage) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services');

        if (jupyterLab.KernelMessage.isExecuteReplyMsg(msg)) {
            this.handleExecuteReply(msg, clearState);

            // Set execution count, all messages should have it
            if ('execution_count' in msg.content && typeof msg.content.execution_count === 'number' && this.execution) {
                this.execution.executionOrder = msg.content.execution_count;
            }
        }
    }
    /**
     * Execution of Cell B could result in updates to output in Cell A.
     */
    private handleUpdateDisplayDataMessage(msg: KernelMessage.IUpdateDisplayDataMsg) {
        const displayId = msg.content.transient.display_id;
        if (!displayId) {
            return;
        }
        const outputToBeUpdated = this.outputDisplayIdTracker.getMappedOutput(this.cell.notebook, displayId);
        if (!outputToBeUpdated) {
            return;
        }
        const output = translateCellDisplayOutput(outputToBeUpdated);
        const newOutput = cellOutputToVSCCellOutput({
            ...output,
            data: msg.content.data,
            metadata: msg.content.metadata
        } as nbformat.IDisplayData);
        // If there was no output and still no output, then nothing to do.
        if (outputToBeUpdated.items.length === 0 && newOutput.items.length === 0) {
            return;
        }
        // Compare each output item (at the end of the day everything is serializable).
        // Hence this is a safe comparison.
        if (outputToBeUpdated.items.length === newOutput.items.length) {
            let allAllOutputItemsSame = true;
            for (let index = 0; index < outputToBeUpdated.items.length; index++) {
                if (!fastDeepEqual(outputToBeUpdated.items[index], newOutput.items[index])) {
                    allAllOutputItemsSame = false;
                    break;
                }
            }
            if (allAllOutputItemsSame) {
                // If everything is still the same, then there's nothing to update.
                return;
            }
        }
        // Possible execution of cell has completed (the task would have been disposed).
        // This message could have come from a background thread.
        // In such circumstances, create a temporary task & use that to update the output (only cell execution tasks can update cell output).
        const task = this.execution || this.createTemporaryTask();
        task?.replaceOutputItems(newOutput.items, outputToBeUpdated).then(noop, noop);
        this.endTemporaryTask();
    }
}
