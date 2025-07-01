// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { NotebookDocument, NotebookEditor, Uri, type Event } from 'vscode';
import { Resource } from '../platform/common/types';
import type { EnvironmentPath } from '@vscode/python-extension';

export interface IEmbedNotebookEditorProvider {
    findNotebookEditor(resource: Resource): NotebookEditor | undefined;
    findAssociatedNotebookDocument(uri: Uri): NotebookDocument | undefined;
}

export const INotebookEditorProvider = Symbol('INotebookEditorProvider');
export interface INotebookEditorProvider {
    activeNotebookEditor: NotebookEditor | undefined;
    findNotebookEditor(resource: Resource): NotebookEditor | undefined;
    findAssociatedNotebookDocument(uri: Uri): NotebookDocument | undefined;
    registerEmbedNotebookProvider(provider: IEmbedNotebookEditorProvider): void;
}

export const INotebookPythonEnvironmentService = Symbol('INotebookPythonEnvironmentService');
export interface INotebookPythonEnvironmentService {
    onDidChangeEnvironment: Event<Uri>;
    getPythonEnvironment(uri: Uri): EnvironmentPath | undefined;
}

export const ICellExecutionTracker = Symbol('ICellExecutionTracker');
export interface ICellExecutionTracker {
    /**
     * Check if any cells have been executed in the given notebook.
     */
    hasExecutedCells(notebook: NotebookDocument): boolean;
    
    /**
     * Reset the execution state for a notebook (e.g., after kernel restart).
     */
    resetExecutionState(notebook: NotebookDocument): void;
}
