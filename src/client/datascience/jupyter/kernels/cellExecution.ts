// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as fastDeepEqual from 'fast-deep-equal';
import { nbformat } from '@jupyterlab/coreutils';
import type { KernelMessage } from '@jupyterlab/services/lib/kernel/messages';
import {
    ExtensionMode,
    notebook,
    NotebookCell,
    NotebookCellExecutionTask,
    NotebookCellKind,
    NotebookCellPreviousExecutionResult,
    NotebookDocument,
    workspace
} from 'vscode';
import { concatMultilineString, formatStreamText } from '../../../../datascience-ui/common';
import { createErrorOutput } from '../../../../datascience-ui/common/cellFactory';
import { IApplicationShell } from '../../../common/application/types';
import { traceError, traceErrorIf, traceInfo, traceInfoIf, traceWarning } from '../../../common/logger';
import { RefBool } from '../../../common/refBool';
import { IDisposableRegistry, IExtensionContext } from '../../../common/types';
import { createDeferred, Deferred } from '../../../common/utils/async';
import { swallowExceptions } from '../../../common/utils/decorators';
import { noop } from '../../../common/utils/misc';
import { StopWatch } from '../../../common/utils/stopWatch';
import { sendTelemetryEvent } from '../../../telemetry';
import { Telemetry } from '../../constants';
import {
    addNewCellAfter,
    handleTensorBoardDisplayDataOutput,
    updateCellCode
} from '../../notebook/helpers/executionHelpers';
import {
    cellOutputToVSCCellOutput,
    getCellStatusMessageBasedOnFirstCellErrorOutput,
    hasErrorOutput,
    isStreamOutput,
    traceCellMessage,
    translateCellDisplayOutput,
    translateErrorOutput
} from '../../notebook/helpers/helpers';
import { chainWithPendingUpdates } from '../../notebook/helpers/notebookUpdater';
import { IDataScienceErrorHandler, IJupyterSession, INotebook, INotebookExecutionLogger } from '../../types';
import { isPythonKernelConnection } from './helpers';
import { KernelConnectionMetadata, NotebookCellRunState } from './types';
import { Kernel } from '@jupyterlab/services';

// Helper interface for the set_next_input execute reply payload
interface ISetNextInputPayload {
    replace: boolean;
    source: 'set_next_input';
    text: string;
}

export class CellExecutionFactory {
    constructor(
        private readonly errorHandler: IDataScienceErrorHandler,
        private readonly appShell: IApplicationShell,
        private readonly context: IExtensionContext,
        private readonly disposables: IDisposableRegistry
    ) {}

    public create(cell: NotebookCell, metadata: Readonly<KernelConnectionMetadata>) {
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        return CellExecution.fromCell(cell, this.errorHandler, this.appShell, metadata, this.context, this.disposables);
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
export class CellExecution {
    public get result(): Promise<NotebookCellRunState | undefined> {
        return this._result.promise;
    }
    /**
     * To be used only in tests.
     */
    public static cellsCompletedForTesting = new WeakMap<NotebookCell, Deferred<void>>();
    /**
     * At any given point in time, we can only have one cell actively running.
     * This will keep track of that task.
     */
    private static activeNotebookCellExecutionTask = new WeakMap<
        NotebookDocument,
        NotebookCellExecutionTask | undefined
    >();

    private static sentExecuteCellTelemetry?: boolean;

    private stopWatch = new StopWatch();

    private readonly _result = createDeferred<NotebookCellRunState | undefined>();

    private started?: boolean;

    private _completed?: boolean;
    private startTime?: number;
    private readonly initPromise?: Promise<void>;
    private task?: NotebookCellExecutionTask;
    private temporaryTask?: NotebookCellExecutionTask;
    private previousResultsToRestore?: NotebookCellPreviousExecutionResult;
    private lastRunDuration?: number;
    private cancelHandled = false;
    private requestHandlerChain = Promise.resolve();
    private request: Kernel.IShellFuture<KernelMessage.IExecuteRequestMsg, KernelMessage.IExecuteReplyMsg> | undefined;
    private constructor(
        public readonly cell: NotebookCell,
        private readonly errorHandler: IDataScienceErrorHandler,
        private readonly applicationService: IApplicationShell,
        private readonly kernelConnection: Readonly<KernelConnectionMetadata>,
        disposables: IDisposableRegistry,
        extensionContext: IExtensionContext
    ) {
        // These are only used in the tests.
        // See where this is used to understand its purpose.
        if (
            !CellExecution.cellsCompletedForTesting.has(cell) ||
            CellExecution.cellsCompletedForTesting.get(cell)!.completed
        ) {
            CellExecution.cellsCompletedForTesting.set(cell, createDeferred<void>());
        } else {
            traceErrorIf(
                extensionContext.extensionMode !== ExtensionMode.Production,
                `Add new Cell Completion Deferred for ${cell.index}`
            );
        }

        workspace.onDidCloseTextDocument(
            (e) => {
                // If the cell is deleted, then dispose the request object.
                // No point keeping it alive, just chewing resources.
                if (e === this.cell.document) {
                    this.request?.dispose(); // NOSONAR
                }
                if (this.started && !this._completed) {
                    this.completedDueToCancellation().catch((ex) =>
                        traceInfo('Failures when cancelling due to cell removal', ex)
                    );
                }
            },
            this,
            disposables
        );
        if (this.canExecuteCell()) {
            this.task = notebook.createNotebookCellExecutionTask(
                this.cell.notebook.uri,
                this.cell.index,
                this.kernelConnection.id
            );
            this.initPromise = this.enqueue();
        }
    }

    public static fromCell(
        cell: NotebookCell,
        errorHandler: IDataScienceErrorHandler,
        appService: IApplicationShell,
        metadata: Readonly<KernelConnectionMetadata>,
        context: IExtensionContext,
        disposables: IDisposableRegistry
    ) {
        return new CellExecution(cell, errorHandler, appService, metadata, disposables, context);
    }
    public async start(notebook: INotebook) {
        if (this.cancelHandled) {
            traceCellMessage(this.cell, 'Not starting as it was cancelled');
            return;
        }
        traceCellMessage(this.cell, 'Start execution');
        traceInfoIf(
            !!process.env.VSC_JUPYTER_FORCE_LOGGING,
            `Cell Exec contents ${this.cell.document.getText().substring(0, 50)}...`
        );
        if (!this.canExecuteCell()) {
            this.task?.end({});
            this.task = undefined;
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
        CellExecution.activeNotebookCellExecutionTask.set(this.cell.notebook, this.task);
        this.task?.start({ startTime: this.startTime });
        await Promise.all([this.initPromise, this.task?.clearOutput()]);
        this.stopWatch.reset();

        // Begin the request that will modify our cell.
        this.execute(notebook.session, notebook.getLoggers())
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
        await this.initPromise;

        await this.completedDueToCancellation();
        this.dispose();
    }
    /**
     * This method is called when all execution has been completed (successfully or failed).
     * Or when execution has been cancelled.
     */
    private dispose() {
        traceCellMessage(this.cell, 'Execution disposed');
        const deferred = CellExecution.cellsCompletedForTesting.get(this.cell);
        if (deferred) {
            deferred.resolve();
        }
    }

    private async completedWithErrors(error: Partial<Error>) {
        traceCellMessage(this.cell, 'Completed with errors');
        this.sendPerceivedCellExecute();

        await chainWithPendingUpdates(this.cell.notebook, async () => {
            traceCellMessage(this.cell, 'Update with error state & output');
            await this.task?.appendOutput([translateErrorOutput(createErrorOutput(error))]);
        });

        this.endCellTask('failed');
        this._completed = true;
        this.errorHandler.handleError((error as unknown) as Error).ignoreErrors();
        traceCellMessage(this.cell, 'Completed with errors, & resolving');
        this._result.resolve(NotebookCellRunState.Error);
    }
    private get isEmptyCodeCell(): boolean {
        return this.cell.document.getText().trim().length === 0;
    }
    private async completedSuccessfully() {
        traceCellMessage(this.cell, 'Completed successfully');
        this.sendPerceivedCellExecute();
        let statusMessage = '';
        // If we requested a cancellation, then assume it did not even run.
        // If it did, then we'd get an interrupt error in the output.
        let runState = this.isEmptyCodeCell ? NotebookCellRunState.Idle : NotebookCellRunState.Success;

        let success: 'success' | 'failed' = 'success';
        // If there are any errors in the cell, then change status to error.
        if (hasErrorOutput(this.cell.outputs)) {
            success = 'failed';
            runState = NotebookCellRunState.Error;
            statusMessage = getCellStatusMessageBasedOnFirstCellErrorOutput(this.cell.outputs);
        }

        await chainWithPendingUpdates(this.cell.notebook, (edit) => {
            traceCellMessage(this.cell, `Update cell state ${runState} and message '${statusMessage}'`);
            const metadata = this.cell.metadata.with({ statusMessage });
            edit.replaceNotebookCellMetadata(this.cell.notebook.uri, this.cell.index, metadata);
        });

        this.endCellTask(success);
        this._completed = true;
        traceCellMessage(this.cell, 'Completed successfully & resolving');
        this._result.resolve(runState);
    }
    private endCellTask(success: 'success' | 'failed' | 'cancelled') {
        if (this.isEmptyCodeCell) {
            this.task?.end({});
        } else if (success === 'success' || success === 'failed') {
            this.lastRunDuration = this.stopWatch.elapsedTime;
            this.task?.end({ duration: this.lastRunDuration, success: success === 'success' });
        } else {
            // Cell was cancelled.
            this.task?.end({});
        }
        if (CellExecution.activeNotebookCellExecutionTask.get(this.cell.notebook) === this.task) {
            CellExecution.activeNotebookCellExecutionTask.set(this.cell.notebook, undefined);
        }
        this.task = undefined;
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
        const existingTask = CellExecution.activeNotebookCellExecutionTask.get(this.cell.notebook);
        if (existingTask) {
            return existingTask;
        }

        // Create a temporary task.
        this.previousResultsToRestore = { ...(this.cell.previousResult || {}) };
        this.temporaryTask = notebook.createNotebookCellExecutionTask(
            this.cell.notebook.uri,
            this.cell.index,
            this.kernelConnection.id
        );
        this.temporaryTask?.start({});
        if (this.previousResultsToRestore.executionOrder && this.task) {
            this.task.executionOrder = this.previousResultsToRestore.executionOrder;
        }
        return this.temporaryTask;
    }
    private endTemporaryTask() {
        if (this.previousResultsToRestore?.executionOrder && this.task) {
            this.task.executionOrder = this.previousResultsToRestore.executionOrder;
        }
        if (this.previousResultsToRestore) {
            this.temporaryTask?.end({
                duration: this.previousResultsToRestore.duration,
                success: this.previousResultsToRestore.success,
                executionOrder: this.previousResultsToRestore.executionOrder
            });
        } else {
            this.temporaryTask?.end({});
        }
        this.previousResultsToRestore = undefined;
        this.temporaryTask = undefined;
    }

    private async completedDueToCancellation() {
        traceCellMessage(this.cell, 'Completed due to cancellation');
        if (!this.cell.document.isClosed) {
            await chainWithPendingUpdates(this.cell.notebook, (edit) => {
                traceCellMessage(this.cell, 'Update cell statue as idle and message as empty');
                const metadata = this.cell.metadata.with({ statusMessage: '' });
                edit.replaceNotebookCellMetadata(this.cell.notebook.uri, this.cell.index, metadata);
            });
        }
        this.endCellTask('cancelled');
        this._completed = true;
        traceCellMessage(this.cell, 'Cell cancelled & resolving');
        this._result.resolve(NotebookCellRunState.Idle);
    }

    /**
     * Place in queue for execution with kernel.
     * (mark it as busy).
     */
    private async enqueue() {
        if (this.cell.document.isClosed) {
            return;
        }
        await chainWithPendingUpdates(this.cell.notebook, (edit) => {
            traceCellMessage(this.cell, 'Update cell state as it was enqueued');
            // We don't want any previous status anymore.
            const metadata = this.cell.metadata.with({ statusMessage: '' });
            edit.replaceNotebookCellMetadata(this.cell.notebook.uri, this.cell.index, metadata);
        });
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
        if (
            isPythonKernelConnection(this.kernelConnection) &&
            (this.cell.document.languageId === 'raw' || this.cell.document.languageId === 'plaintext')
        ) {
            return false;
        }

        return !this.cell.document.isClosed;
    }

    private async execute(session: IJupyterSession, loggers: INotebookExecutionLogger[]) {
        const code = this.cell.document.getText();
        traceCellMessage(this.cell, 'Send code for execution');
        await this.executeCodeCell(code, session, loggers);
    }

    private async executeCodeCell(code: string, session: IJupyterSession, loggers: INotebookExecutionLogger[]) {
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

        // For Jupyter requests, silent === don't output, while store_history === don't update execution count
        // https://jupyter-client.readthedocs.io/en/stable/api/client.html#jupyter_client.KernelClient.execute
        const request = (this.request = session.requestExecute(
            {
                code,
                silent: false,
                stop_on_error: false,
                allow_stdin: true,
                store_history: true
            },
            false,
            metadata
        ));

        // Listen to messages and update our cell execution state appropriately

        // Keep track of our clear state
        const clearState = new RefBool(false);

        // Listen to the response messages and update state as we go
        if (!request) {
            traceError(`Cell execution failed without request, for cell Index ${this.cell.index}`);
            return this.completedWithErrors(new Error('Session cannot generate requests')).then(noop, noop);
        }

        // Listen to messages & chain each (to process them in the order we get them).
        request.onIOPub = (msg) =>
            (this.requestHandlerChain = this.requestHandlerChain.then(() => {
                // Cell has been deleted or the like.
                if (this.cell.document.isClosed) {
                    request.dispose();
                    return Promise.resolve();
                }
                return this.handleIOPub(clearState, loggers, msg).catch(noop);
            }));
        request.onReply = (msg) =>
            (this.requestHandlerChain = this.requestHandlerChain.then(() => {
                // Cell has been deleted or the like.
                if (this.cell.document.isClosed) {
                    request.dispose();
                    return Promise.resolve();
                }
                return this.handleReply(clearState, msg).catch(noop);
            }));
        request.onStdin = this.handleInputRequest.bind(this, session);

        // WARNING: Do not dispose `request`.
        // Even after request.done & execute_reply is sent we could have more messages coming from iopub.
        // We have tests for this & check https://github.com/microsoft/vscode-jupyter/issues/232 & https://github.com/jupyter/jupyter_client/issues/297

        try {
            // When the request finishes we are done
            // request.done resolves even before all iopub messages have been sent through.
            // Solution is to wait for all messages to get processed.
            traceCellMessage(this.cell, 'Wait for jupyter execution');
            await Promise.all([request.done, this.requestHandlerChain]);
            traceCellMessage(this.cell, 'Jupyter execution completed');
            await this.completedSuccessfully();
            traceCellMessage(this.cell, 'Executed successfully in executeCell');
        } catch (ex) {
            // @jupyterlab/services throws a `Canceled` error when the kernel is interrupted.
            // Such an error must be ignored.
            if (ex && ex instanceof Error && ex.message === 'Canceled') {
                await this.completedSuccessfully();
                traceCellMessage(this.cell, 'Cancellation execution error');
            } else {
                traceCellMessage(this.cell, 'Some other execution error');
                await this.completedWithErrors(ex);
            }
        }
    }
    @swallowExceptions()
    private async handleIOPub(
        clearState: RefBool,
        loggers: INotebookExecutionLogger[],
        msg: KernelMessage.IIOPubMessage
    ) {
        // Let our loggers get a first crack at the message. They may change it
        loggers.forEach((f) => (msg = f.preHandleIOPub ? f.preHandleIOPub(msg) : msg));

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services');

        try {
            if (jupyterLab.KernelMessage.isExecuteResultMsg(msg)) {
                traceInfoIf(!!process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT, 'KernelMessage = ExecuteResult');
                await this.handleExecuteResult(msg as KernelMessage.IExecuteResultMsg, clearState);
            } else if (jupyterLab.KernelMessage.isExecuteInputMsg(msg)) {
                await this.handleExecuteInput(msg as KernelMessage.IExecuteInputMsg, clearState);
            } else if (jupyterLab.KernelMessage.isStatusMsg(msg)) {
                traceInfoIf(!!process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT, 'KernelMessage = StatusMessage');
                // Status is handled by the result promise. While it is running we are active. Otherwise we're stopped.
                // So ignore status messages.
                const statusMsg = msg as KernelMessage.IStatusMsg;
                this.handleStatusMessage(statusMsg, clearState);
            } else if (jupyterLab.KernelMessage.isStreamMsg(msg)) {
                traceInfoIf(
                    !!process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT,
                    'KernelMessage = StreamMessage',
                    `Stream '${msg.content.name}`,
                    msg.content.text
                );
                await this.handleStreamMessage(msg as KernelMessage.IStreamMsg, clearState);
            } else if (jupyterLab.KernelMessage.isDisplayDataMsg(msg)) {
                traceInfoIf(!!process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT, 'KernelMessage = DisplayMessage');
                await this.handleDisplayData(msg as KernelMessage.IDisplayDataMsg, clearState);
            } else if (jupyterLab.KernelMessage.isUpdateDisplayDataMsg(msg)) {
                traceInfoIf(!!process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT, 'KernelMessage = UpdateDisplayMessage');
                await this.handleUpdateDisplayDataMessage(msg);
            } else if (jupyterLab.KernelMessage.isClearOutputMsg(msg)) {
                traceInfoIf(!!process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT, 'KernelMessage = CleanOutput');
                await this.handleClearOutput(msg as KernelMessage.IClearOutputMsg, clearState);
            } else if (jupyterLab.KernelMessage.isErrorMsg(msg)) {
                traceInfoIf(!!process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT, 'KernelMessage = ErrorMessage');
                await this.handleError(msg as KernelMessage.IErrorMsg, clearState);
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
            if ('execution_count' in msg.content && typeof msg.content.execution_count === 'number' && this.task) {
                traceInfoIf(!!process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT, `Exec Count = ${msg.content.execution_count}`);
                this.task.executionOrder = msg.content.execution_count;
            }
        } catch (err) {
            traceError(`Cell (index = ${this.cell.index}) execution completed with errors (2).`, err);
            // If not a restart error, then tell the subscriber
            await this.completedWithErrors(err).then(noop, noop);
        }
    }

    private async addToCellData(
        output: nbformat.IExecuteResult | nbformat.IDisplayData | nbformat.IStream | nbformat.IError,
        clearState: RefBool
    ) {
        const converted = cellOutputToVSCCellOutput(output);

        await chainWithPendingUpdates(this.cell.notebook, async () => {
            if (this.cell.document.isClosed) {
                return;
            }
            traceCellMessage(this.cell, 'Update output');
            // Clear if necessary
            if (clearState.value) {
                await this.task?.clearOutput();
                clearState.update(false);
            }

            // Append to the data (we would push here but VS code requires a recreation of the array)
            // Possible execution of cell has completed (the task would have been disposed).
            // This message could have come from a background thread.
            // In such circumstances, create a temporary task & use that to update the output (only cell execution tasks can update cell output).
            const task = this.task || this.createTemporaryTask();
            const promise = task?.appendOutput([converted]);
            this.endTemporaryTask();
            // await on the promise at the end, we want to minimize UI flickers.
            // The way we update output of other cells is to use an existing task or a temporary task.
            // When using temporary tasks, we end up updating the UI with no execution order and spinning icons.
            // Doing this causes UI updates, removing the awaits will enure there's no time for ui updates.
            if (promise) {
                await promise;
            }
        });
    }

    private handleInputRequest(session: IJupyterSession, msg: KernelMessage.IStdinMessage) {
        // Ask the user for input
        if (msg.content && 'prompt' in msg.content) {
            const hasPassword = msg.content.password !== null && (msg.content.password as boolean);
            void this.applicationService
                .showInputBox({
                    prompt: msg.content.prompt ? msg.content.prompt.toString() : '',
                    ignoreFocusOut: true,
                    password: hasPassword
                })
                .then((v) => {
                    session.sendInputReply(v || '');
                });
        }
    }

    // See this for docs on the messages:
    // https://jupyter-client.readthedocs.io/en/latest/messaging.html#messaging-in-jupyter
    private async handleExecuteResult(msg: KernelMessage.IExecuteResultMsg, clearState: RefBool) {
        await this.addToCellData(
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

    private async handleExecuteReply(msg: KernelMessage.IExecuteReplyMsg, clearState: RefBool) {
        const reply = msg.content as KernelMessage.IExecuteReply;
        if (reply.payload) {
            await Promise.all(
                reply.payload.map(async (payload) => {
                    if (
                        payload.source &&
                        payload.source === 'set_next_input' &&
                        'text' in payload &&
                        'replace' in payload
                    ) {
                        await this.handleSetNextInput((payload as unknown) as ISetNextInputPayload);
                    }
                    if (payload.data && payload.data.hasOwnProperty('text/plain')) {
                        await this.addToCellData(
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
                })
            );
        }
    }

    // Handle our set_next_input message, which can either replace or insert a new cell with text
    private async handleSetNextInput(payload: ISetNextInputPayload) {
        if (payload.replace) {
            // Replace the contents of the current cell with text
            return updateCellCode(this.cell, payload.text);
        } else {
            // Add a new cell after the current with text
            return addNewCellAfter(this.cell, payload.text);
        }
    }

    private async handleExecuteInput(msg: KernelMessage.IExecuteInputMsg, _clearState: RefBool) {
        if (msg.content.execution_count && this.task) {
            this.task.executionOrder = msg.content.execution_count;
        }
    }

    private handleStatusMessage(msg: KernelMessage.IStatusMsg, _clearState: RefBool) {
        traceCellMessage(this.cell, `Kernel switching to ${msg.content.execution_state}`);
    }
    private async handleStreamMessage(msg: KernelMessage.IStreamMsg, clearState: RefBool) {
        // eslint-disable-next-line complexity
        await chainWithPendingUpdates(this.cell.notebook, async () => {
            traceCellMessage(this.cell, 'Update streamed output');
            let exitingCellOutputs = this.cell.outputs;
            // Possible execution of cell has completed (the task would have been disposed).
            // This message could have come from a background thread.
            // In such circumstances, create a temporary task & use that to update the output (only cell execution tasks can update cell output).
            const task = this.task || this.createTemporaryTask();

            // Clear output if waiting for a clear
            const clearOutput = clearState.value;
            if (clearOutput) {
                exitingCellOutputs = [];
                await task?.clearOutput();
                clearState.update(false);
            }
            let promise: Thenable<void> | undefined;
            // Ensure we append to previous output, only if the streams as the same &
            // If the last output is the desired stream type.
            const lastOutput =
                exitingCellOutputs.length > 0 ? exitingCellOutputs[exitingCellOutputs.length - 1] : undefined;
            const existingOutputToAppendTo =
                lastOutput && isStreamOutput(lastOutput, msg.content.name) ? lastOutput : undefined;
            if (existingOutputToAppendTo) {
                // Get the jupyter output from the vs code output (so we can concatenate the text ourselves).
                const outputs = existingOutputToAppendTo ? [translateCellDisplayOutput(existingOutputToAppendTo)] : [];
                let existingOutputText: string = outputs.length
                    ? concatMultilineString((outputs[0] as nbformat.IStream).text)
                    : '';
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
                const output = cellOutputToVSCCellOutput({
                    output_type: 'stream',
                    name: msg.content.name,
                    text: formatStreamText(concatMultilineString(`${existingOutputText}${newContent}`))
                });
                promise = task?.replaceOutputItems(output.outputs, existingOutputToAppendTo.id);
            } else if (clearOutput) {
                // Replace the current outputs with a single new output.
                const output = cellOutputToVSCCellOutput({
                    output_type: 'stream',
                    name: msg.content.name,
                    text: formatStreamText(concatMultilineString(msg.content.text))
                });
                promise = task?.replaceOutput([output]);
            } else {
                // Create a new output
                const output = cellOutputToVSCCellOutput({
                    output_type: 'stream',
                    name: msg.content.name,
                    text: formatStreamText(concatMultilineString(msg.content.text))
                });
                promise = task?.appendOutput([output]);
            }

            this.endTemporaryTask();
            // await on the promise at the end, we want to minimize UI flickers.
            // The way we update output of other cells is to use an existing task or a temporary task.
            // When using temporary tasks, we end up updating the UI with no execution order and spinning icons.
            // Doing this causes UI updates, removing the awaits will enure there's no time for ui updates.
            // I.e. create cell task, perform update, and end cell task (no awaits in between).
            if (promise) {
                await promise;
            }
        });
    }

    private async handleDisplayData(msg: KernelMessage.IDisplayDataMsg, clearState: RefBool) {
        const output: nbformat.IDisplayData = {
            output_type: 'display_data',
            data: handleTensorBoardDisplayDataOutput(msg.content.data),
            metadata: msg.content.metadata,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            transient: msg.content.transient as any // NOSONAR
        };
        await this.addToCellData(output, clearState);
    }

    private async handleClearOutput(msg: KernelMessage.IClearOutputMsg, clearState: RefBool) {
        // If the message says wait, add every message type to our clear state. This will
        // make us wait for this type of output before we clear it.
        if (msg && msg.content.wait) {
            clearState.update(true);
        } else {
            // Possible execution of cell has completed (the task would have been disposed).
            // This message could have come from a background thread.
            // In such circumstances, create a temporary task & use that to update the output (only cell execution tasks can update cell output).

            // Clear all outputs and start over again.
            const task = this.task || this.createTemporaryTask();
            await task?.clearOutput();
            this.endTemporaryTask();
        }
    }

    private async handleError(msg: KernelMessage.IErrorMsg, clearState: RefBool) {
        const output: nbformat.IError = {
            output_type: 'error',
            ename: msg.content.ename,
            evalue: msg.content.evalue,
            traceback: msg.content.traceback
        };
        await this.addToCellData(output, clearState);
    }

    @swallowExceptions()
    private async handleReply(clearState: RefBool, msg: KernelMessage.IShellControlMessage) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services');

        if (jupyterLab.KernelMessage.isExecuteReplyMsg(msg)) {
            await this.handleExecuteReply(msg, clearState);

            // Set execution count, all messages should have it
            if ('execution_count' in msg.content && typeof msg.content.execution_count === 'number' && this.task) {
                this.task.executionOrder = msg.content.execution_count;
            }
        }
    }
    /**
     * Execution of Cell B could result in updates to output in Cell A.
     */
    private async handleUpdateDisplayDataMessage(msg: KernelMessage.IUpdateDisplayDataMsg): Promise<void> {
        const document = this.cell.notebook;
        // Find any cells that have this same display_id
        for (const cell of document.cells) {
            if (cell.kind !== NotebookCellKind.Code) {
                continue;
            }

            // Find the cell output that needs ot be updated.
            const outputToBeUpdated = cell.outputs.find((cellOutput) => {
                const output = translateCellDisplayOutput(cellOutput);
                if (
                    (output.output_type === 'display_data' || output.output_type === 'execute_result') &&
                    output.transient &&
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (output.transient as any).display_id === msg.content.transient.display_id
                ) {
                    return true;
                } else {
                    return false;
                }
            });
            if (outputToBeUpdated) {
                const output = translateCellDisplayOutput(outputToBeUpdated);
                const newOutput = cellOutputToVSCCellOutput({
                    ...output,
                    data: msg.content.data,
                    metadata: msg.content.metadata
                });
                // If there was no output and still no output, then nothing to do.
                if (outputToBeUpdated.outputs.length === 0 && newOutput.outputs.length === 0) {
                    return;
                }
                // Compare outputs (at the end of the day everything is serializable).
                // Hence this is a safe comparison.
                if (cell.outputs.length === newOutput.outputs.length && fastDeepEqual(cell.outputs, newOutput)) {
                    return;
                }
                // Possible execution of cell has completed (the task would have been disposed).
                // This message could have come from a background thread.
                // In such circumstances, create a temporary task & use that to update the output (only cell execution tasks can update cell output).
                const task = this.task || this.createTemporaryTask();
                const promise = task?.replaceOutputItems(newOutput.outputs, outputToBeUpdated.id);
                this.endTemporaryTask();
                // await on the promise at the end, we want to minimize UI flickers.
                // The way we update output of other cells is to use an existing task or a temporary task.
                // When using temporary tasks, we end up updating the UI with no execution order and spinning icons.
                // Doing this causes UI updates, removing the awaits will enure there's no time for ui updates.
                // I.e. create cell task, perform update, and end cell task (no awaits in between).
                if (promise) {
                    await promise;
                }
            }
        }
    }
}
