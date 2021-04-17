// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import {
    Event,
    CancellationToken,
    NotebookCommunication,
    NotebookDocument,
    NotebookKernel,
    NotebookKernelProvider
} from 'vscode';
import {
    IContextualHelp,
    IContextualHelpWebviewViewProvider,
    INotebook,
    IScratchPad,
    IScratchPadWebviewViewProvider
} from '../types';

export const INotebookContentProvider = Symbol('INotebookContentProvider');

export const INotebookStatusBarProvider = Symbol('INotebookStatusBarProvider');

export const INotebookKernelProvider = Symbol('INotebookKernelProvider');
export interface INotebookKernelProvider extends NotebookKernelProvider {}

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

export interface IActiveNotebookChangedEvent {
    notebook?: INotebook;
    executionCount?: number;
}

export const INotebookWatcher = Symbol('INotebookWatcher');
export interface INotebookWatcher {
    readonly activeNotebook?: INotebook;
    readonly activeNotebookExecutionCount?: number;
    readonly onDidChangeActiveNotebook: Event<IActiveNotebookChangedEvent>;
    readonly onDidExecuteActiveNotebook: Event<{ executionCount: number }>;
    readonly onDidRestartActiveNotebook: Event<void>;
}

export const IScratchPadProvider = Symbol('IScratchPadProvider');
export interface IScratchPadProvider extends IScratchPadWebviewViewProvider {
    readonly scratchPad: IScratchPad | undefined;
}

export const IContextualHelpProvider = Symbol('IContextualHelpProvider');
export interface IContextualHelpProvider extends IContextualHelpWebviewViewProvider {
    readonly contextualHelp: IContextualHelp | undefined;
}
