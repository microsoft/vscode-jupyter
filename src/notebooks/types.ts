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
import { JupyterNotebookView, InteractiveWindowView } from '../platform/common/constants';

export const INotebookKernelResolver = Symbol('INotebookKernelResolver');

export const INotebookControllerManager = Symbol('INotebookControllerManager');
export interface INotebookControllerManager {
    readonly onNotebookControllerSelected: Event<{ notebook: NotebookDocument; controller: IVSCodeNotebookController }>;
    readonly onNotebookControllerSelectionChanged: Event<{
        notebook: NotebookDocument;
        controller: IVSCodeNotebookController;
        selected: boolean;
    }>;
    readonly onNotebookControllersLoaded: Event<Readonly<IVSCodeNotebookController[]>>;
    readonly kernelConnections: Promise<Readonly<KernelConnectionMetadata>[]>;
    readonly remoteRefreshed: Event<LiveRemoteKernelConnectionMetadata[]>;
    /**
     * @param {boolean} [refresh] Optionally forces a refresh of all local/remote kernels.
     */
    loadNotebookControllers(refresh?: boolean): Promise<void>;
    getSelectedNotebookController(document: NotebookDocument): IVSCodeNotebookController | undefined;
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

export interface IEmbedNotebookEditorProvider {
    findNotebookEditor(resource: Resource): NotebookEditor | undefined;
    findAssociatedNotebookDocument(uri: Uri): NotebookDocument | undefined;
}

// For native editing, the provider acts like the IDocumentManager for normal docs
export const INotebookEditorProvider = Symbol('INotebookEditorProvider');
export interface INotebookEditorProvider {
    createNew(options?: { contents?: string; defaultCellLanguage?: string }): Promise<void>;
    activeNotebookEditor: NotebookEditor | undefined;
    findNotebookEditor(resource: Resource): NotebookEditor | undefined;
    findAssociatedNotebookDocument(uri: Uri): NotebookDocument | undefined;
    registerEmbedNotebookProvider(provider: IEmbedNotebookEditorProvider): void;
}
