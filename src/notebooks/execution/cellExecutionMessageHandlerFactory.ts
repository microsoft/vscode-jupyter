// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Kernel, KernelMessage } from '@jupyterlab/services';
import { NotebookCell, NotebookCellExecution, NotebookController, NotebookDocument, workspace } from 'vscode';
import { ITracebackFormatter } from '../../kernels/types';
import { IApplicationShell } from '../../platform/common/application/types';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { IDisposable, IExtensionContext } from '../../platform/common/types';
import { CellOutputDisplayIdTracker } from './cellDisplayIdTracker';
import { CellExecutionMessageHandler } from './cellExecutionMessageHandler';

export class CellExecutionMessageHandlerFactory {
    private readonly disposables: IDisposable[] = [];
    private notebook?: NotebookDocument;
    private readonly messageHandlers = new WeakMap<NotebookCell, CellExecutionMessageHandler>();
    constructor(
        private readonly appShell: IApplicationShell,
        private readonly controller: NotebookController,
        private readonly outputDisplayIdTracker: CellOutputDisplayIdTracker,
        private readonly context: IExtensionContext,
        private readonly formatters: ITracebackFormatter[]
    ) {
        workspace.onDidChangeNotebookDocument(
            (e) => {
                if (e.notebook !== this.notebook) {
                    return;
                }
                e.contentChanges.forEach((change) =>
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
    public create(
        cell: NotebookCell,
        options: {
            kernel: Kernel.IKernelConnection;
            request: Kernel.IShellFuture<KernelMessage.IExecuteRequestMsg, KernelMessage.IExecuteReplyMsg>;
            cellExecution: NotebookCellExecution;
        }
    ): CellExecutionMessageHandler {
        this.notebook = cell.notebook;
        this.messageHandlers.get(cell)?.dispose();
        const handler = new CellExecutionMessageHandler(
            cell,
            this.appShell,
            this.controller,
            this.outputDisplayIdTracker,
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
    public get(cell: NotebookCell): CellExecutionMessageHandler | undefined {
        return this.messageHandlers.get(cell);
    }
}
