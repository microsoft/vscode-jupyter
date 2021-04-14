// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import {
    CancellationToken,
    NotebookCommunication,
    NotebookDocument,
    NotebookKernel,
    NotebookKernelProvider
} from 'vscode';

export const INotebookContentProvider = Symbol('INotebookContentProvider');

export const INotebookKernelProvider = Symbol('INotebookKernelProvider');
export interface INotebookKernelProvider extends NotebookKernelProvider {
    // IANHU: New interface / class / name? For now just put on the old provider
    createKernels(document: NotebookDocument, token: CancellationToken): Promise<void>;
}

export const INotebookKernelResolver = Symbol('INotebookKernelResolver');

export interface INotebookKernelResolver {
    resolveKernel(
        kernel: NotebookKernel,
        document: NotebookDocument,
        webview: NotebookCommunication,
        token: CancellationToken
    ): Promise<void>;
}

export enum CellOutputMimeTypes {
    error = 'application/x.notebook.error-traceback',
    stderr = 'application/x.notebook.stderr',
    stdout = 'application/x.notebook.stdout'
}
