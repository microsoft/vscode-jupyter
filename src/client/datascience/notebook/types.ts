// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { Event, NotebookDocument, NotebookEditor, Uri } from 'vscode';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { VSCodeNotebookController } from './vscodeNotebookController';

export const INotebookKernelResolver = Symbol('INotebookKernelResolver');

export const INotebookControllerManager = Symbol('INotebookControllerManager');
export interface INotebookControllerManager {
    readonly onNotebookControllerSelected: Event<{ notebook: NotebookDocument; controller: VSCodeNotebookController }>;
    loadNotebookControllers(): Promise<void>;
    getSelectedNotebookController(document: NotebookDocument): VSCodeNotebookController | undefined;
    // Marked test only, just for tests to access registered controllers
    registeredNotebookControllers(): VSCodeNotebookController[];
    getOrCreateController(pythonInterpreter: PythonEnvironment): VSCodeNotebookController | undefined;
}
export enum CellOutputMimeTypes {
    error = 'application/vnd.code.notebook.error',
    stderr = 'application/vnd.code.notebook.stderr',
    stdout = 'application/vnd.code.notebook.stdout'
}

/**
 * Handles communications between the WebView (used to render oututs in Notebooks) & extension host.
 */
export interface INotebookCommunication {
    readonly editor: NotebookEditor;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly onDidReceiveMessage: Event<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    postMessage(message: any): Thenable<boolean>;
    asWebviewUri(localResource: Uri): Uri;
}
