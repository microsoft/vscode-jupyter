// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import {
    CancellationToken,
    CompletionContext,
    CompletionItem,
    Event,
    NotebookDocument,
    NotebookEditor,
    Position,
    TextDocument,
    Uri
} from 'vscode';
import { Resource } from '../platform/common/types';
import { KernelConnectionMetadata, LiveRemoteKernelConnectionMetadata } from '../kernels/types';
import { IVSCodeNotebookController } from './controllers/types';
import { InteractiveWindowView, JupyterNotebookView } from './constants';

export const INotebookKernelResolver = Symbol('INotebookKernelResolver');

export const INotebookControllerManager = Symbol('INotebookControllerManager');
export interface INotebookControllerManager {
    readonly onNotebookControllerSelected: Event<{ notebook: NotebookDocument; controller: IVSCodeNotebookController }>;
    readonly onNotebookControllerSelectionChanged: Event<void>;
    readonly kernelConnections: Promise<Readonly<KernelConnectionMetadata>[]>;
    readonly remoteRefreshed: Event<LiveRemoteKernelConnectionMetadata[]>;
    /**
     * @param {boolean} [refresh] Optionally forces a refresh of all local/remote kernels.
     */
    loadNotebookControllers(refresh?: boolean): Promise<void>;
    getSelectedNotebookController(document: NotebookDocument): IVSCodeNotebookController | undefined;
    // Marked test only, just for tests to access registered controllers
    getRegisteredNotebookControllers(): IVSCodeNotebookController[];
    getActiveInterpreterOrDefaultController(
        notebookType: typeof JupyterNotebookView | typeof InteractiveWindowView,
        resource: Resource
    ): Promise<IVSCodeNotebookController | undefined>;
    getControllerForConnection(
        connection: KernelConnectionMetadata,
        notebookType: typeof JupyterNotebookView | typeof InteractiveWindowView
    ): IVSCodeNotebookController | undefined;
    getPreferredNotebookController(document: NotebookDocument): IVSCodeNotebookController | undefined;
    initializePreferredNotebookController(document: NotebookDocument): Promise<void>;
    computePreferredNotebookController(
        document: NotebookDocument,
        serverId?: string
    ): Promise<{ preferredConnection?: KernelConnectionMetadata; controller?: IVSCodeNotebookController }>;
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

export const INotebookCompletionProvider = Symbol('INotebookCompletionProvider');

export interface INotebookCompletionProvider {
    getCompletions(
        notebook: NotebookDocument,
        document: TextDocument,
        position: Position,
        context: CompletionContext,
        cancelToken: CancellationToken
    ): Promise<CompletionItem[] | null | undefined>;
}

// For native editing, the provider acts like the IDocumentManager for normal docs
export const INotebookEditorProvider = Symbol('INotebookEditorProvider');
export interface INotebookEditorProvider {
    open(file: Uri): Promise<void>;
    createNew(options?: { contents?: string; defaultCellLanguage?: string }): Promise<void>;
}
