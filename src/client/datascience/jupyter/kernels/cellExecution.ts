// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { nbformat } from '@jupyterlab/coreutils';
import type { KernelMessage } from '@jupyterlab/services/lib/kernel/messages';
import { ExtensionMode } from 'vscode';
import {
    NotebookCell,
    NotebookCellOutput,
    NotebookCellOutputItem,
    NotebookCellRunState,
    NotebookEditor as VSCNotebookEditor
} from '../../../../../types/vscode-proposed';
import { concatMultilineString, formatStreamText } from '../../../../datascience-ui/common';
import { IApplicationShell, IVSCodeNotebook } from '../../../common/application/types';
import { traceError, traceErrorIf, traceInfoIf, traceWarning } from '../../../common/logger';
import { RefBool } from '../../../common/refBool';
import { IDisposable, IExtensionContext } from '../../../common/types';
import { createDeferred, Deferred } from '../../../common/utils/async';
import { swallowExceptions } from '../../../common/utils/decorators';
import { noop } from '../../../common/utils/misc';
import { StopWatch } from '../../../common/utils/stopWatch';
import { sendTelemetryEvent } from '../../../telemetry';
import { Telemetry } from '../../constants';
import {
    addNewCellAfter,
    handleTensorBoardDisplayDataOutput,
    handleUpdateDisplayDataMessage,
    updateCellCode,
    updateCellExecutionCount,
    updateCellWithErrorStatus
} from '../../notebook/helpers/executionHelpers';
import {
    cellOutputToVSCCellOutput,
    clearCellForExecution,
    getCellStatusMessageBasedOnFirstCellErrorOutput,
    hasErrorOutputs,
    isStreamOutput,
    traceCellMessage,
    updateCellExecutionTimes
} from '../../notebook/helpers/helpers';
import { chainWithPendingUpdates } from '../../notebook/helpers/notebookUpdater';
import { NotebookEditor } from '../../notebook/notebookEditor';
import {
    IDataScienceErrorHandler,
    IJupyterSession,
    INotebook,
    INotebookEditorProvider,
    INotebookExecutionLogger
} from '../../types';
import { translateCellFromNative } from '../../utils';
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const vscodeNotebookEnums = require('vscode') as typeof import('vscode-proposed');

// Helper interface for the set_next_input execute reply payload
interface ISetNextInputPayload {
    replace: boolean;
    source: 'set_next_input';
    text: string;
}

export class CellExecutionFactory {
    constructor(
        private readonly errorHandler: IDataScienceErrorHandler,
        private readonly editorProvider: INotebookEditorProvider,
        private readonly appShell: IApplicationShell,
        private readonly vscNotebook: IVSCodeNotebook,
        private readonly context: IExtensionContext
    ) { }

    public create(cell: NotebookCell, isPythonKernelConnection: boolean) {
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        return CellExecution.fromCell(
            this.vscNotebook.notebookEditors.find((e) => e.document === cell.notebook)!,
            cell,
            this.errorHandler,
            this.editorProvider,
            this.appShell,
            isPythonKernelConnection,
            this.context
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
export class CellExecution {
    public get result(): Promise<NotebookCellRunState | undefined> {
        return this._result.promise;
    }
    /**
     * To be used only in tests.
     */
    public static cellsCompletedForTesting = new WeakMap<NotebookCell, Deferred<void>>();

    private static sentExecuteCellTelemetry?: boolean;

    private stopWatch = new StopWatch();

    private readonly _result = createDeferred<NotebookCellRunState | undefined>();

    private started?: boolean;

    private _completed?: boolean;
    private readonly initPromise: Promise<void>;
    private disposables: IDisposable[] = [];
    private cancelHandled = false;
    private requestHandlerChain = Promise.resolve();
    private constructor(
        public readonly editor: VSCNotebookEditor,
        public readonly cell: NotebookCell,
        private readonly errorHandler: IDataScienceErrorHandler,
        private readonly editorProvider: INotebookEditorProvider,
        private readonly applicationService: IApplicationShell,
        private readonly isPythonKernelConnection: boolean,
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

        this.initPromise = this.enqueue();
    }

    public static fromCell(
        editor: VSCNotebookEditor,
        cell: NotebookCell,
        errorHandler: IDataScienceErrorHandler,
        editorProvider: INotebookEditorProvider,
        appService: IApplicationShell,
        isPythonKernelConnection: boolean,
        context: IExtensionContext
    ) {
        return new CellExecution(
            editor,
            cell,
            errorHandler,
            editorProvider,
            appService,
            isPythonKernelConnection,
            context
        );
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
            return;
        }
        if (this.started) {
            traceCellMessage(this.cell, 'Cell has already been started yet CellExecution.Start invoked again');
            traceError(`Cell has already been started yet CellExecution.Start invoked again ${this.cell.index}`);
            // TODO: Send telemetry this should never happen, if it does we have problems.
            return this.result;
        }
        this.started = true;

        await this.initPromise;
        // Ensure we clear the cell state and trigger a change.
        await clearCellForExecution(this.editor, this.cell);
        if (!this.isEmptyCodeCell) {
            await chainWithPendingUpdates(this.editor.document, (edit) => {
                edit.replaceNotebookCellMetadata(this.cell.notebook.uri, this.cell.index, {
                    ...this.cell.metadata,
                    runStartTime: new Date().getTime()
                });
            });
        }
        this.stopWatch.reset();
        this.notifyCellExecution();

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
        this.disposables.forEach((d) => d.dispose());
        const deferred = CellExecution.cellsCompletedForTesting.get(this.cell);
        if (deferred) {
            deferred.resolve();
        }
    }

    private async completedWithErrors(error: Partial<Error>) {
        traceCellMessage(this.cell, 'Completed with errors');
        this.sendPerceivedCellExecute();
        if (!this.isEmptyCodeCell) {
            await chainWithPendingUpdates(this.editor.document, (edit) => {
                traceCellMessage(this.cell, 'Update run run duration');
                edit.replaceNotebookCellMetadata(this.editor.document.uri, this.cell.index, {
                    ...this.cell.metadata,
                    lastRunDuration: this.stopWatch.elapsedTime
                });
            });
        }
        await updateCellWithErrorStatus(this.editor, this.cell, error);
        this.errorHandler.handleError((error as unknown) as Error).ignoreErrors();

        this._completed = true;
        traceCellMessage(this.cell, 'Completed with errors, & resolving');
        this._result.resolve(this.cell.metadata.runState);
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
        let runState = this.isEmptyCodeCell
            ? vscodeNotebookEnums.NotebookCellRunState.Idle
            : vscodeNotebookEnums.NotebookCellRunState.Success;

        if (!this.isEmptyCodeCell) {
            await updateCellExecutionTimes(this.editor, this.cell, {
                startTime: this.cell.metadata.runStartTime,
                lastRunDuration: this.stopWatch.elapsedTime
            });
        }

        // If there are any errors in the cell, then change status to error.
        if (hasErrorOutputs(this.cell.outputs)) {
            runState = vscodeNotebookEnums.NotebookCellRunState.Error;
            statusMessage = getCellStatusMessageBasedOnFirstCellErrorOutput(this.cell.outputs);
        }

        await chainWithPendingUpdates(this.editor.document, (edit) => {
            traceCellMessage(this.cell, `Update cell state ${runState} and message '${statusMessage}'`);
            edit.replaceNotebookCellMetadata(this.editor.document.uri, this.cell.index, {
                ...this.cell.metadata,
                runState,
                statusMessage
            });
        });

        this._completed = true;
        traceCellMessage(this.cell, 'Completed successfully & resolving');
        this._result.resolve(this.cell.metadata.runState);
    }

    private async completedDueToCancellation() {
        traceCellMessage(this.cell, 'Completed due to cancellation');
        await chainWithPendingUpdates(this.editor.document, (edit) => {
            traceCellMessage(this.cell, 'Update cell statue as idle and message as empty');
            edit.replaceNotebookCellMetadata(this.editor.document.uri, this.cell.index, {
                ...this.cell.metadata,
                runStartTime: undefined,
                lastRunDuration: undefined,
                runState: vscodeNotebookEnums.NotebookCellRunState.Idle,
                statusMessage: ''
            });
        });

        this._completed = true;
        traceCellMessage(this.cell, 'Cell cancelled & resolving');
        this._result.resolve(this.cell.metadata.runState);
    }

    /**
     * Notify other parts of extension about the cell execution.
     */
    private notifyCellExecution() {
        const editor = this.editorProvider.editors.find((e) => e.file.toString() === this.cell.notebook.uri.toString());
        if (!editor) {
            throw new Error('No editor for Model');
        }
        if (editor && !(editor instanceof NotebookEditor)) {
            throw new Error('Executing Notebook with another Editor');
        }
        editor.notifyExecution(this.cell);
    }

    /**
     * Place in queue for execution with kernel.
     * (mark it as busy).
     */
    private async enqueue() {
        if (!this.canExecuteCell()) {
            return;
        }
        await chainWithPendingUpdates(this.editor.document, (edit) => {
            traceCellMessage(this.cell, 'Update cell state as it was enqueued');
            edit.replaceNotebookCellMetadata(this.editor.document.uri, this.cell.index, {
                ...this.cell.metadata,
                statusMessage: '', // We don't want any previous status anymore.
                runStartTime: undefined, // We don't want any previous counters anymore.
                lastRunDuration: undefined,
                runState: vscodeNotebookEnums.NotebookCellRunState.Running
            });
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
        if (this.isPythonKernelConnection && (this.cell.language === 'raw' || this.cell.language === 'plaintext')) {
            return false;
        }

        return true;
    }

    private async execute(session: IJupyterSession, loggers: INotebookExecutionLogger[]) {
        const code = this.cell.document.getText();
        traceCellMessage(this.cell, 'Send code for execution');
        await this.executeCodeCell(code, session, loggers);
    }

    private async executeCodeCell(code: string, session: IJupyterSession, loggers: INotebookExecutionLogger[]) {
        // Skip if no code to execute
        if (code.trim().length === 0) {
            traceCellMessage(this.cell, 'Empty cell execution');
            return this.completedSuccessfully();
        }

        // Generate metadata from our cell (some kernels expect this.)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const metadata: any = {
            ...(this.cell.metadata?.custom?.metadata || {}), // Send the Cell Metadata
            ...{ cellId: this.cell.uri.toString() }
        };

        // For Jupyter requests, silent === don't output, while store_history === don't update execution count
        // https://jupyter-client.readthedocs.io/en/stable/api/client.html#jupyter_client.KernelClient.execute
        const request = session.requestExecute(
            {
                code,
                silent: false,
                stop_on_error: false,
                allow_stdin: true,
                store_history: true
            },
            false,
            metadata
        );

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
        (this.requestHandlerChain = this.requestHandlerChain.then(() =>
            this.handleIOPub(clearState, loggers, msg).catch(noop)
        ));
        request.onReply = (msg) =>
        (this.requestHandlerChain = this.requestHandlerChain.then(() =>
            this.handleReply(clearState, msg).catch(noop)
        ));
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
        } finally {
            // After execution log our post execute, regardless of success or failure

            // For our post execution logging we consider silent either silent execution or
            // non-silent execution with store_history set to false
            // Explicit false check as undefined store_history defaults to true if silent is false
            const wasSilent = request.msg.content.silent || request.msg.content.store_history === false;
            loggers.forEach((l) =>
                l.postExecute(translateCellFromNative(this.cell), wasSilent, this.cell.language, this.cell.notebook.uri)
            );
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
                await handleUpdateDisplayDataMessage(msg, this.editor);
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
            if ('execution_count' in msg.content && typeof msg.content.execution_count === 'number') {
                traceInfoIf(!!process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT, `Exec Count = ${msg.content.execution_count}`);
                await updateCellExecutionCount(this.editor, this.cell, msg.content.execution_count);
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

        await chainWithPendingUpdates(this.editor.document, (edit) => {
            traceCellMessage(this.cell, 'Update output');
            let existingOutput = [...this.cell.outputs];

            // Clear if necessary
            if (clearState.value) {
                existingOutput = [];
                clearState.update(false);
            }

            // Append to the data (we would push here but VS code requires a recreation of the array)
            edit.replaceNotebookCellOutput(this.editor.document.uri, this.cell.index, existingOutput.concat(converted as NotebookCellOutput));
            return edit;
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
            return addNewCellAfter(this.editor, this.cell, payload.text);
        }
    }

    private async handleExecuteInput(msg: KernelMessage.IExecuteInputMsg, _clearState: RefBool) {
        if (msg.content.execution_count) {
            await updateCellExecutionCount(this.editor, this.cell, msg.content.execution_count);
        }
    }

    private handleStatusMessage(msg: KernelMessage.IStatusMsg, _clearState: RefBool) {
        traceCellMessage(this.cell, `Kernel switching to ${msg.content.execution_state}`);
    }
    private async handleStreamMessage(msg: KernelMessage.IStreamMsg, clearState: RefBool) {
        // eslint-disable-next-line complexity
        await chainWithPendingUpdates(this.editor.document, (edit) => {
            traceCellMessage(this.cell, 'Update streamed output');
            let exitingCellOutput = this.cell.outputs;
            // Clear output if waiting for a clear
            if (clearState.value) {
                exitingCellOutput = [];
                clearState.update(false);
            }

            // Might already have a stream message. If so, just add on to it.
            // We use Rich output for text streams (not CellStreamOutput, known VSC Issues).
            // https://github.com/microsoft/vscode-python/issues/14156
            const existing = exitingCellOutput.find((item) => item && isStreamOutput(item, msg.content.name));

            // Ensure we append to previous output, only if the streams as the same.
            // Possible we have stderr first, then later we get output from stdout.
            // Basically have one output for stderr & a seprate output for stdout.
            // If we output stderr first, then stdout & then stderr, we should append the new stderr to the previous stderr output.
            if (existing) {
                let existingOutput: string = concatMultilineString(existing.outputs.filter(opit => opit.mime === 'text/plain' || opit.mime === 'application/x.notebook.stream')
                    .map(opit => opit.value as string | string[])
                    .reduceRight((prev, curr) => { return [...prev, ...curr]; }, []));
                let newContent = msg.content.text;
                // Look for the ansi code `<char27>[A`. (this means move up)
                // Not going to support `[2A` (not for now).
                const moveUpCode = `${String.fromCharCode(27)}[A`;
                if (msg.content.text.startsWith(moveUpCode)) {
                    // Split message by lines & strip out the last n lines (where n = number of lines to move cursor up).
                    const existingOutputLines = existingOutput.splitLines({ trim: false, removeEmptyEntries: false });
                    if (existingOutputLines.length) {
                        existingOutputLines.pop();
                    }
                    existingOutput = existingOutputLines.join('\n');
                    newContent = newContent.substring(moveUpCode.length);
                }
                // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
                edit.replaceNotebookCellOutputItems(this.editor.document.uri, this.cell.index, existing.id, [new NotebookCellOutputItem('text/plain', formatStreamText(concatMultilineString(`${existingOutput}${newContent}`)))]);
                // TODO@DonJayamanne, with above API, we can update content of a cell output
                // edit.replaceNotebookCellOutput(this.editor.document.uri, this.cell.index, [...exitingCellOutput]); // This is necessary to get VS code to update (for now)
            } else {
                const originalText = formatStreamText(concatMultilineString(msg.content.text));
                // Create a new stream entry
                const output: nbformat.IStream = {
                    output_type: 'stream',
                    name: msg.content.name,
                    text: originalText
                };
                edit.replaceNotebookCellOutput(this.editor.document.uri, this.cell.index, [
                    ...exitingCellOutput,
                    cellOutputToVSCCellOutput(output)
                ]);
            }
            return edit;
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
            // Clear all outputs and start over again.
            await chainWithPendingUpdates(this.editor.document, (edit) => {
                traceCellMessage(this.cell, 'Handle clear output message & clear output');
                edit.replaceNotebookCellOutput(this.editor.document.uri, this.cell.index, []);
                return edit;
            });
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
            if ('execution_count' in msg.content && typeof msg.content.execution_count === 'number') {
                await updateCellExecutionCount(this.editor, this.cell, msg.content.execution_count);
            }
        }
    }
}
