// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as fastDeepEqual from 'fast-deep-equal';
import type * as nbformat from '@jupyterlab/nbformat';
import * as KernelMessage from '@jupyterlab/services/lib/kernel/messages';
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
import { IDisposable, IExtensionContext } from '../../platform/common/types';
import { concatMultilineString, formatStreamText, isJupyterNotebook } from '../../platform/common/utils';
import {
    traceCellMessage,
    cellOutputToVSCCellOutput,
    translateCellDisplayOutput,
    CellOutputMimeTypes
} from './helpers';
import { swallowExceptions } from '../../platform/common/utils/decorators';
import { noop } from '../../platform/common/utils/misc';
import { ITracebackFormatter } from '../../kernels/types';
import { handleTensorBoardDisplayDataOutput } from './executionHelpers';
import { WIDGET_MIMETYPE } from '../../kernels/ipywidgets-message-coordination/constants';
import isObject = require('lodash/isObject');

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

function getParentHeaderMsgId(msg: KernelMessage.IMessage): string | undefined {
    if (msg.parent_header && 'msg_id' in msg.parent_header) {
        return msg.parent_header.msg_id;
    }
    return undefined;
}

/**
 * The Output Widget in Jupyter can render multiple outputs. However some of them
 * like vendored mimetypes cannot be handled by it.
 */
function canMimeTypeBeRenderedByWidgetManager(mime: string) {
    if (mime == CellOutputMimeTypes.stderr || mime == CellOutputMimeTypes.stdout || mime == CellOutputMimeTypes.error) {
        // These are plain text mimetypes that can be rendered by the Jupyter Lab widget manager.
        return true;
    }
    if (mime.startsWith('application/vnd')) {
        // Custom vendored mimetypes cannot be rendered by the widget manager, it relies on the output renderers.
        return false;
    }
    // Everything else can be rendered by the Jupyter Lab widget manager.
    return true;
}

/**
 * Responsible for handling of jupyter messages as a result of execution of individual cells.
 */
export class CellExecutionMessageHandler implements IDisposable {
    /**
     * The msg_id of the original request execute (when executing the cell).
     */
    public readonly executeRequestMessageId: string;
    /**
     * Whether we're done with handling of the original request execute for a cell.
     */
    private completedExecution?: boolean;
    /**
     * Jupyter can sent a `clear_output` message which indicates the output of a cell should be cleared.
     * If the flag `wait` is set to `true`, then we should wait for the next output before clearing the output.
     * I.e. if the value for `wait` is false (default) then clear the cell output immediately.
     * https://ipywidgets.readthedocs.io/en/latest/examples/Output%20Widget.html#Output-widgets:-leveraging-Jupyter's-display-system
     */
    private clearOutputOnNextUpdateToOutput?: boolean;

    private execution?: NotebookCellExecution;
    private readonly _onErrorHandlingIOPubMessage = new EventEmitter<{
        error: Error;
        msg: KernelMessage.IIOPubMessage;
    }>();
    public readonly onErrorHandlingExecuteRequestIOPubMessage = this._onErrorHandlingIOPubMessage.event;
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
    private outputsAreSpecificToAWidget?: {
        /**
         * Comm Id (or model_id) of widget that will handle all messages and render them via the widget manager.
         * This could be a widget in another cell.
         */
        handlingCommId: string;
        /**
         * All messages that have a parent_header.msg_id = msg_id will be swallowed and handled by the widget with model_id = this.handlingCommId.
         * These requests could be from another cell, ie messages can original from one cell and end up getting displayed in another.
         * E.g. widget is in cell 1 and output will be redirected from cell 2 into widget 1.
         */
        msgIdsToSwallow: string;
        /**
         * If true, then we should clear all of the output owned by the widget defined by the commId.
         * By owned, we mean the output added after the widget widget output and not the widget itself.
         */
        clearOutputOnNextUpdateToOutput?: boolean;
    };
    private commIdsMappedToParentWidgetModel = new Map<string, string>();
    private readonly disposables: IDisposable[] = [];
    private readonly prompts = new Set<CancellationTokenSource>();
    /**
     * List of comm_ids Jupyter sent back when this cell was first executed
     * or for any subsequent requests as a result of outputs sending custom messages.
     */
    private readonly ownedCommIds = new Set<string>();
    private readonly outputsOwnedByWidgetModel = new Map<string, Set<string>>();
    /**
     * List of msg_ids of requests sent either as part of request_execute
     * or for any subsequent requests as a result of outputs sending custom messages.
     */
    private readonly ownedRequestMsgIds = new Set<string>();
    constructor(
        public readonly cell: NotebookCell,
        private readonly applicationService: IApplicationShell,
        private readonly controller: NotebookController,
        private readonly outputDisplayIdTracker: CellOutputDisplayIdTracker,
        private readonly context: IExtensionContext,
        private readonly formatters: ITracebackFormatter[],
        private readonly kernel: Kernel.IKernelConnection,
        request: Kernel.IShellFuture<KernelMessage.IExecuteRequestMsg, KernelMessage.IExecuteReplyMsg>,
        cellExecution: NotebookCellExecution
    ) {
        this.executeRequestMessageId = request.msg.header.msg_id;
        this.ownedRequestMsgIds.add(request.msg.header.msg_id);
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
                    this.cellHasErrorsInOutput = false;
                }
            },
            this,
            this.disposables
        );
        this.execution = cellExecution;
        // We're in all messages.
        // When using the `interact` function in Python, we can get outputs from comm messages even before execution has completed.
        // See https://github.com/microsoft/vscode-jupyter/issues/9503 for more information on why we need to monitor anyMessage and iopubMessage signals.
        this.kernel.anyMessage.connect(this.onKernelAnyMessage, this);
        this.kernel.iopubMessage.connect(this.onKernelIOPubMessage, this);

        request.onIOPub = () => {
            // Cell has been deleted or the like.
            if (this.cell.document.isClosed && !this.completedExecution) {
                request.dispose();
            }
        };
        request.onReply = (msg) => {
            // Cell has been deleted or the like.
            if (this.cell.document.isClosed) {
                request.dispose();
                return;
            }
            this.handleReply(msg);
        };
        request.onStdin = this.handleInputRequest.bind(this);
        request.done
            .finally(() => {
                this.completedExecution = true;
                this.endCellExecution();
            })
            .catch(noop);
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
        this.clearLastUsedStreamOutput();
        this.execution = undefined;
        this.kernel.anyMessage.disconnect(this.onKernelAnyMessage, this);
        this.kernel.iopubMessage.disconnect(this.onKernelIOPubMessage, this);
    }
    /**
     * This merely marks the end of the cell execution.
     * However this class will still monitor iopub messages from the kernel.
     * As its possible a widget from the output of this cell sends message to the kernel and
     * as a result of the response we get some new output.
     */
    private endCellExecution() {
        this.prompts.forEach((item) => item.dispose());
        this.prompts.clear();
        this.clearLastUsedStreamOutput();
        this.execution = undefined;

        if (this.cell.document.isClosed || (this.ownedCommIds.size === 0 && this.completedExecution)) {
            // If no comms channels were opened as a result of any outputs of this cell,
            // this means we don't have any widgets that can send comm message back to the kernel.
            // Hence no point listening to any of the iopub messages & the like, i.e. we can stop listening to everything in this class.
            this.dispose();
        }
    }
    private onKernelAnyMessage(_: unknown, { direction, msg }: Kernel.IAnyMessageArgs) {
        if (this.cell.document.isClosed) {
            return this.endCellExecution();
        }

        // We're only interested in messages after execution has completed.
        // See https://github.com/microsoft/vscode-jupyter/issues/9503 for more information.
        if (direction !== 'send' || !this.completedExecution) {
            return;
        }
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services');
        if (jupyterLab.KernelMessage.isCommMsgMsg(msg) && this.ownedCommIds.has(msg.content.comm_id)) {
            // Looks like we have a comm msg request sent by some output or the like.
            // See https://github.com/microsoft/vscode-jupyter/issues/9503 for more information.
            this.ownedRequestMsgIds.add(msg.header.msg_id);
        }
    }
    private onKernelIOPubMessage(_: unknown, msg: KernelMessage.IIOPubMessage<KernelMessage.IOPubMessageType>) {
        if (this.cell.document.isClosed) {
            return this.endCellExecution();
        }
        // We're only interested in messages after execution has completed.
        // See https://github.com/microsoft/vscode-jupyter/issues/9503 for more information.

        // Handle iopub messages that are sent from Jupyter in response to some
        // comm message (requests) sent by an output widget.
        // See https://github.com/microsoft/vscode-jupyter/issues/9503 for more information.
        if (
            !msg.parent_header ||
            !('msg_id' in msg.parent_header) ||
            !this.ownedRequestMsgIds.has(msg.parent_header.msg_id) ||
            msg.channel !== 'iopub'
        ) {
            return;
        }
        try {
            this.handleIOPub(msg);
        } catch (ex) {
            traceError(`Failed to handle iopub message as a result of some comm message`, msg, ex);
            if (!this.completedExecution && !this.cell.document.isClosed) {
                // If there are problems handling the execution, then bubble those to the calling code.
                // Else just log the errors.
                this._onErrorHandlingIOPubMessage.fire(ex);
            }
        }
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
    private handleIOPub(msg: KernelMessage.IIOPubMessage) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services');
        if (jupyterLab.KernelMessage.isCommOpenMsg(msg)) {
            this.ownedCommIds.add(msg.content.comm_id);
        } else if (jupyterLab.KernelMessage.isExecuteResultMsg(msg)) {
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
            this.handleCommMsg(msg);
        } else if (jupyterLab.KernelMessage.isCommCloseMsg(msg)) {
            // Noop.
        } else {
            traceWarning(`Unknown message ${msg.header.msg_type} : hasData=${'data' in msg.content}`);
        }

        // Set execution count, all messages should have it
        if ('execution_count' in msg.content && typeof msg.content.execution_count === 'number' && this.execution) {
            this.execution.executionOrder = msg.content.execution_count;
        }
    }
    private handleCommMsg(msg: KernelMessage.ICommMsgMsg) {
        const data = msg.content.data as Partial<{
            method: 'update';
            state: { msg_id: string } | { children: string[] };
        }>;
        if (!isObject(data) || data.method !== 'update' || !isObject(data.state)) {
            return;
        }

        if ('msg_id' in data.state && typeof data.state.msg_id === 'string') {
            // When such a comm message is received, then
            // the kernel is instructing the front end (UI widget manager)
            // to handle all of the messages that would have other wise been handled as regular execution messages for msg_id.
            const parentHeader = 'msg_id' in msg.parent_header ? msg.parent_header : undefined;
            if (
                this.ownedRequestMsgIds.has(msg.content.comm_id) ||
                (parentHeader && this.ownedRequestMsgIds.has(parentHeader.msg_id))
            ) {
                if (data.state.msg_id) {
                    // Any future messages sent from `parent_header.msg_id = msg_id` must be handled by the widget with the `mode_id = msg.content.comm_id`.
                    this.outputsAreSpecificToAWidget = {
                        handlingCommId: msg.content.comm_id,
                        msgIdsToSwallow: data.state.msg_id
                    };
                } else if (this.outputsAreSpecificToAWidget?.handlingCommId === msg.content.comm_id) {
                    // Handle all messages the normal way.
                    this.outputsAreSpecificToAWidget = undefined;
                }
            }
        } else if (
            'children' in data.state &&
            Array.isArray(data.state.children) &&
            this.ownedCommIds.has(msg.content.comm_id)
        ) {
            // This is the kernel instructing the widget manager that some outputs (comm_ids)
            // are in fact children of another output (comm).
            // We need to keep track of this so that we know who the common parent is.
            const IPY_MODEL_PREFIX = 'IPY_MODEL_';
            data.state.children.forEach((item) => {
                if (typeof item !== 'string') {
                    return traceWarning(`Came across a comm update message a child that isn't a string`, item);
                }
                if (!item.startsWith(IPY_MODEL_PREFIX)) {
                    return traceWarning(
                        `Came across a comm update message a child that start start with ${IPY_MODEL_PREFIX}`,
                        item
                    );
                }
                const commId = item.substring(IPY_MODEL_PREFIX.length);
                this.ownedCommIds.add(commId);
                this.commIdsMappedToParentWidgetModel.set(commId, msg.content.comm_id);
            });
        }
    }
    private clearOutputIfNecessary(execution: NotebookCellExecution | undefined): {
        previousValueOfClearOutputOnNextUpdateToOutput: boolean;
    } {
        if (this.clearOutputOnNextUpdateToOutput) {
            traceCellMessage(this.cell, 'Clear cell output');
            this.clearLastUsedStreamOutput();
            execution?.clearOutput().then(noop, noop);
            this.clearOutputOnNextUpdateToOutput = false;
            return { previousValueOfClearOutputOnNextUpdateToOutput: true };
        }
        return { previousValueOfClearOutputOnNextUpdateToOutput: false };
    }
    private addToCellData(
        output: ExecuteResult | DisplayData | nbformat.IStream | nbformat.IError | nbformat.IOutput,
        originalMessage: KernelMessage.IMessage
    ) {
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
        this.clearOutputIfNecessary(this.execution);
        // Keep track of the display_id against the output item, we might need this to update this later.
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
        // If the output belongs to a widget, then add the output to that specific widget (i.e. just below the widget).
        let outputShouldBeAppended = true;
        const parentHeaderMsgId = getParentHeaderMsgId(originalMessage);
        if (
            this.outputsAreSpecificToAWidget &&
            this.outputsAreSpecificToAWidget?.msgIdsToSwallow === parentHeaderMsgId &&
            cellOutput.items.every((item) => canMimeTypeBeRenderedByWidgetManager(item.mime))
        ) {
            // Plain text outputs will be displayed by the widget.
            outputShouldBeAppended = false;
        } else if (
            this.outputsAreSpecificToAWidget &&
            this.outputsAreSpecificToAWidget?.msgIdsToSwallow === parentHeaderMsgId
        ) {
            const result = this.updateWidgetOwnedOutput(
                { commId: this.outputsAreSpecificToAWidget.handlingCommId, outputToAppend: cellOutput },
                task
            );

            if (result?.outputAdded) {
                outputShouldBeAppended = false;
            }
        }
        if (outputShouldBeAppended) {
            task?.appendOutput([cellOutput]).then(noop, noop);
        }
        this.endTemporaryTask();
    }
    private updateWidgetOwnedOutput(
        options: { outputToAppend: NotebookCellOutput; commId: string } | { clearOutput: true },
        task?: NotebookCellExecution
    ): { outputAdded: true } | undefined {
        const commId = 'commId' in options ? options.commId : this.outputsAreSpecificToAWidget?.handlingCommId;
        if (!commId) {
            return;
        }
        const outputToAppend = 'outputToAppend' in options ? options.outputToAppend : undefined;

        const expectedModelId = this.commIdsMappedToParentWidgetModel.get(commId) || commId;
        const widgetOutput = this.cell.outputs.find((output) => {
            return output.items.find((outputItem) => {
                if (outputItem.mime !== WIDGET_MIMETYPE) {
                    return false;
                }
                try {
                    const value = JSON.parse(Buffer.from(outputItem.data).toString()) as { model_id?: string };
                    return value.model_id === expectedModelId;
                } catch (ex) {
                    traceWarning(`Failed to deserialize the widget data`, ex);
                }
                return false;
            });
        });
        if (!widgetOutput) {
            return;
        }
        const outputsOwnedByWidgetModel = this.outputsOwnedByWidgetModel.get(expectedModelId) || new Set<string>();

        // We have some new outputs, that need to be placed immediately after the widget and before any other output
        // that doesn't belong to the widget.
        const clearWidgetOutput = this.outputsAreSpecificToAWidget?.clearOutputOnNextUpdateToOutput === true;
        if (this.outputsAreSpecificToAWidget) {
            this.outputsAreSpecificToAWidget.clearOutputOnNextUpdateToOutput = false;
        }
        const newOutputs = this.cell.outputs.slice().filter((item) => {
            if (clearWidgetOutput) {
                // If we're supposed to clear the output, then clear all of the output that's
                // specific to this widget.
                // These are tracked further below.
                return !outputsOwnedByWidgetModel.has(item.id);
            } else {
                return true;
            }
        });

        const outputsUptoWidget = newOutputs.slice(0, newOutputs.indexOf(widgetOutput) + 1);
        const outputsAfterWidget = newOutputs.slice(newOutputs.indexOf(widgetOutput) + 1);

        this.outputsOwnedByWidgetModel.set(expectedModelId, outputsOwnedByWidgetModel);
        if (outputToAppend) {
            // Keep track of the output added that belongs to the widget.
            // Next time when we need to clear the output belonging to this widget, all we need to do is
            // filter out (exclude) these outputs.
            outputsOwnedByWidgetModel.add(outputToAppend.id);
        }

        // Ensure the new output is added just after the widget.
        const newOutput = outputToAppend
            ? outputsUptoWidget.concat(outputToAppend).concat(outputsAfterWidget)
            : outputsUptoWidget.concat(outputsAfterWidget);
        task?.replaceOutput(newOutput).then(noop, noop);
        return { outputAdded: true };
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
        this.addToCellData(
            {
                output_type: 'execute_result',
                data: msg.content.data,
                metadata: msg.content.metadata,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                transient: msg.content.transient as any, // NOSONAR
                execution_count: msg.content.execution_count
            },
            msg
        );
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
                        msg
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
        if (
            getParentHeaderMsgId(msg) &&
            this.outputsAreSpecificToAWidget?.msgIdsToSwallow == getParentHeaderMsgId(msg)
        ) {
            // Stream messages will be handled by the widget output.
            return;
        }

        // eslint-disable-next-line complexity
        traceCellMessage(this.cell, 'Update streamed output');
        // Possible execution of cell has completed (the task would have been disposed).
        // This message could have come from a background thread.
        // In such circumstances, create a temporary task & use that to update the output (only cell execution tasks can update cell output).
        const task = this.execution || this.createTemporaryTask();

        // Clear output if waiting for a clear
        const { previousValueOfClearOutputOnNextUpdateToOutput } = this.clearOutputIfNecessary(task);
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
        } else if (previousValueOfClearOutputOnNextUpdateToOutput) {
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
        this.addToCellData(output, msg);
    }

    private handleClearOutput(msg: KernelMessage.IClearOutputMsg) {
        // Check if this message should be handled by a specific Widget output.
        if (
            this.outputsAreSpecificToAWidget &&
            this.outputsAreSpecificToAWidget.msgIdsToSwallow === getParentHeaderMsgId(msg)
        ) {
            if (msg.content.wait) {
                this.outputsAreSpecificToAWidget.clearOutputOnNextUpdateToOutput = true;
            } else {
                const task = this.execution || this.createTemporaryTask();
                this.updateWidgetOwnedOutput({ clearOutput: true }, task);
                this.endTemporaryTask();
            }
            return;
        }

        // Regular output.
        if (msg.content.wait) {
            this.clearOutputOnNextUpdateToOutput = true;
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

        this.addToCellData(output, msg);
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
