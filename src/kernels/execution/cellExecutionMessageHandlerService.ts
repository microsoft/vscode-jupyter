// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Kernel, KernelMessage } from '@jupyterlab/services';
import { NotebookCell, NotebookCellExecution, NotebookDocument, workspace } from 'vscode';
import { IKernelController, ITracebackFormatter } from '../../kernels/types';
import { IApplicationShell } from '../../platform/common/application/types';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { IDisposable, IExtensionContext } from '../../platform/common/types';
import { CellExecutionMessageHandler } from './cellExecutionMessageHandler';

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
        private readonly formatters: ITracebackFormatter[]
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
    public registerListener(
        cell: NotebookCell,
        options: {
            kernel: Kernel.IKernelConnection;
            request: Kernel.IShellFuture<KernelMessage.IExecuteRequestMsg, KernelMessage.IExecuteReplyMsg>;
            cellExecution: NotebookCellExecution;
            onErrorHandlingExecuteRequestIOPubMessage: (error: Error) => void;
        }
    ): CellExecutionMessageHandler {
        this.notebook = cell.notebook;
        // Always dispose any previous handlers & create new ones.
        this.messageHandlers.get(cell)?.dispose();
        const handler = new CellExecutionMessageHandler(
            cell,
            this.appShell,
            this.controller,
            this.context,
            this.formatters,
            options.kernel,
            options.request,
            options.cellExecution
        );
        // This object must be kept in memory has it monitors the kernel messages.
        this.messageHandlers.set(cell, handler);
        return handler;
    }
}
