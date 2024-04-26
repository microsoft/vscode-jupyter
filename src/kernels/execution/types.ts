// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Event, NotebookCell, NotebookCellOutput } from 'vscode';
import { IKernelSession } from '../types';

export type IExecution = ICellExecution | ICodeExecution;

export interface ICellExecution {
    type: 'cell';
    cell: NotebookCell;
    result: Promise<void>;
    /**
     * Execution count for the cell after it completed execution.
     * Its possible that cell.executionSummary.executionOrder is undefined when this is set.
     * Thats because the data has not yet made its way to VS Code and back into the extension host model API.
     *
     * This gives us access to the execution count as soon as its available.
     * Without having to wait for the roundtrip to complete.
     */
    executionOrder?: number;
    start(session: IKernelSession): Promise<void>;
    cancel(forced?: boolean): Promise<void>;
    dispose(): void;
}

export interface ICodeExecution {
    type: 'code';
    executionId: string;
    code: string;
    result: Promise<void>;
    onRequestSent: Event<void>;
    onRequestAcknowledged: Event<void>;
    onDidEmitOutput: Event<NotebookCellOutput>;
    start(session: IKernelSession): Promise<void>;
    cancel(forced?: boolean): Promise<void>;
    dispose(): void;
}
