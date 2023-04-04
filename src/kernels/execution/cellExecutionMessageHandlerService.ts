// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Kernel, KernelMessage } from '@jupyterlab/services';
import { Memento, NotebookCell, NotebookCellExecution, NotebookDocument, workspace } from 'vscode';
import { IKernelController, ITracebackFormatter } from '../../kernels/types';
import { IApplicationShell } from '../../platform/common/application/types';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { IDisposable, IExtensionContext } from '../../platform/common/types';
import { CellExecutionMessageHandler } from './cellExecutionMessageHandler';
import { noop } from '../../platform/common/utils/misc';

/**
 * Allows registering a CellExecutionMessageHandler for a given execution.
 */
export class CellExecutionMessageHandlerService {
    private readonly disposables: IDisposable[] = [];
    private notebook?: NotebookDocument;
    private readonly messageHandlers = new WeakMap<NotebookCell, CellExecutionMessageHandler>();
    constructor(
        private readonly appShell: IApplicationShell,
        private readonly controller: IKernelController,
        private readonly context: IExtensionContext,
        private readonly formatters: ITracebackFormatter[],
        private readonly workspaceStorage: Memento
    ) {
        workspace.onDidChangeNotebookDocument(
            (e) => {
                if (e.notebook !== this.notebook) {
                    return;
                }
                e.contentChanges.forEach((change) =>
                    // If the cell is deleted, then dispose the corresponding handler.
                    change.removedCells.forEach((cell) => this.messageHandlers.get(cell)?.dispose())
                );
            },
            this,
            this.disposables
        );
    }
    dispose() {
        disposeAllDisposables(this.disposables);
        if (this.notebook) {
            this.notebook.getCells().forEach((cell) => this.messageHandlers.get(cell)?.dispose());
        }
    }
    public registerListenerForExecution(
        cell: NotebookCell,
        options: {
            kernel: Kernel.IKernelConnection;
            request: Kernel.IShellFuture<KernelMessage.IExecuteRequestMsg, KernelMessage.IExecuteReplyMsg>;
            cellExecution: NotebookCellExecution;
            startTime: number;
            onErrorHandlingExecuteRequestIOPubMessage: (error: Error) => void;
        }
    ): CellExecutionMessageHandler {
        this.notebook = cell.notebook;
        // Always dispose any previous handlers & create new ones.
        this.messageHandlers.get(cell)?.dispose();
        this.workspaceStorage
            .update(`LAST_EXECUTED_CELL_${cell.notebook.uri.toString()}`, {
                index: cell.index,
                msg_id: options.request?.msg.header.msg_id,
                startTime: options.startTime
            })
            .then(noop, noop);
        const iopubMessageHandler = (_: unknown, msg: KernelMessage.IIOPubMessage<KernelMessage.IOPubMessageType>) => {
            if (
                'execution_count' in msg.content &&
                typeof msg.content.execution_count === 'number' &&
                'msg_id' in msg.parent_header &&
                msg.parent_header.msg_id === options.request.msg.header.msg_id
            ) {
                const currentInfo = this.workspaceStorage.get<
                    | {
                          index: number;
                          msg_id: string;
                          startTime: number;
                          execution_count: number;
                      }
                    | undefined
                >(`LAST_EXECUTED_CELL_${cell.notebook.uri.toString()}`, undefined);
                if (currentInfo?.msg_id === options.request.msg.header.msg_id) {
                    this.workspaceStorage
                        .update(`LAST_EXECUTED_CELL_${cell.notebook.uri.toString()}`, {
                            ...currentInfo,
                            execution_count: msg.content.execution_count
                        })
                        .then(noop, noop);
                }
            }
        };
        options.kernel.iopubMessage.connect(iopubMessageHandler);
        const handler = new CellExecutionMessageHandler(
            cell,
            this.appShell,
            this.controller,
            this.context,
            this.formatters,
            options.kernel,
            options.request,
            options.cellExecution,
            options.request.msg.header.msg_id
        );
        // This object must be kept in memory has it monitors the kernel messages.
        this.messageHandlers.set(cell, handler);
        handler.completed.finally(() => {
            options.kernel.iopubMessage.disconnect(iopubMessageHandler);
            const info = this.workspaceStorage.get<
                | {
                      index: number;
                      msg_id: string;
                  }
                | undefined
            >(`LAST_EXECUTED_CELL_${cell.notebook.uri.toString()}`, undefined);
            if (
                !info ||
                info.index !== cell.index ||
                cell.document.isClosed ||
                info?.msg_id !== options.request?.msg.header.msg_id
            ) {
                return;
            }
            this.workspaceStorage
                .update(`LAST_EXECUTED_CELL_${cell.notebook.uri.toString()}`, undefined)
                .then(noop, noop);
        });
        return handler;
    }
    public registerListenerForResumingExecution(
        cell: NotebookCell,
        options: {
            kernel: Kernel.IKernelConnection;
            msg_id: string;
            cellExecution: NotebookCellExecution;
            onErrorHandlingExecuteRequestIOPubMessage: (error: Error) => void;
        }
    ): CellExecutionMessageHandler {
        this.notebook = cell.notebook;
        // Always dispose any previous handlers & create new ones.
        this.messageHandlers.get(cell)?.dispose();
        this.workspaceStorage
            .update(`LAST_EXECUTED_CELL_${cell.notebook.uri.toString()}`, {
                index: cell.index,
                msg_id: options.msg_id
            })
            .then(noop, noop);
        const handler = new CellExecutionMessageHandler(
            cell,
            this.appShell,
            this.controller,
            this.context,
            this.formatters,
            options.kernel,
            undefined,
            options.cellExecution,
            options.msg_id
        );
        // This object must be kept in memory has it monitors the kernel messages.
        this.messageHandlers.set(cell, handler);
        return handler;
    }
}
