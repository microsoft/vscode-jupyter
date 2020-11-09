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
export interface INotebookKernelProvider extends NotebookKernelProvider {
    readonly onResolvedKernel: vscode.Event<{
        kernel: NotebookKernel;
        document: NotebookDocument;
        webview: NotebookCommunication;
    }>;
}
