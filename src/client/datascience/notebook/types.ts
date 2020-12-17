// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as vscode from 'vscode';

import {
    NotebookCommunication,
    NotebookDocument,
    NotebookKernel,
    NotebookKernelProvider
} from '../../../../types/vscode-proposed';

export const INotebookContentProvider = Symbol('INotebookContentProvider');

export const INotebookKernelProvider = Symbol('INotebookKernelProvider');
export interface INotebookKernelProvider extends NotebookKernelProvider {}

export const INotebookKernelResolver = Symbol('INotebookKernelResolver');

export interface INotebookKernelResolver {
    resolveKernel(
        kernel: NotebookKernel,
        document: NotebookDocument,
        webview: NotebookCommunication,
        token: vscode.CancellationToken
    ): Promise<void>;
}
