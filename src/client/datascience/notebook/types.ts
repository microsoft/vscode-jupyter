// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { Event, NotebookDocument, NotebookEditor, Uri } from 'vscode';
import type * as vsc from 'vscode-languageclient/node';
import { Resource } from '../../common/types';
import { KernelConnectionMetadata, LiveKernelConnectionMetadata } from '../jupyter/kernels/types';
import { InteractiveWindowView, JupyterNotebookView } from './constants';
import { VSCodeNotebookController } from './vscodeNotebookController';

export const INotebookKernelResolver = Symbol('INotebookKernelResolver');

export const INotebookControllerManager = Symbol('INotebookControllerManager');
export interface INotebookControllerManager {
    readonly onNotebookControllerSelected: Event<{ notebook: NotebookDocument; controller: VSCodeNotebookController }>;
    readonly onNotebookControllerSelectionChanged: Event<void>;
    readonly kernelConnections: Promise<Readonly<KernelConnectionMetadata>[]>;
    readonly remoteRefreshed: Event<LiveKernelConnectionMetadata[]>;
    /**
     * @param {boolean} [refresh] Optionally forces a refresh of all local/remote kernels.
     */
    loadNotebookControllers(refresh?: boolean): Promise<void>;
    getSelectedNotebookController(document: NotebookDocument): VSCodeNotebookController | undefined;
    // Marked test only, just for tests to access registered controllers
    registeredNotebookControllers(): VSCodeNotebookController[];
    getActiveInterpreterOrDefaultController(
        notebookType: typeof JupyterNotebookView | typeof InteractiveWindowView,
        resource: Resource
    ): Promise<VSCodeNotebookController | undefined>;
    getControllerForConnection(
        connection: KernelConnectionMetadata,
        notebookType: typeof JupyterNotebookView | typeof InteractiveWindowView
    ): VSCodeNotebookController | undefined;
    getPreferredNotebookController(document: NotebookDocument): VSCodeNotebookController | undefined;
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

export const INotebookLanguageClientProvider = Symbol('INotebookLanguageClientProvider');
export interface INotebookLanguageClientProvider {
    getLanguageClient(notebook: NotebookDocument): Promise<vsc.LanguageClient | undefined>;
}
