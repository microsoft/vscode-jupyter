// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fastDeepEqual from 'fast-deep-equal';
import type * as nbformat from '@jupyterlab/nbformat';
import type * as KernelMessage from '@jupyterlab/services/lib/kernel/messages';
import {
    NotebookCell,
    NotebookCellExecution,
    NotebookCellKind,
    NotebookCellExecutionSummary,
    NotebookDocument,
    workspace,
    WorkspaceEdit,
    NotebookCellData,
    Range,
    NotebookCellOutput,
    CancellationTokenSource,
    EventEmitter,
    ExtensionMode,
    NotebookEdit,
    NotebookCellOutputItem,
    Disposable
} from 'vscode';

import type { Kernel, Session } from '@jupyterlab/services';
import { CellExecutionCreator } from './cellExecutionCreator';
import { IApplicationShell } from '../../platform/common/application/types';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { traceError, traceInfo, traceInfoIfCI, traceVerbose, traceWarning } from '../../platform/logging';
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
import { IKernelController, ITracebackFormatter } from '../../kernels/types';
import { handleTensorBoardDisplayDataOutput } from './executionHelpers';
import { Identifiers, WIDGET_MIMETYPE } from '../../platform/common/constants';
import { CellOutputDisplayIdTracker } from './cellDisplayIdTracker';
import { createDeferred } from '../../platform/common/utils/async';

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
type WidgetData = {
    version_major: number;
    version_minor: number;
    model_id: string;
};

/**
 * At any given point in time, we can only have one cell actively running.
 * This will keep track of that task.
 */
export const activeNotebookCellExecution = new WeakMap<NotebookDocument, NotebookCellExecution | undefined>();

export function getParentHeaderMsgId(msg: KernelMessage.IMessage): string | undefined {
    if (msg.parent_header && 'msg_id' in msg.parent_header) {
        return msg.parent_header.msg_id;
    }
    return undefined;
}

/**
 * Responsible for handling of jupyter messages as a result of execution of individual cells.
 */
export class CellExecutionMessageHandler implements IDisposable {
    /**
     * Keeps track of the Models Ids (model_id) that is displayed in the output of a specific cell.
     * model_id's maps to Output Widgets.
     * Hence here we're keeping track of the widgets displayed in outputs of specific cells.
     */
    private static modelIdsOwnedByCells = new WeakMap<NotebookCell, Set<string>>();
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
    private disposed?: boolean;
    private startTime?: number;

    public get hasErrorOutput() {
        return this.cellHasErrorsInOutput === true;
    }
    /**
     * We keep track of the last output that was used to store stream text.
     * We need this so that we can update it later on (when we get new data for the same stream).
     * If users clear outputs or if we have a new output other than stream, then clear this item.
     * Because if after the stream we have an image, then the stream is not the last output item, hence its cleared.
     */
    private lastUsedStreamOutput?: { stream: 'stdout' | 'stderr'; output: NotebookCellOutput };
    /**
     * When we have nested Output Widgets, we get comm messages one for each output widget.
     * The way it works is:
     * - Jupyter sends a comm open message indicating there's an output widget
     * - Jupyter sends a comm message indicating all messages from now on belong to the output widget.
     *      - Now if we have another output widget thats nested in the previous, then we get another comm open message.
     *      - Jupyter sends a comm message indicating all messages from now on belong to the second output widget.
     *      - Jupyter sends a comm message indicating all messages from now on don't belong to the second the output widget is done (comm message with msg_id = '').
     * - Jupyter sends a comm message indicating all messages from now on don't belong to the first the output widget is done (comm message with msg_id = '').
     *
     * Basically its a stack, as we create new outputs nested within another we get comm messages and we need to keep track of the stack.
     */
    private outputsAreSpecificToAWidget: {
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
         * By owned, we mean the output added after the Output Widget and not the widget itself.
         */
        clearOutputOnNextUpdateToOutput?: boolean;
    }[] = [];
    private commIdsMappedToParentWidgetModel = new Map<string, string>();
    private readonly disposables: IDisposable[] = [];
    private readonly prompts = new Set<CancellationTokenSource>();
    /**
     * List of comm_ids Jupyter sent back when this cell was first executed
     * or for any subsequent requests as a result of outputs sending custom messages.
     */
    private readonly ownedCommIds = new Set<string>();
    private readonly commIdsMappedToWidgetOutputModels = new Set<string>();
    private static readonly outputsOwnedByWidgetModel = new Map<string, Set<string>>();
    /**
     * List of msg_ids of requests sent either as part of request_execute
     * or for any subsequent requests as a result of outputs sending custom messages.
     */
    private readonly ownedRequestMsgIds = new Set<string>();
    private readonly _completed = createDeferred<void>();
    public get completed() {
        return this._completed.promise;
    }
    private gotIdleIOPubStatus = false;
    private gotShellReply = false;
    private streamsReAttachedToExecutingCell = false;
    private endAbnormallyTimeout?: NodeJS.Timeout | number;
    constructor(
        public readonly cell: NotebookCell,
        private readonly applicationService: IApplicationShell,
        private readonly controller: IKernelController,
        private readonly context: IExtensionContext,
        private readonly formatters: ITracebackFormatter[],
        private readonly session: Session.ISessionConnection,
        private readonly request:
            | Kernel.IShellFuture<KernelMessage.IExecuteRequestMsg, KernelMessage.IExecuteReplyMsg>
            | undefined,
        cellExecution: NotebookCellExecution,
        executionMessageId: string
    ) {
        this._completed.promise.catch(noop);
        this.executeRequestMessageId = executionMessageId;
        this.ownedRequestMsgIds.add(executionMessageId);
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
        this.session.anyMessage.connect(this.onKernelAnyMessage, this);
        this.session.iopubMessage.connect(this.onKernelIOPubMessage, this);

        if (request) {
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
        traceCellMessage(this.cell, 'Execution Message Handler disposed');
        disposeAllDisposables(this.disposables);
        this.prompts.forEach((item) => item.dispose());
        this.prompts.clear();
        // Assume you have a long running cell, then reload vscode, next this cell continues running.
        // Next you interrupt this cell, next this class will get disposed
        // However due to restoring outputs, we could end up with a final stream output or the like,
        // The new stream ends up getting added as a new output (instead of appending to existing output),
        // this happens as the previous stream has been cleared (if we call clearLastUsedStreamOutput).
        // Thats why we never clear the last stream when disposing this class for restored executions (request === undefined).
        if (this.request) {
            this.clearLastUsedStreamOutput();
        }
        this.execution = undefined;
        this.session.anyMessage.disconnect(this.onKernelAnyMessage, this);
        this.session.iopubMessage.disconnect(this.onKernelIOPubMessage, this);
        this._onErrorHandlingIOPubMessage.dispose();
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
        // Assume you have a long running cell, then reload vscode, next this cell continues running.
        // Next you interrupt this cell, next this class will get disposed
        // However due to restoring outputs, we could end up with a final stream output or the like,
        // The new stream ends up getting added as a new output (instead of appending to existing output),
        // this happens as the previous stream has been cleared (if we call clearLastUsedStreamOutput).
        // Thats why we never clear the last stream when disposing this class for restored executions (request === undefined).
        if (this.request) {
            this.clearLastUsedStreamOutput();
        }
        this.execution = undefined;
        this._completed.resolve();
    }
    private onKernelAnyMessage(_: unknown, { direction, msg }: Kernel.IAnyMessageArgs) {
        if (this.cell.document.isClosed) {
            return this.endCellExecution();
        }
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services');

        if (!this.request && direction === 'recv') {
            const parentMsgId = getParentHeaderMsgId(msg);
            // In @jupyterlab/services/lib/kernel/future.js a request is marked as completed when we receive a status message with execution_state = 'idle' and have received a reply in shell chanel.
            if (
                jupyterLab.KernelMessage.isStatusMsg(msg) &&
                msg.content.execution_state === 'idle' &&
                parentMsgId === this.executeRequestMessageId
            ) {
                this.gotIdleIOPubStatus = true;
            }
            if (msg.channel === 'shell' && parentMsgId === this.executeRequestMessageId) {
                this.gotShellReply = true;
            }
            // Scenario
            // Start a long running cell, then reload vscode
            // now interrupt the cell after we reload, this will send an interrupt request to the kernel
            // We will get a response saying that the response is being processed, but that does not mean it was processed.
            // So we should ignore status == busy messages for other msg_ids
            // We are only interested in idle messages for new requests.
            const isBusyProcessingAnotherRequest =
                jupyterLab.KernelMessage.isStatusMsg(msg) &&
                msg.content.execution_state !== 'idle' &&
                parentMsgId !== this.executeRequestMessageId;

            typeof msg.parent_header === 'object' &&
                msg.parent_header &&
                'msg_type' in msg.parent_header &&
                msg.parent_header.msg_type === 'interrupt_request';
            // If we have a new parent message id, then this means a new request is being processed.
            // I.e. previous request is done.
            const gotANewMessage = parentMsgId
                ? parentMsgId !== this.executeRequestMessageId && !isBusyProcessingAnotherRequest
                : false;
            const isResponseToInterruptRequest =
                typeof msg.parent_header === 'object' &&
                msg.parent_header &&
                'msg_type' in msg.parent_header &&
                msg.parent_header.msg_type === 'interrupt_request';
            // This is what marks a request as completed in Jupyter Lab API.
            const completed = this.gotIdleIOPubStatus && this.gotShellReply;
            // The following are backups, just in case the above doesn't work.
            // If we're resuming execution of a cell, then end the cell execution
            // when we receive certain message types.
            // If we're reloading or the like and then re-connecting to an active session, then
            // the kernel is probably busy executing a cell,
            // The first thin we do is always send a request for kernle info,
            // If we get a response for that, then this means the previous cell execution has completed.
            // Similarly if we see a response for an execution then the previous execution has completed.
            const messageTypesIndicatingEndOfCellExecution = ['kernel_info_reply', 'execute_input', 'execute_reply'];
            const gotMessageThatIndicatesEndOfCellExecution =
                'msg_type' in msg &&
                typeof msg.msg_type === 'string' &&
                messageTypesIndicatingEndOfCellExecution.includes(msg.msg_type);
            if (!this.completedExecution && completed) {
                this.completedExecution = true;
                // Clear the hacky way of ending the execution.
                if (this.endAbnormallyTimeout) {
                    clearTimeout(this.endAbnormallyTimeout);
                }
                return this.endCellExecution();
            }
            if (!this.completedExecution && (gotMessageThatIndicatesEndOfCellExecution || gotANewMessage)) {
                // This is a hacky way of ending the execution, hence wait for 100ms  before ending the execution.
                // Its possible that within a second we will a proper response from the kernel that marks the end of execution.
                if (this.endAbnormallyTimeout) {
                    clearTimeout(this.endAbnormallyTimeout);
                }
                this.endAbnormallyTimeout = setTimeout(
                    () => {
                        this.completedExecution = true;
                        this.endAbnormallyTimeout = undefined;
                        return this.endCellExecution();
                    },
                    // If we got an idle response to an interrupt request, this means the previous request has ended.
                    // However its very likely we will get a valid response to end the previous request, hence lets wait 1s for that response to come back.
                    isResponseToInterruptRequest ? 1000 : 100
                );
                this.disposables.push(
                    new Disposable(() => {
                        clearTimeout(this.endAbnormallyTimeout);
                        this.endAbnormallyTimeout = undefined;
                    })
                );
                return;
            }
        }
        // We're only interested in messages after execution has completed.
        // See https://github.com/microsoft/vscode-jupyter/issues/9503 for more information.
        if (direction !== 'send' || !this.completedExecution) {
            return;
        }
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
        if (!this.startTime) {
            // Set the start time after we get some kind of a response to the execution request.
            // This is a more accurate representation of when the cell execution started.
            this.startTime = new Date().getTime();
            try {
                // The time from the kernel is more accurate, as that will ignore the network latency.
                this.startTime = new Date(msg.header.date).getTime();
            } catch {
                //
            }
            this.execution?.start(this.startTime);
            traceInfo(`Kernel acknowledged execution of cell ${this.cell.index} @ ${this.startTime}`);
        }

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services');
        if (jupyterLab.KernelMessage.isCommOpenMsg(msg)) {
            this.handleCommOpen(msg);
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
    private handleCommOpen(msg: KernelMessage.ICommOpenMsg) {
        this.ownedCommIds.add(msg.content.comm_id);
        // Check if this is a message for an Output Widget,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const state: { _model_module: string } | undefined = (msg.content.data?.state as any) || undefined;
        if (
            msg.content.target_name === Identifiers.DefaultCommTarget &&
            state &&
            state._model_module === '@jupyter-widgets/output'
        ) {
            this.commIdsMappedToWidgetOutputModels.add(msg.content.comm_id);
        }
    }
    private handleCommMsg(msg: KernelMessage.ICommMsgMsg) {
        const data = msg.content.data as Partial<{
            method: 'update';
            state: { msg_id: string } | { children: string[] };
        }>;
        if (!data || data.method !== 'update' || typeof data.state !== 'object') {
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
                    this.outputsAreSpecificToAWidget.push({
                        handlingCommId: msg.content.comm_id,
                        msgIdsToSwallow: data.state.msg_id
                    });
                } else if (
                    this.outputsAreSpecificToAWidget.length &&
                    this.outputsAreSpecificToAWidget[this.outputsAreSpecificToAWidget.length - 1].handlingCommId ===
                        msg.content.comm_id
                ) {
                    // Handle all messages the normal way.
                    this.outputsAreSpecificToAWidget.pop();
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
        if (output.data && typeof output.data === 'object' && WIDGET_MIMETYPE in output.data) {
            const widgetData = output.data[WIDGET_MIMETYPE] as WidgetData;
            if (widgetData && this.context.extensionMode === ExtensionMode.Test) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (widgetData as any)['_vsc_test_cellIndex'] = this.cell.index;
            }
            if (widgetData && 'model_id' in widgetData) {
                const modelIds = CellExecutionMessageHandler.modelIdsOwnedByCells.get(this.cell) || new Set<string>();
                modelIds.add(widgetData.model_id);
                CellExecutionMessageHandler.modelIdsOwnedByCells.set(this.cell, modelIds);
            }
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
        // Append to the data (we would push here but VS code requires a recreation of the array)
        // Possible execution of cell has completed (the task would have been disposed).
        // This message could have come from a background thread.
        // In such circumstances, create a temporary task & use that to update the output (only cell execution tasks can update cell output).
        const task = this.execution || this.createTemporaryTask();
        // Clear if necessary
        this.clearOutputIfNecessary(task);
        // Keep track of the display_id against the output item, we might need this to update this later.
        if (displayId) {
            CellOutputDisplayIdTracker.trackOutputByDisplayId(this.cell, displayId, cellOutput, cellOutput.items);
        }

        this.clearLastUsedStreamOutput();
        traceCellMessage(this.cell, 'Append output in addToCellData');
        // If the output belongs to a widget, then add the output to that specific widget (i.e. just below the widget).
        let outputShouldBeAppended = true;
        const parentHeaderMsgId = getParentHeaderMsgId(originalMessage);
        if (
            this.outputsAreSpecificToAWidget.length &&
            this.outputsAreSpecificToAWidget[this.outputsAreSpecificToAWidget.length - 1].msgIdsToSwallow ===
                parentHeaderMsgId &&
            cellOutput.items.every((item) =>
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                this.canMimeTypeBeRenderedByWidgetManager(item)
            )
        ) {
            // Plain text outputs will be displayed by the widget.
            outputShouldBeAppended = false;
        } else if (
            this.outputsAreSpecificToAWidget.length &&
            this.outputsAreSpecificToAWidget[this.outputsAreSpecificToAWidget.length - 1].msgIdsToSwallow ===
                parentHeaderMsgId
        ) {
            const result = this.updateJupyterOutputWidgetWithOutput(
                {
                    commId: this.outputsAreSpecificToAWidget[this.outputsAreSpecificToAWidget.length - 1]
                        .handlingCommId,
                    outputToAppend: cellOutput
                },
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

    /**
     * The Output Widget in Jupyter can render multiple outputs.
     * However some of them like the Output Widget & vendored mimetypes cannot be handled by it.
     */
    private canMimeTypeBeRenderedByWidgetManager(outputItem: NotebookCellOutputItem) {
        const mime = outputItem.mime;
        if (
            mime == CellOutputMimeTypes.stderr ||
            mime == CellOutputMimeTypes.stdout ||
            mime == CellOutputMimeTypes.error
        ) {
            // These are plain text mimetypes that can be rendered by the Jupyter Lab widget manager.
            return true;
        }
        if (mime === WIDGET_MIMETYPE) {
            const data: WidgetData = JSON.parse(Buffer.from(outputItem.data).toString());
            // Jupyter Output widgets cannot be rendered properly by the widget manager,
            // We need to render that.
            if (typeof data.model_id === 'string' && this.commIdsMappedToWidgetOutputModels.has(data.model_id)) {
                return false;
            }
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
     * Assume we have a Jupyter Output Widget, and we render that in Cell1.
     * Now we add some output to that output from Cell2, general outputs will be automatically handled by the widget class.
     * More complex outputs like plotly or the like, need to be handed by us (as Jupyter Output Widget expects Jupyter Notebooks/Jupyter Lab UI to handle that).
     * To make this possible, we first need to find out the cell that owns the Output Widget, and then add that output to that particular cell.
     * What we do in such a case is append this complex output just after the Output widget.
     *
     * In other cases, when appending such output, we need to clear the previous output that we added.
     *
     * This method is responsible for:
     * - Finding the cell that owns the output widget
     * - Clearing the custom output that was appended after the output widget.
     * - Appending custom output after the output widget
     */
    private updateJupyterOutputWidgetWithOutput(
        options: { outputToAppend: NotebookCellOutput; commId: string } | { clearOutput: true },
        task?: NotebookCellExecution
    ): { outputAdded: true } | undefined {
        const outputAreSpecificToAWidgetHandlingCommId = this.outputsAreSpecificToAWidget.length
            ? this.outputsAreSpecificToAWidget[this.outputsAreSpecificToAWidget.length - 1].handlingCommId
            : undefined;
        const commId = 'commId' in options ? options.commId : outputAreSpecificToAWidgetHandlingCommId;
        if (!commId) {
            return;
        }
        const outputToAppend = 'outputToAppend' in options ? options.outputToAppend : undefined;

        const expectedModelId = this.commIdsMappedToParentWidgetModel.get(commId) || commId;
        // Find the cell that owns the widget (where its model_id = commId).
        const cell = this.cell.notebook
            .getCells()
            .find((cell) => CellExecutionMessageHandler.modelIdsOwnedByCells.get(cell)?.has(expectedModelId));
        if (!cell) {
            traceWarning(`Unable to find a cell that owns the model ${expectedModelId}`);
            return;
        }
        const widgetOutput = cell.outputs.find((output) => {
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
        const outputsOwnedByWidgetModel =
            CellExecutionMessageHandler.outputsOwnedByWidgetModel.get(expectedModelId) || new Set<string>();

        // We have some new outputs, that need to be placed immediately after the widget and before any other output
        // that doesn't belong to the widget.
        const clearOption = 'clearOutput' in options ? options.clearOutput : false;
        const clearWidgetOutput =
            clearOption ||
            (this.outputsAreSpecificToAWidget.length
                ? this.outputsAreSpecificToAWidget[this.outputsAreSpecificToAWidget.length - 1]
                      .clearOutputOnNextUpdateToOutput === true
                : false);
        if (this.outputsAreSpecificToAWidget.length) {
            this.outputsAreSpecificToAWidget[
                this.outputsAreSpecificToAWidget.length - 1
            ].clearOutputOnNextUpdateToOutput = false;
        }
        const newOutputs = cell.outputs.slice().filter((item) => {
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

        CellExecutionMessageHandler.outputsOwnedByWidgetModel.set(expectedModelId, outputsOwnedByWidgetModel);
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
        if (outputsAfterWidget.length === 0 && outputToAppend) {
            // No need to replace everything, just append what we need.
            task?.appendOutput(outputToAppend, cell).then(noop, noop);
        } else if (clearWidgetOutput && !outputToAppend && outputsAfterWidget.length === 0) {
            // We're supposed to clear the output after a specific widget, but there are no other outputs after the widget.
            // As there's nothing to clear, hence no changes to be made.
        } else {
            task?.replaceOutput(newOutput, cell).then(noop, noop);
        }
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
                    this.session.kernel?.sendInputReply({ value: v || '', status: 'ok' });
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
            this.outputsAreSpecificToAWidget.length &&
            this.outputsAreSpecificToAWidget[this.outputsAreSpecificToAWidget.length - 1].msgIdsToSwallow ==
                getParentHeaderMsgId(msg)
        ) {
            // Stream messages will be handled by the Output Widget.
            return;
        }

        // eslint-disable-next-line complexity
        traceCellMessage(this.cell, `Update streamed output, new output '${msg.content.text.substring(0, 100)}'`);
        // Possible execution of cell has completed (the task would have been disposed).
        // This message could have come from a background thread.
        // In such circumstances, create a temporary task & use that to update the output (only cell execution tasks can update cell output).
        const task = this.execution || this.createTemporaryTask();

        const outputName =
            msg.content.name === 'stdout'
                ? NotebookCellOutputItem.stdout('').mime
                : NotebookCellOutputItem.stderr('').mime;
        // If we're resuming a previously executing cell (e.g. by reloading vscode),
        // & the last output is an output with the same stream output items then use that (instead of creating a whole new output).
        // Because with streams we always append to the existing output (unless we have different mime types or different stream types)
        if (!this.request && !this.streamsReAttachedToExecutingCell && !this.lastUsedStreamOutput) {
            if (
                this.cell.outputs.length &&
                this.cell.outputs[this.cell.outputs.length - 1].items.length >= 1 &&
                this.cell.outputs[this.cell.outputs.length - 1].items.every((item) => item.mime === outputName)
            ) {
                this.lastUsedStreamOutput = {
                    output: this.cell.outputs[0],
                    stream: msg.content.name
                };
            }
        }
        this.streamsReAttachedToExecutingCell = true;

        // Clear output if waiting for a clear
        const { previousValueOfClearOutputOnNextUpdateToOutput } = this.clearOutputIfNecessary(task);
        // Ensure we append to previous output, only if the streams as the same &
        // If the last output is the desired stream type.
        if (this.lastUsedStreamOutput?.stream === msg.content.name) {
            const output = cellOutputToVSCCellOutput({
                output_type: 'stream',
                name: msg.content.name,
                text: msg.content.text
            });
            traceCellMessage(this.cell, `Append output items '${msg.content.text.substring(0, 100)}`);
            task?.appendOutputItems(output.items, this.lastUsedStreamOutput.output).then(noop, noop);
        } else if (previousValueOfClearOutputOnNextUpdateToOutput) {
            // Replace the current outputs with a single new output.
            const text = concatMultilineString(msg.content.text);
            const output = cellOutputToVSCCellOutput({
                output_type: 'stream',
                name: msg.content.name,
                text
            });
            this.lastUsedStreamOutput = { output, stream: msg.content.name };
            traceCellMessage(this.cell, `Replace output with '${text.substring(0, 100)}'`);
            task?.replaceOutput([output]).then(noop, noop);
        } else {
            // Create a new output
            const text = formatStreamText(concatMultilineString(msg.content.text));
            const output = cellOutputToVSCCellOutput({
                output_type: 'stream',
                name: msg.content.name,
                text
            });
            this.lastUsedStreamOutput = { output, stream: msg.content.name };
            traceCellMessage(this.cell, `Append new output '${text.substring(0, 100)}'`);
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
        // Check if this message should be handled by a specific Output Widget.
        if (
            this.outputsAreSpecificToAWidget.length &&
            this.outputsAreSpecificToAWidget[this.outputsAreSpecificToAWidget.length - 1].msgIdsToSwallow ===
                getParentHeaderMsgId(msg)
        ) {
            if (msg.content.wait) {
                if (this.outputsAreSpecificToAWidget.length) {
                    this.outputsAreSpecificToAWidget[
                        this.outputsAreSpecificToAWidget.length - 1
                    ].clearOutputOnNextUpdateToOutput = true;
                }
            } else {
                const task = this.execution || this.createTemporaryTask();
                this.updateJupyterOutputWidgetWithOutput({ clearOutput: true }, task);
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
        traceInfoIfCI(`Traceback for error ${traceback}`);
        this.formatters.forEach((formatter) => {
            traceback = formatter.format(this.cell, traceback);
        });
        traceInfoIfCI(`Traceback for error after formatting ${traceback}`);
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
            traceWarning('Update display data message received, but no display id', msg.content);
            return;
        }
        const outputToBeUpdated = CellOutputDisplayIdTracker.getMappedOutput(this.cell.notebook, displayId);
        if (!outputToBeUpdated) {
            traceWarning('Update display data message received, but no output found to update', msg.content);
            return;
        }
        if (outputToBeUpdated.cell.document.isClosed) {
            traceWarning('Update display data message received, but output cell is closed', msg.content);
            return;
        }
        const output = translateCellDisplayOutput(
            new NotebookCellOutput(outputToBeUpdated.outputItems, outputToBeUpdated.outputContainer.metadata)
        );
        const newOutput = cellOutputToVSCCellOutput({
            ...output,
            data: msg.content.data,
            metadata: msg.content.metadata
        } as nbformat.IDisplayData);
        // If there was no output and still no output, then nothing to do.
        if (outputToBeUpdated.outputItems.length === 0 && newOutput.items.length === 0) {
            traceVerbose('Update display data message received, but no output to update', msg.content);
            return;
        }
        // Compare each output item (at the end of the day everything is serializable).
        // Hence this is a safe comparison.
        let outputMetadataHasChanged = false;
        if (outputToBeUpdated.outputItems.length === newOutput.items.length) {
            let allAllOutputItemsSame = true;
            if (!fastDeepEqual(outputToBeUpdated.outputContainer.metadata || {}, newOutput.metadata || {})) {
                outputMetadataHasChanged = true;
                allAllOutputItemsSame = false;
            }
            if (allAllOutputItemsSame) {
                for (let index = 0; index < outputToBeUpdated.outputItems.length; index++) {
                    if (!fastDeepEqual(outputToBeUpdated.outputItems[index], newOutput.items[index])) {
                        allAllOutputItemsSame = false;
                        break;
                    }
                }
            }
            if (allAllOutputItemsSame) {
                // If everything is still the same, then there's nothing to update.
                traceVerbose(
                    'Update display data message received, but no output to update (data is the same)',
                    msg.content
                );
                return;
            }
        }
        // Possible execution of cell has completed (the task would have been disposed).
        // This message could have come from a background thread.
        // In such circumstances, create a temporary task & use that to update the output (only cell execution tasks can update cell output).
        const task = this.execution || this.createTemporaryTask();
        traceCellMessage(this.cell, `Replace output items in display data ${newOutput.items.length}`);
        if (outputMetadataHasChanged) {
            // https://github.com/microsoft/vscode/issues/181369
            // This operation is very unsafe as we replace all of the outputs, when we need to replace just one output.
            // Unsafe because its possible some new outputs were added to this cell (appended).
            // However this is the only way we can update the output along with its metadata.
            const newOutputs = outputToBeUpdated.cell.outputs.map((o) => {
                const jupyterOutput = translateCellDisplayOutput(o);
                // Replace just the item that stores the display data.
                if (
                    jupyterOutput.output_type === 'display_data' &&
                    'transient' in jupyterOutput &&
                    jupyterOutput.transient &&
                    typeof jupyterOutput.transient === 'object' &&
                    'display_id' in jupyterOutput.transient &&
                    typeof jupyterOutput.transient.display_id === 'string' &&
                    jupyterOutput.transient.display_id === displayId
                ) {
                    return newOutput;
                }
                return o;
            });
            task?.replaceOutput(newOutputs, outputToBeUpdated.cell).then(noop, noop);
            CellOutputDisplayIdTracker.trackOutputByDisplayId(
                outputToBeUpdated.cell,
                displayId,
                newOutput,
                newOutput.items
            );
        } else {
            task?.replaceOutputItems(newOutput.items, outputToBeUpdated.outputContainer).then(noop, noop);
            CellOutputDisplayIdTracker.trackOutputByDisplayId(
                outputToBeUpdated.cell,
                // Though the items have been replaced, the output container is still the same, hence keep track of the last output object.
                displayId,
                outputToBeUpdated.outputContainer,
                newOutput.items
            );
        }
        this.endTemporaryTask();
    }
}
