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
    Range,
    NotebookCellOutput,
    CancellationTokenSource,
    EventEmitter,
    ExtensionMode,
    NotebookEdit
} from 'vscode';

import { Kernel } from '@jupyterlab/services';
import { CellOutputDisplayIdTracker } from './cellDisplayIdTracker';
import { CellExecutionCreator } from './cellExecutionCreator';
import { IApplicationShell } from '../../platform/common/application/types';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { traceError, traceWarning } from '../../platform/logging';
import { RefBool } from '../../platform/common/refBool';
import { IDisposable, IExtensionContext } from '../../platform/common/types';
import { traceCellMessage, cellOutputToVSCCellOutput, translateCellDisplayOutput, isJupyterNotebook } from '../helpers';
import { formatStreamText, concatMultilineString } from '../../webviews/webview-side/common';
import { swallowExceptions } from '../../platform/common/utils/decorators';
import { noop } from '../../platform/common/utils/misc';
import { ITracebackFormatter } from '../../kernels/types';
import { handleTensorBoardDisplayDataOutput } from './executionHelpers';
import { WIDGET_MIMETYPE } from '../../kernels/ipywidgets-message-coordination/constants';

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

/**
 * At any given point in time, we can only have one cell actively running.
 * This will keep track of that task.
 */
export const activeNotebookCellExecution = new WeakMap<NotebookDocument, NotebookCellExecution | undefined>();

/**
 * Responsible for execution of an individual cell and manages the state of the cell as it progresses through the execution phases.
 * Execution phases include - enqueue for execution (done in ctor), start execution, completed execution with/without errors, cancel execution or dequeue.
 *
 * WARNING: Do not dispose `request: Kernel.IShellFuture` object.
 * Even after request.done & execute_reply is sent we could have more messages coming from iopub.
 * Further details here https://github.com/microsoft/vscode-jupyter/issues/232 & https://github.com/jupyter/jupyter_client/issues/297
 *
 */
export class CellExecutionMessageHandler implements IDisposable {
    /**
     * Listen to messages and update our cell execution state appropriately
     * Keep track of our clear state
     */
    private readonly clearState = new RefBool(false);

    public execution?: NotebookCellExecution;
    private readonly _onErrorHandlingIOPubMessage = new EventEmitter<{
        error: Error;
        msg: KernelMessage.IIOPubMessage;
    }>();
    public readonly onErrorHandlingIOPubMessage = this._onErrorHandlingIOPubMessage.event;
    private temporaryExecution?: NotebookCellExecution;
    private previousResultsToRestore?: NotebookCellExecutionSummary;
    private cellHasErrorsInOutput?: boolean;

    public get hasErrorOutput() {
        return this.cellHasErrorsInOutput === true;
    }
    /**
     * We keep track of the last output that was used to store stream text.
     * We need this so that we can update it later on (when we get new data for the same stream).
     * If users clear outputs or if we have a new output other than stream, then clear this item.
     * Because if after the stream we have an image, then the stream is not the last output item, hence its cleared.
     */
    private lastUsedStreamOutput?: { stream: 'stdout' | 'stderr'; text: string; output: NotebookCellOutput };
    private readonly disposables: IDisposable[] = [];
    private readonly prompts = new Set<CancellationTokenSource>();
    constructor(
        public readonly cell: NotebookCell,
        private readonly applicationService: IApplicationShell,
        private readonly controller: NotebookController,
        private readonly outputDisplayIdTracker: CellOutputDisplayIdTracker,
        private readonly context: IExtensionContext,
        private readonly formatters: ITracebackFormatter[],
        private readonly kernel: Kernel.IKernelConnection
    ) {
        workspace.onDidChangeNotebookDocument(
            (e) => {
                if (!isJupyterNotebook(e.notebook)) {
                    return;
                }
                const thisCellChange = e.cellChanges.find(({ cell }) => cell === this.cell);
                if (!thisCellChange) {
                    return;
                }
                if (thisCellChange.outputs?.length === 0) {
                    // keep track of the fact that user has cleared the output.
                    this.clearLastUsedStreamOutput();
                }
            },
            this,
            this.disposables
        );
    }
    public startHandlingExecutionMessages(
        request: Kernel.IShellFuture<KernelMessage.IExecuteRequestMsg, KernelMessage.IExecuteReplyMsg>,
        cellExecution: NotebookCellExecution
    ) {
        this.execution = cellExecution;
        request.onIOPub = (msg) => {
            // Cell has been deleted or the like.
            if (this.cell.document.isClosed) {
                request.dispose();
            }
            this.handleIOPub(msg);
        };
        request.onReply = (msg) => {
            // Cell has been deleted or the like.
            if (this.cell.document.isClosed) {
                request.dispose();
            }
            this.handleReply(msg);
        };
        request.onStdin = this.handleInputRequest.bind(this);
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
        const existingTask = activeNotebookCellExecution.get(this.cell.notebook);
        if (existingTask) {
            return existingTask;
        }

        // Create a temporary task.
        this.previousResultsToRestore = { ...(this.cell.executionSummary || {}) };
        this.temporaryExecution = CellExecutionCreator.getOrCreate(this.cell, this.controller);
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
    @swallowExceptions()
    private handleIOPub(msg: KernelMessage.IIOPubMessage) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services');

        try {
            if (jupyterLab.KernelMessage.isExecuteResultMsg(msg)) {
                this.handleExecuteResult(msg as KernelMessage.IExecuteResultMsg);
            } else if (jupyterLab.KernelMessage.isExecuteInputMsg(msg)) {
                this.handleExecuteInput(msg as KernelMessage.IExecuteInputMsg);
            } else if (jupyterLab.KernelMessage.isStatusMsg(msg)) {
                // Status is handled by the result promise. While it is running we are active. Otherwise we're stopped.
                // So ignore status messages.
                const statusMsg = msg as KernelMessage.IStatusMsg;
                this.handleStatusMessage(statusMsg);
            } else if (jupyterLab.KernelMessage.isStreamMsg(msg)) {
                this.handleStreamMessage(msg as KernelMessage.IStreamMsg);
            } else if (jupyterLab.KernelMessage.isDisplayDataMsg(msg)) {
                this.handleDisplayData(msg as KernelMessage.IDisplayDataMsg);
            } else if (jupyterLab.KernelMessage.isUpdateDisplayDataMsg(msg)) {
                this.handleUpdateDisplayDataMessage(msg);
            } else if (jupyterLab.KernelMessage.isClearOutputMsg(msg)) {
                this.handleClearOutput(msg as KernelMessage.IClearOutputMsg);
            } else if (jupyterLab.KernelMessage.isErrorMsg(msg)) {
                this.handleError(msg as KernelMessage.IErrorMsg);
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
                this.execution.executionOrder = msg.content.execution_count;
            }
        } catch (error) {
            traceError(`Cell (index = ${this.cell.index}) execution completed with errors (2).`, error);
            // If not a restart error, then tell the subscriber
            this._onErrorHandlingIOPubMessage.fire({ error, msg });
        }
    }

    private addToCellData(output: ExecuteResult | DisplayData | nbformat.IStream | nbformat.IError | nbformat.IOutput) {
        if (
            this.context.extensionMode === ExtensionMode.Test &&
            output.data &&
            typeof output.data === 'object' &&
            WIDGET_MIMETYPE in output.data
        ) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (output.data[WIDGET_MIMETYPE] as any)['_vsc_test_cellIndex'] = this.cell.index;
        }
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
        if (this.clearState.value) {
            this.clearLastUsedStreamOutput();
            this.execution?.clearOutput().then(noop, noop);
            this.clearState.update(false);
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
        traceCellMessage(this.cell, 'Append output in addToCellData');
        task?.appendOutput([cellOutput]).then(noop, noop);
        this.endTemporaryTask();
    }

    private async handleInputRequest(msg: KernelMessage.IStdinMessage) {
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
                    this.kernel.sendInputReply({ value: v || '', status: 'ok' });
                }, noop);

            this.prompts.delete(cancelToken);
        }
    }

    // See this for docs on the messages:
    // https://jupyter-client.readthedocs.io/en/latest/messaging.html#messaging-in-jupyter
    private handleExecuteResult(msg: KernelMessage.IExecuteResultMsg) {
        this.addToCellData({
            output_type: 'execute_result',
            data: msg.content.data,
            metadata: msg.content.metadata,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            transient: msg.content.transient as any, // NOSONAR
            execution_count: msg.content.execution_count
        });
    }

    private handleExecuteReply(msg: KernelMessage.IExecuteReplyMsg) {
        const reply = msg.content as KernelMessage.IExecuteReply;
        if (reply.payload) {
            reply.payload.forEach((payload) => {
                if (
                    payload.source &&
                    payload.source === 'set_next_input' &&
                    'text' in payload &&
                    'replace' in payload
                ) {
                    this.handleSetNextInput(payload as unknown as ISetNextInputPayload);
                }
                if (payload.data && payload.data.hasOwnProperty('text/plain')) {
                    this.addToCellData({
                        // Mark as stream output so the text is formatted because it likely has ansi codes in it.
                        output_type: 'stream',
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        text: (payload.data as any)['text/plain'].toString(),
                        name: 'stdout',
                        metadata: {},
                        execution_count: reply.execution_count
                    });
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
            const nbEdit = NotebookEdit.insertCells(this.cell.index + 1, [cellData]);
            edit.set(this.cell.notebook.uri, [nbEdit]);
        }
        workspace.applyEdit(edit).then(noop, noop);
    }

    private handleExecuteInput(msg: KernelMessage.IExecuteInputMsg) {
        if (msg.content.execution_count && this.execution) {
            this.execution.executionOrder = msg.content.execution_count;
        }
    }

    private handleStatusMessage(msg: KernelMessage.IStatusMsg) {
        traceCellMessage(this.cell, `Kernel switching to ${msg.content.execution_state}`);
    }
    private handleStreamMessage(msg: KernelMessage.IStreamMsg) {
        // eslint-disable-next-line complexity
        traceCellMessage(this.cell, 'Update streamed output');
        // Possible execution of cell has completed (the task would have been disposed).
        // This message could have come from a background thread.
        // In such circumstances, create a temporary task & use that to update the output (only cell execution tasks can update cell output).
        const task = this.execution || this.createTemporaryTask();

        // Clear output if waiting for a clear
        const clearOutput = this.clearState.value;
        if (clearOutput) {
            traceCellMessage(this.cell, 'Clear cell output');
            this.clearLastUsedStreamOutput();
            task?.clearOutput().then(noop, noop);
            this.clearState.update(false);
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
            traceCellMessage(this.cell, `Replace output items ${this.lastUsedStreamOutput.text.substring(0, 100)}`);
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
            traceCellMessage(this.cell, `Replace output ${this.lastUsedStreamOutput.text.substring(0, 100)}`);
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
            traceCellMessage(this.cell, `Append output ${this.lastUsedStreamOutput.text.substring(0, 100)}`);
            task?.appendOutput([output]).then(noop, noop);
        }
        this.endTemporaryTask();
    }

    private handleDisplayData(msg: KernelMessage.IDisplayDataMsg) {
        const output = {
            output_type: 'display_data',
            data: handleTensorBoardDisplayDataOutput(msg.content.data),
            metadata: msg.content.metadata,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            transient: msg.content.transient as any // NOSONAR
        };
        this.addToCellData(output);
    }

    private handleClearOutput(msg: KernelMessage.IClearOutputMsg) {
        // If the message says wait, add every message type to our clear state. This will
        // make us wait for this type of output before we clear it.
        if (msg && msg.content.wait) {
            this.clearState.update(true);
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

    private handleError(msg: KernelMessage.IErrorMsg) {
        let traceback = msg.content.traceback;
        this.formatters.forEach((formatter) => {
            traceback = formatter.format(this.cell, traceback);
        });
        const output: nbformat.IError = {
            output_type: 'error',
            ename: msg.content.ename,
            evalue: msg.content.evalue,
            traceback
        };

        this.addToCellData(output);
        this.cellHasErrorsInOutput = true;
    }

    @swallowExceptions()
    private handleReply(msg: KernelMessage.IShellControlMessage) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services');

        if (jupyterLab.KernelMessage.isExecuteReplyMsg(msg)) {
            this.handleExecuteReply(msg);

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
        traceCellMessage(this.cell, `Replace output items in display data ${newOutput.items.length}`);
        task?.replaceOutputItems(newOutput.items, outputToBeUpdated).then(noop, noop);
        this.endTemporaryTask();
    }
}
