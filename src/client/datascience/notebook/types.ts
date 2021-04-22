// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { Event, NotebookDocument } from 'vscode';
import { VSCodeNotebookController } from './vscodeNotebookController';

export const INotebookContentProvider = Symbol('INotebookContentProvider');

export const INotebookKernelResolver = Symbol('INotebookKernelResolver');

export const INotebookControllerManager = Symbol('INotebookControllerManager');
export interface INotebookControllerManager {
    readonly onNotebookControllerSelected: Event<{ notebook: NotebookDocument; controller: VSCodeNotebookController }>;
    getSelectedNotebookController(document: NotebookDocument): VSCodeNotebookController | undefined;
    getNotebookControllers(document: NotebookDocument): VSCodeNotebookController[] | undefined;
}

export enum CellOutputMimeTypes {
    error = 'application/x.notebook.error-traceback',
    stderr = 'application/x.notebook.stderr',
    stdout = 'application/x.notebook.stdout'
}
