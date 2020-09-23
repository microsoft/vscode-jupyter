// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { nbformat } from '@jupyterlab/coreutils';
import type { KernelMessage } from '@jupyterlab/services/lib/kernel/messages';
import { CancellationToken, CellOutputKind, CellStreamOutput, NotebookCell, NotebookCellRunState } from 'vscode';
import { concatMultilineString, formatStreamText } from '../../../../datascience-ui/common';
import { IApplicationShell } from '../../../common/application/types';
import { traceInfo, traceWarning } from '../../../common/logger';
import { RefBool } from '../../../common/refBool';
import { createDeferred } from '../../../common/utils/async';
import { noop } from '../../../common/utils/misc';
import { StopWatch } from '../../../common/utils/stopWatch';
import { sendTelemetryEvent } from '../../../telemetry';
import { Telemetry } from '../../constants';
import { updateCellExecutionCount, updateCellWithErrorStatus } from '../../notebook/helpers/executionHelpers';
import {
    cellOutputToVSCCellOutput,
    clearCellForExecution,
    getCellStatusMessageBasedOnFirstCellErrorOutput,
    updateCellExecutionTimes
} from '../../notebook/helpers/helpers';
import { MultiCancellationTokenSource } from '../../notebook/helpers/multiCancellationToken';
import { NotebookEditor } from '../../notebook/notebookEditor';
import { INotebookContentProvider } from '../../notebook/types';
import {
    IDataScienceErrorHandler,
    IJupyterSession,
    INotebook,
    INotebookEditorProvider,
    INotebookExecutionLogger
} from '../../types';
import { IKernel } from './types';
// tslint:disable-next-line: no-var-requires no-require-imports
const vscodeNotebookEnums = require('vscode') as typeof import('vscode-proposed');
// tslint:disable-next-line: no-require-imports
import escape = require('lodash/escape');

export class CellExecutionFactory {
    constructor(
        private readonly contentProvider: INotebookContentProvider,
        private readonly errorHandler: IDataScienceErrorHandler,
        private readonly editorProvider: INotebookEditorProvider,
        private readonly appShell: IApplicationShell
    ) {}

    public create(cell: NotebookCell) {
        // tslint:disable-next-line: no-use-before-declare
        return CellExecution.fromCell(
            cell,
            this.contentProvider,
            this.errorHandler,
            this.editorProvider,
            this.appShell
        );
    }
}
/**
 * Responsible for execution of an individual cell and manages the state of the cell as it progresses through the execution phases.
 * Execution phases include - enqueue for execution (done in ctor), start execution, completed execution with/without errors, cancel execution or dequeue.
 */
export class CellExecution {
    public get result(): Promise<NotebookCellRunState | undefined> {
        return this._result.promise;
    }

    public get token(): CancellationToken {
        return this.source.token;
    }

    public get completed() {
        return this._completed;
    }

    private static sentExecuteCellTelemetry?: boolean;

    private readonly oldCellRunState?: NotebookCellRunState;

    private stopWatch = new StopWatch();

    private readonly source = new MultiCancellationTokenSource();

    private readonly _result = createDeferred<NotebookCellRunState | undefined>();

    private started?: boolean;

    private _completed?: boolean;

    private constructor(
        public readonly cell: NotebookCell,
        private readonly contentProvider: INotebookContentProvider,
        private readonly errorHandler: IDataScienceErrorHandler,
        private readonly editorProvider: INotebookEditorProvider,
        private readonly applicationService: IApplicationShell
    ) {
        this.oldCellRunState = cell.metadata.runState;
        this.enqueue();
    }

    public static fromCell(
        cell: NotebookCell,
        contentProvider: INotebookContentProvider,
        errorHandler: IDataScienceErrorHandler,
        editorProvider: INotebookEditorProvider,
        appService: IApplicationShell
    ) {
        return new CellExecution(cell, contentProvider, errorHandler, editorProvider, appService);
    }

    public start(kernelPromise: Promise<IKernel>, notebook: INotebook) {
        this.started = true;
        // Ensure we clear the cell state and trigger a change.
        clearCellForExecution(this.cell);
        this.cell.metadata.runStartTime = new Date().getTime();
        this.stopWatch.reset();
        // Changes to metadata must be saved in ipynb, hence mark doc has dirty.
        this.contentProvider.notifyChangesToDocument(this.cell.notebook);
        this.notifyCellExecution();

        // Begin the request that will modify our cell.
        kernelPromise
            .then((_k) => {
                this.execute(notebook.session, notebook.getLoggers());
            })
            .catch((e) => {
                this.completedWithErrors(e);
            });
    }

    /**
     * Cancel execution.
     * If execution has commenced, then interrupt (via cancellation token) else dequeue from execution.
     */
    public cancel() {
        // We need to notify cancellation only if execution is in progress,
        // coz if not, we can safely reset the states.
        if (this.started && !this._completed) {
            this.source.cancel();
        }

        if (!this.started) {
            this.dequeue();
        }
        this._result.resolve(this.cell.metadata.runState);
    }

    private completedWithErrors(error: Partial<Error>) {
        this.sendPerceivedCellExecute();
        this.cell.metadata.lastRunDuration = this.stopWatch.elapsedTime;
        updateCellWithErrorStatus(this.cell, error);
        this.contentProvider.notifyChangesToDocument(this.cell.notebook);
        this.errorHandler.handleError((error as unknown) as Error).ignoreErrors();

        this._completed = true;
        this._result.resolve(this.cell.metadata.runState);
        // Changes to metadata must be saved in ipynb, hence mark doc has dirty.
        this.contentProvider.notifyChangesToDocument(this.cell.notebook);
    }

    private completedSuccessfully() {
        this.sendPerceivedCellExecute();
        // If we requested a cancellation, then assume it did not even run.
        // If it did, then we'd get an interrupt error in the output.
        this.cell.metadata.runState = this.token.isCancellationRequested
            ? vscodeNotebookEnums.NotebookCellRunState.Idle
            : vscodeNotebookEnums.NotebookCellRunState.Success;

        this.cell.metadata.statusMessage = '';
        this.cell.metadata.lastRunDuration = this.stopWatch.elapsedTime;
        updateCellExecutionTimes(this.cell, {
            startTime: this.cell.metadata.runStartTime,
            duration: this.cell.metadata.lastRunDuration
        });
        // If there are any errors in the cell, then change status to error.
        if (this.cell.outputs.some((output) => output.outputKind === vscodeNotebookEnums.CellOutputKind.Error)) {
            this.cell.metadata.runState = vscodeNotebookEnums.NotebookCellRunState.Error;
            this.cell.metadata.statusMessage = getCellStatusMessageBasedOnFirstCellErrorOutput(this.cell.outputs);
        }

        this._completed = true;
        this._result.resolve(this.cell.metadata.runState);
        // Changes to metadata must be saved in ipynb, hence mark doc has dirty.
        this.contentProvider.notifyChangesToDocument(this.cell.notebook);
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
     * This cell will no longer be processed for execution (even though it was meant to be).
     * At this point we revert cell state & indicate that it has nto started & it is not busy.
     */
    private dequeue() {
        if (this.oldCellRunState === vscodeNotebookEnums.NotebookCellRunState.Running) {
            this.cell.metadata.runState = vscodeNotebookEnums.NotebookCellRunState.Idle;
        } else {
            this.cell.metadata.runState = this.oldCellRunState;
        }
        this.cell.metadata.runStartTime = undefined;
        this._completed = true;
        this._result.resolve(this.cell.metadata.runState);
        // Changes to metadata must be saved in ipynb, hence mark doc has dirty.
        this.contentProvider.notifyChangesToDocument(this.cell.notebook);
    }

    /**
     * Place in queue for execution with kernel.
     * (mark it as busy).
     */
    private enqueue() {
        this.cell.metadata.runState = vscodeNotebookEnums.NotebookCellRunState.Running;
        this.contentProvider.notifyChangesToDocument(this.cell.notebook);
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

    private execute(session: IJupyterSession, loggers: INotebookExecutionLogger[]) {
        // Generate metadata from our cell (some kernels expect this.)
        const metadata = {
            ...this.cell.metadata,
            ...{ cellId: this.cell.uri.toString() }
        };

        // Create our initial request
        const code = this.cell.document.getText();

        // Skip if no code to execute
        if (code.trim().length > 0) {
            const request = session.requestExecute(
                {
                    code,
                    silent: false,
                    stop_on_error: false,
                    allow_stdin: true,
                    store_history: true // Silent actually means don't output anything. Store_history is what affects execution_count
                },
                false,
                metadata
            );

            // Listen to messages and update our cell execution state appropriately

            // Keep track of our clear state
            const clearState = new RefBool(false);

            // Listen to the reponse messages and update state as we go
            if (request) {
                // Stop handling the request if the subscriber is canceled.
                const cancelDisposable = this.token.onCancellationRequested(() => {
                    request.onIOPub = noop;
                    request.onStdin = noop;
                    request.onReply = noop;
                });

                // Listen to messages.
                request.onIOPub = this.handleIOPub.bind(this, clearState, loggers);
                request.onStdin = this.handleInputRequest.bind(this, session);
                request.onReply = this.handleReply.bind(this, clearState);

                // When the request finishes we are done
                request.done
                    .then(() => this.completedSuccessfully())
                    .catch((e) => {
                        // @jupyterlab/services throws a `Canceled` error when the kernel is interrupted.
                        // Such an error must be ignored.
                        if (e && e instanceof Error && e.message === 'Canceled') {
                            this.completedSuccessfully();
                        } else {
                            this.completedWithErrors(e);
                        }
                    })
                    .finally(() => {
                        cancelDisposable.dispose();
                    })
                    .ignoreErrors();
            } else {
                this.completedWithErrors(new Error('Session cannot generate requrests'));
            }
        } else {
            this.completedSuccessfully();
        }
    }

    private handleIOPub(
        clearState: RefBool,
        loggers: INotebookExecutionLogger[],
        msg: KernelMessage.IIOPubMessage
        // tslint:disable-next-line: no-any
    ) {
        // Let our loggers get a first crack at the message. They may change it
        loggers.forEach((f) => (msg = f.preHandleIOPub ? f.preHandleIOPub(msg) : msg));

        // tslint:disable-next-line:no-require-imports
        const jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services');

        // Keep track of we need to send an update to VS code or not.
        let shouldUpdate = true;
        try {
            if (jupyterLab.KernelMessage.isExecuteResultMsg(msg)) {
                this.handleExecuteResult(msg as KernelMessage.IExecuteResultMsg, clearState);
            } else if (jupyterLab.KernelMessage.isExecuteInputMsg(msg)) {
                this.handleExecuteInput(msg as KernelMessage.IExecuteInputMsg, clearState);
            } else if (jupyterLab.KernelMessage.isStatusMsg(msg)) {
                // Status is handled by the result promise. While it is running we are active. Otherwise we're stopped.
                // So ignore status messages.
                const statusMsg = msg as KernelMessage.IStatusMsg;
                shouldUpdate = false;
                this.handleStatusMessage(statusMsg, clearState);
            } else if (jupyterLab.KernelMessage.isStreamMsg(msg)) {
                this.handleStreamMesssage(msg as KernelMessage.IStreamMsg, clearState);
            } else if (jupyterLab.KernelMessage.isDisplayDataMsg(msg)) {
                this.handleDisplayData(msg as KernelMessage.IDisplayDataMsg, clearState);
            } else if (jupyterLab.KernelMessage.isUpdateDisplayDataMsg(msg)) {
                // No new data to update UI, hence do not send updates.
                shouldUpdate = false;
            } else if (jupyterLab.KernelMessage.isClearOutputMsg(msg)) {
                this.handleClearOutput(msg as KernelMessage.IClearOutputMsg, clearState);
            } else if (jupyterLab.KernelMessage.isErrorMsg(msg)) {
                this.handleError(msg as KernelMessage.IErrorMsg, clearState);
            } else if (jupyterLab.KernelMessage.isCommOpenMsg(msg)) {
                // No new data to update UI, hence do not send updates.
                shouldUpdate = false;
            } else if (jupyterLab.KernelMessage.isCommMsgMsg(msg)) {
                // No new data to update UI, hence do not send updates.
                shouldUpdate = false;
            } else if (jupyterLab.KernelMessage.isCommCloseMsg(msg)) {
                // No new data to update UI, hence do not send updates.
                shouldUpdate = false;
            } else {
                traceWarning(`Unknown message ${msg.header.msg_type} : hasData=${'data' in msg.content}`);
            }

            // Set execution count, all messages should have it
            if ('execution_count' in msg.content && typeof msg.content.execution_count === 'number') {
                if (updateCellExecutionCount(this.cell, msg.content.execution_count)) {
                    shouldUpdate = true;
                }
            }

            // Show our update if any new output.
            if (shouldUpdate) {
                this.contentProvider.notifyChangesToDocument(this.cell.notebook);
            }
        } catch (err) {
            // If not a restart error, then tell the subscriber
            this.completedWithErrors(err);
        }
    }

    private addToCellData(
        output:
            | nbformat.IUnrecognizedOutput
            | nbformat.IExecuteResult
            | nbformat.IDisplayData
            | nbformat.IStream
            | nbformat.IError,
        clearState: RefBool
    ) {
        const converted = cellOutputToVSCCellOutput(output);

        // Clear if necessary
        if (clearState.value) {
            this.cell.outputs = [];
            clearState.update(false);
        }

        // Append to the data (we would push here but VS code requires a recreation of the array)
        this.cell.outputs = [...this.cell.outputs, converted];
    }

    private handleInputRequest(session: IJupyterSession, msg: KernelMessage.IStdinMessage) {
        // Ask the user for input
        if (msg.content && 'prompt' in msg.content) {
            const hasPassword = msg.content.password !== null && (msg.content.password as boolean);
            this.applicationService
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
    private handleExecuteResult(msg: KernelMessage.IExecuteResultMsg, clearState: RefBool) {
        // Escape text output
        if (msg.content.data && msg.content.data.hasOwnProperty('text/plain')) {
            msg.content.data['text/plain'] = escape(msg.content.data['text/plain'] as string);
        }

        this.addToCellData(
            {
                output_type: 'execute_result',
                data: msg.content.data,
                metadata: msg.content.metadata,
                // tslint:disable-next-line: no-any
                transient: msg.content.transient as any, // NOSONAR
                execution_count: msg.content.execution_count
            },
            clearState
        );
    }

    private handleExecuteReply(msg: KernelMessage.IExecuteReplyMsg, clearState: RefBool) {
        const reply = msg.content as KernelMessage.IExecuteReply;
        if (reply.payload) {
            reply.payload.forEach((o) => {
                if (o.data && o.data.hasOwnProperty('text/plain')) {
                    this.addToCellData(
                        {
                            // Mark as stream output so the text is formatted because it likely has ansi codes in it.
                            output_type: 'stream',
                            // tslint:disable-next-line: no-any
                            text: escape((o.data as any)['text/plain'].toString()),
                            metadata: {},
                            execution_count: reply.execution_count
                        },
                        clearState
                    );
                }
            });
        }
    }

    private handleExecuteInput(msg: KernelMessage.IExecuteInputMsg, _clearState: RefBool) {
        if (msg.content.execution_count) {
            updateCellExecutionCount(this.cell, msg.content.execution_count);
        }
    }

    private handleStatusMessage(msg: KernelMessage.IStatusMsg, _clearState: RefBool) {
        traceInfo(`Kernel switching to ${msg.content.execution_state}`);
    }

    private handleStreamMesssage(msg: KernelMessage.IStreamMsg, clearState: RefBool) {
        // Clear output if waiting for a clear
        if (clearState.value) {
            this.cell.outputs = [];
            clearState.update(false);
        }

        // Might already have a stream message. If so, just add on to it.
        const lastOutput = this.cell.outputs.length > 0 ? this.cell.outputs[this.cell.outputs.length - 1] : undefined;
        const existing: CellStreamOutput | undefined =
            lastOutput && lastOutput.outputKind === CellOutputKind.Text ? lastOutput : undefined;
        if (existing) {
            // tslint:disable-next-line:restrict-plus-operands
            existing.text = formatStreamText(concatMultilineString(existing.text + escape(msg.content.text)));
            this.cell.outputs = [...this.cell.outputs]; // This is necessary to get VS code to update (for now)
        } else {
            const originalText = formatStreamText(concatMultilineString(escape(msg.content.text)));
            // Create a new stream entry
            const output: nbformat.IStream = {
                output_type: 'stream',
                name: msg.content.name,
                text: originalText
            };
            this.cell.outputs = [...this.cell.outputs, cellOutputToVSCCellOutput(output)];
        }
    }

    private handleDisplayData(msg: KernelMessage.IDisplayDataMsg, clearState: RefBool) {
        // Escape text output
        if (msg.content.data && msg.content.data.hasOwnProperty('text/plain')) {
            msg.content.data['text/plain'] = escape(msg.content.data['text/plain'] as string);
        }

        const output: nbformat.IDisplayData = {
            output_type: 'display_data',
            data: msg.content.data,
            metadata: msg.content.metadata,
            // tslint:disable-next-line: no-any
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
            // Clear all outputs and start over again.
            this.cell.outputs = [];
        }
    }

    private handleError(msg: KernelMessage.IErrorMsg, clearState: RefBool) {
        const output: nbformat.IError = {
            output_type: 'error',
            ename: msg.content.ename,
            evalue: msg.content.evalue,
            traceback: msg.content.traceback
        };
        this.addToCellData(output, clearState);
    }

    private handleReply(clearState: RefBool, msg: KernelMessage.IShellControlMessage) {
        // tslint:disable-next-line:no-require-imports
        const jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services');

        if (jupyterLab.KernelMessage.isExecuteReplyMsg(msg)) {
            this.handleExecuteReply(msg, clearState);

            // Set execution count, all messages should have it
            if ('execution_count' in msg.content && typeof msg.content.execution_count === 'number') {
                updateCellExecutionCount(this.cell, msg.content.execution_count);
            }

            // Send this event.
            this.contentProvider.notifyChangesToDocument(this.cell.notebook);
        }
    }
}
