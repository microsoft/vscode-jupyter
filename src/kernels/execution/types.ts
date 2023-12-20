// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Event, NotebookCell, NotebookCellOutput } from 'vscode';
import { IKernelSession, NotebookCellRunState } from '../types';

export type IExecution = ICellExecution | ICodeExecution;

export interface ICellExecution {
    type: 'cell';
    cell: NotebookCell;
    result: Promise<NotebookCellRunState>;
    start(session: IKernelSession): Promise<void>;
    cancel(forced?: boolean): Promise<void>;
    dispose(): void;
}

export interface ICodeExecution {
    type: 'code';
    executionId: string;
    code: string;
    result: Promise<NotebookCellRunState>;
    onRequestSent: Event<void>;
    onRequestAcknowledged: Event<void>;
    onDidEmitOutput: Event<NotebookCellOutput>;
    start(session: IKernelSession): Promise<void>;
    cancel(forced?: boolean): Promise<void>;
    dispose(): void;
}
