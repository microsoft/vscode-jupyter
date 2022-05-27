// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Kernel } from '@jupyterlab/services';
import { NotebookCell, NotebookController } from 'vscode';
import { ITracebackFormatter } from '../../kernels/types';
import { IApplicationShell } from '../../platform/common/application/types';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { IDisposable, IExtensionContext } from '../../platform/common/types';
import { CellOutputDisplayIdTracker } from './cellDisplayIdTracker';
import { CellExecutionMessageHandler } from './cellExecutionMessageHandler';

export class CellExecutionMessageHandlerFactory {
    private readonly disposables: IDisposable[] = [];
    private readonly messageHandlers = new Map<NotebookCell, CellExecutionMessageHandler>();
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
    public getOrCreate(cell: NotebookCell, kernel: Kernel.IKernelConnection): CellExecutionMessageHandler {
        if (!this.messageHandlers.has(cell)) {
            const handler = new CellExecutionMessageHandler(
                cell,
                this.appShell,
                this.controller,
                this.outputDisplayIdTracker,
                this.context,
                this.formatters,
                kernel
            );
            this.messageHandlers.set(cell, handler);
        }
        return this.messageHandlers.get(cell)!;
    }
    public get(cell: NotebookCell): CellExecutionMessageHandler | undefined {
        return this.messageHandlers.get(cell);
    }
}
