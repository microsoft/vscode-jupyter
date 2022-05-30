// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Kernel, KernelMessage } from '@jupyterlab/services';
import { NotebookCell, NotebookCellExecution, NotebookController } from 'vscode';
import { ITracebackFormatter } from '../../kernels/types';
import { IApplicationShell } from '../../platform/common/application/types';
import { IExtensionContext } from '../../platform/common/types';
import { CellOutputDisplayIdTracker } from './cellDisplayIdTracker';
import { CellExecutionMessageHandler } from './cellExecutionMessageHandler';

export class CellExecutionMessageHandlerFactory {
    constructor(
        private readonly appShell: IApplicationShell,
        private readonly controller: NotebookController,
        private readonly outputDisplayIdTracker: CellOutputDisplayIdTracker,
        private readonly context: IExtensionContext,
        private readonly formatters: ITracebackFormatter[]
    ) {}
    public create(
        cell: NotebookCell,
        options: {
            kernel: Kernel.IKernelConnection;
            request: Kernel.IShellFuture<KernelMessage.IExecuteRequestMsg, KernelMessage.IExecuteReplyMsg>;
            cellExecution: NotebookCellExecution;
        }
    ): CellExecutionMessageHandler {
        return new CellExecutionMessageHandler(
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
    }
}
