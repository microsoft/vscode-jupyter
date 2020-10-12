// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { nbformat } from '@jupyterlab/coreutils';
import type { KernelMessage } from '@jupyterlab/services/lib/kernel/messages';
import { CancellationToken, CellOutputKind, NotebookCell, NotebookCellRunState } from 'vscode';
import type { CellDisplayOutput, NotebookEditor as VSCNotebookEditor } from '../../../../../types/vscode-proposed';
import { concatMultilineString, formatStreamText } from '../../../../datascience-ui/common';
import { IApplicationShell, IVSCodeNotebook } from '../../../common/application/types';
import { traceInfo, traceWarning } from '../../../common/logger';
import { RefBool } from '../../../common/refBool';
import { IDisposable } from '../../../common/types';
import { createDeferred } from '../../../common/utils/async';
import { swallowExceptions } from '../../../common/utils/decorators';
import { noop } from '../../../common/utils/misc';
import { StopWatch } from '../../../common/utils/stopWatch';
import { sendTelemetryEvent } from '../../../telemetry';
import { Telemetry } from '../../constants';
import {
    handleUpdateDisplayDataMessage,
    updateCellExecutionCount,
    updateCellWithErrorStatus
} from '../../notebook/helpers/executionHelpers';
import {
    cellOutputToVSCCellOutput,
    clearCellForExecution,
    getCellStatusMessageBasedOnFirstCellErrorOutput,
    updateCellExecutionTimes
} from '../../notebook/helpers/helpers';
import { MultiCancellationTokenSource } from '../../notebook/helpers/multiCancellationToken';
import { NotebookEditor } from '../../notebook/notebookEditor';
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

export class CellExecutionFactory {
    constructor(
        private readonly errorHandler: IDataScienceErrorHandler,
        private readonly editorProvider: INotebookEditorProvider,
        private readonly appShell: IApplicationShell,
        private readonly vscNotebook: IVSCodeNotebook
    ) {}

    public create(cell: NotebookCell, isPythonKernelConnection: boolean) {
        // tslint:disable-next-line: no-use-before-declare
        return CellExecution.fromCell(
            this.vscNotebook.notebookEditors.find((e) => e.document === cell.notebook)!,
            cell,
            this.errorHandler,
            this.editorProvider,
            this.appShell,
            isPythonKernelConnection
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
    private readonly initPromise: Promise<void>;
    private disposables: IDisposable[] = [];
    private cancelHandled = false;

    private ioPubChain = Promise.resolve();

    private constructor(
        public readonly editor: VSCNotebookEditor,
        public readonly cell: NotebookCell,
        private readonly errorHandler: IDataScienceErrorHandler,
        private readonly editorProvider: INotebookEditorProvider,
        private readonly applicationService: IApplicationShell,
        private readonly isPythonKernelConnection: boolean
    ) {
        this.oldCellRunState = cell.metadata.runState;
        this.initPromise = this.enqueue();
    }

    public static fromCell(
        editor: VSCNotebookEditor,
        cell: NotebookCell,
        errorHandler: IDataScienceErrorHandler,
        editorProvider: INotebookEditorProvider,
        appService: IApplicationShell,
        isPythonKernelConnection: boolean
    ) {
        return new CellExecution(editor, cell, errorHandler, editorProvider, appService, isPythonKernelConnection);
    }

    public async start(kernelPromise: Promise<IKernel>, notebook: INotebook) {
        if (!this.canExecuteCell()) {
            return;
        }
        await this.initPromise;
        this.started = true;
        // Ensure we clear the cell state and trigger a change.
        await clearCellForExecution(this.editor, this.cell);
        await this.editor.edit((edit) => {
            edit.replaceCellMetadata(this.cell.index, {
                ...this.cell.metadata,
                runStartTime: new Date().getTime()
            });
        });
        this.stopWatch.reset();
        this.notifyCellExecution();

        // Begin the request that will modify our cell.
        kernelPromise
            .then((kernel) => this.handleKernelRestart(kernel))
            .then(() => this.execute(notebook.session, notebook.getLoggers()))
            .catch((e) => this.completedWithErrors(e))
            .finally(() => this.dispose())
            .catch(noop);
    }
    /**
     * Cancel execution.
     * If execution has commenced, then interrupt (via cancellation token) else dequeue from execution.
     */
    public async cancel() {
        if (this.cancelHandled || this._completed) {
            return;
        }
        this.cancelHandled = true;
        await this.initPromise;
        // We need to notify cancellation only if execution is in progress,
        // coz if not, we can safely reset the states.
        if (this.started) {
            this.source.cancel();
        }

        if (!this.started) {
            await this.dequeue();
        }
        await this.completedDurToCancellation();
        this.dispose();
    }
    private dispose() {
        this.disposables.forEach((d) => d.dispose());
    }
    private handleKernelRestart(kernel: IKernel) {
        kernel.onRestarted(async () => this.cancel(), this, this.disposables);
    }

    private async completedWithErrors(error: Partial<Error>) {
        this.sendPerceivedCellExecute();
        await this.editor.edit((edit) =>
            edit.replaceCellMetadata(this.cell.index, {
                ...this.cell.metadata,
                lastRunDuration: this.stopWatch.elapsedTime
            })
        );
        await updateCellWithErrorStatus(this.editor, this.cell, error);
        this.errorHandler.handleError((error as unknown) as Error).ignoreErrors();

        this._completed = true;
        this._result.resolve(this.cell.metadata.runState);
    }

    private async completedSuccessfully() {
        this.sendPerceivedCellExecute();
        let statusMessage = '';
        // If we requested a cancellation, then assume it did not even run.
        // If it did, then we'd get an interrupt error in the output.
        let runState = this.token.isCancellationRequested
            ? vscodeNotebookEnums.NotebookCellRunState.Idle
            : vscodeNotebookEnums.NotebookCellRunState.Success;

        await updateCellExecutionTimes(this.editor, this.cell, {
            startTime: this.cell.metadata.runStartTime,
            lastRunDuration: this.stopWatch.elapsedTime
        });

        // If there are any errors in the cell, then change status to error.
        if (this.cell.outputs.some((output) => output.outputKind === vscodeNotebookEnums.CellOutputKind.Error)) {
            runState = vscodeNotebookEnums.NotebookCellRunState.Error;
            statusMessage = getCellStatusMessageBasedOnFirstCellErrorOutput(this.cell.outputs);
        }

        await this.editor.edit((edit) =>
            edit.replaceCellMetadata(this.cell.index, {
                ...this.cell.metadata,
                runState,
                statusMessage
            })
        );

        this._completed = true;
        this._result.resolve(this.cell.metadata.runState);
    }

    private async completedDurToCancellation() {
        await updateCellExecutionTimes(this.editor, this.cell, {
            startTime: this.cell.metadata.runStartTime,
            lastRunDuration: this.stopWatch.elapsedTime
        });

        await this.editor.edit((edit) =>
            edit.replaceCellMetadata(this.cell.index, {
                ...this.cell.metadata,
                runState: vscodeNotebookEnums.NotebookCellRunState.Idle,
                statusMessage: ''
            })
        );

        this._completed = true;
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
     * This cell will no longer be processed for execution (even though it was meant to be).
     * At this point we revert cell state & indicate that it has nto started & it is not busy.
     */
    private async dequeue() {
        const runState =
            this.oldCellRunState === vscodeNotebookEnums.NotebookCellRunState.Running
                ? vscodeNotebookEnums.NotebookCellRunState.Idle
                : this.oldCellRunState;
        await this.editor.edit((edit) =>
            edit.replaceCellMetadata(this.cell.index, {
                ...this.cell.metadata,
                runStartTime: undefined,
                runState
            })
        );
        this._completed = true;
        this._result.resolve(this.cell.metadata.runState);
    }

    /**
     * Place in queue for execution with kernel.
     * (mark it as busy).
     */
    private async enqueue() {
        if (!this.canExecuteCell()) {
            return;
        }
        await this.editor.edit((edit) =>
            edit.replaceCellMetadata(this.cell.index, {
                ...this.cell.metadata,
                runState: vscodeNotebookEnums.NotebookCellRunState.Running
            })
        );
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

        const code = this.cell.document.getText();
        return code.trim().length > 0;
    }

    private async execute(session: IJupyterSession, loggers: INotebookExecutionLogger[]) {
        const code = this.cell.document.getText();
        return this.executeCodeCell(code, session, loggers);
    }

    private async executeCodeCell(code: string, session: IJupyterSession, loggers: INotebookExecutionLogger[]) {
        // Generate metadata from our cell (some kernels expect this.)
        const metadata = {
            ...this.cell.metadata,
            ...{ cellId: this.cell.uri.toString() }
        };

        // Skip if no code to execute
        if (code.trim().length === 0) {
            return this.completedSuccessfully().then(noop, noop);
        }

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

        // Listen to the response messages and update state as we go
        if (!request) {
            return this.completedWithErrors(new Error('Session cannot generate requests')).then(noop, noop);
        }

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
        try {
            await request.done;
            await this.completedSuccessfully();
        } catch (ex) {
            // @jupyterlab/services throws a `Canceled` error when the kernel is interrupted.
            // Such an error must be ignored.
            if (ex && ex instanceof Error && ex.message === 'Canceled') {
                await this.completedSuccessfully();
            } else {
                await this.completedWithErrors(ex);
            }
        } finally {
            cancelDisposable.dispose();
        }
    }
    private handleIOPub(clearState: RefBool, loggers: INotebookExecutionLogger[], msg: KernelMessage.IIOPubMessage) {
        this.ioPubChain = this.ioPubChain.then(() => this.handleIOPubInternal(clearState, loggers, msg).catch(noop));
    }
    @swallowExceptions()
    private async handleIOPubInternal(
        clearState: RefBool,
        loggers: INotebookExecutionLogger[],
        msg: KernelMessage.IIOPubMessage
    ) {
        // Let our loggers get a first crack at the message. They may change it
        loggers.forEach((f) => (msg = f.preHandleIOPub ? f.preHandleIOPub(msg) : msg));

        // tslint:disable-next-line:no-require-imports
        const jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services');

        try {
            if (jupyterLab.KernelMessage.isExecuteResultMsg(msg)) {
                await this.handleExecuteResult(msg as KernelMessage.IExecuteResultMsg, clearState);
            } else if (jupyterLab.KernelMessage.isExecuteInputMsg(msg)) {
                await this.handleExecuteInput(msg as KernelMessage.IExecuteInputMsg, clearState);
            } else if (jupyterLab.KernelMessage.isStatusMsg(msg)) {
                // Status is handled by the result promise. While it is running we are active. Otherwise we're stopped.
                // So ignore status messages.
                const statusMsg = msg as KernelMessage.IStatusMsg;
                this.handleStatusMessage(statusMsg, clearState);
            } else if (jupyterLab.KernelMessage.isStreamMsg(msg)) {
                await this.handleStreamMessage(msg as KernelMessage.IStreamMsg, clearState);
            } else if (jupyterLab.KernelMessage.isDisplayDataMsg(msg)) {
                await this.handleDisplayData(msg as KernelMessage.IDisplayDataMsg, clearState);
            } else if (jupyterLab.KernelMessage.isUpdateDisplayDataMsg(msg)) {
                await handleUpdateDisplayDataMessage(msg, this.editor);
            } else if (jupyterLab.KernelMessage.isClearOutputMsg(msg)) {
                await this.handleClearOutput(msg as KernelMessage.IClearOutputMsg, clearState);
            } else if (jupyterLab.KernelMessage.isErrorMsg(msg)) {
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
                await updateCellExecutionCount(this.editor, this.cell, msg.content.execution_count);
            }
        } catch (err) {
            // If not a restart error, then tell the subscriber
            await this.completedWithErrors(err).then(noop, noop);
        }
    }

    private async addToCellData(
        output: nbformat.IExecuteResult | nbformat.IDisplayData | nbformat.IStream | nbformat.IError,
        clearState: RefBool
    ) {
        const converted = cellOutputToVSCCellOutput(output);

        await this.editor.edit((edit) => {
            let existingOutput = [...this.cell.outputs];

            // Clear if necessary
            if (clearState.value) {
                existingOutput = [];
                clearState.update(false);
            }

            // Append to the data (we would push here but VS code requires a recreation of the array)
            edit.replaceCellOutput(this.cell.index, existingOutput.concat(converted));
        });
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
    private async handleExecuteResult(msg: KernelMessage.IExecuteResultMsg, clearState: RefBool) {
        await this.addToCellData(
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

    private async handleExecuteReply(msg: KernelMessage.IExecuteReplyMsg, clearState: RefBool) {
        const reply = msg.content as KernelMessage.IExecuteReply;
        if (reply.payload) {
            await Promise.all(
                reply.payload.map(async (o) => {
                    if (o.data && o.data.hasOwnProperty('text/plain')) {
                        await this.addToCellData(
                            {
                                // Mark as stream output so the text is formatted because it likely has ansi codes in it.
                                output_type: 'stream',
                                // tslint:disable-next-line: no-any
                                text: (o.data as any)['text/plain'].toString(),
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

    private async handleExecuteInput(msg: KernelMessage.IExecuteInputMsg, _clearState: RefBool) {
        if (msg.content.execution_count) {
            await updateCellExecutionCount(this.editor, this.cell, msg.content.execution_count);
        }
    }

    private handleStatusMessage(msg: KernelMessage.IStatusMsg, _clearState: RefBool) {
        traceInfo(`Kernel switching to ${msg.content.execution_state}`);
    }
    private async handleStreamMessage(msg: KernelMessage.IStreamMsg, clearState: RefBool) {
        await this.editor.edit((edit) => {
            let exitingCellOutput = this.cell.outputs;
            // Clear output if waiting for a clear
            if (clearState.value) {
                exitingCellOutput = [];
                clearState.update(false);
            }

            // Might already have a stream message. If so, just add on to it.
            // We use Rich output for text streams (not CellStreamOutput, known VSC Issues).
            // https://github.com/microsoft/vscode-python/issues/14156
            const lastOutput =
                exitingCellOutput.length > 0 ? exitingCellOutput[exitingCellOutput.length - 1] : undefined;
            const existing: CellDisplayOutput | undefined =
                lastOutput && lastOutput.outputKind === CellOutputKind.Rich ? lastOutput : undefined;
            if (existing && 'text/plain' in existing.data) {
                // tslint:disable-next-line:restrict-plus-operands
                existing.data['text/plain'] = formatStreamText(
                    concatMultilineString(`${existing.data['text/plain']}${msg.content.text}`)
                );
                edit.replaceCellOutput(this.cell.index, [...exitingCellOutput]); // This is necessary to get VS code to update (for now)
            } else {
                const originalText = formatStreamText(concatMultilineString(msg.content.text));
                // Create a new stream entry
                const output: nbformat.IStream = {
                    output_type: 'stream',
                    name: msg.content.name,
                    text: originalText
                };
                edit.replaceCellOutput(this.cell.index, [...exitingCellOutput, cellOutputToVSCCellOutput(output)]);
            }
        });
    }

    private async handleDisplayData(msg: KernelMessage.IDisplayDataMsg, clearState: RefBool) {
        const output: nbformat.IDisplayData = {
            output_type: 'display_data',
            data: msg.content.data,
            metadata: msg.content.metadata,
            // tslint:disable-next-line: no-any
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
            await this.editor.edit((edit) => edit.replaceCellOutput(this.cell.index, []));
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

    private async handleReply(clearState: RefBool, msg: KernelMessage.IShellControlMessage) {
        // tslint:disable-next-line:no-require-imports
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
