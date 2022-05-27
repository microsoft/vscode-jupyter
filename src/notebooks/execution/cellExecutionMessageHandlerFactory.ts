// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Kernel, KernelMessage } from '@jupyterlab/services';
import { NotebookCell, NotebookCellExecution, NotebookController } from 'vscode';
import { ITracebackFormatter } from '../../kernels/types';
import { IApplicationShell } from '../../platform/common/application/types';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { IDisposable, IExtensionContext } from '../../platform/common/types';
import { CellOutputDisplayIdTracker } from './cellDisplayIdTracker';
import { CellExecutionMessageHandler } from './cellExecutionMessageHandler';

export class CellExecutionMessageHandlerFactory {
    private readonly disposables: IDisposable[] = [];
    private readonly messageHandlers = new WeakMap<NotebookCell, CellExecutionMessageHandler>();
    constructor(
        private readonly appShell: IApplicationShell,
        private readonly controller: NotebookController,
        private readonly outputDisplayIdTracker: CellOutputDisplayIdTracker,
        private readonly context: IExtensionContext,
        private readonly formatters: ITracebackFormatter[]
    ) {}
    dispose() {
        disposeAllDisposables(this.disposables);
    }
    public getOrCreate(
        cell: NotebookCell,
        options: {
            kernel: Kernel.IKernelConnection;
            request: Kernel.IShellFuture<KernelMessage.IExecuteRequestMsg, KernelMessage.IExecuteReplyMsg>;
            cellExecution: NotebookCellExecution;
        }
    ): CellExecutionMessageHandler {
        if (!this.messageHandlers.has(cell)) {
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
            this.messageHandlers.set(cell, handler);
        }
        return this.messageHandlers.get(cell)!;
    }
    public get(cell: NotebookCell): CellExecutionMessageHandler | undefined {
        return this.messageHandlers.get(cell);
    }
}
