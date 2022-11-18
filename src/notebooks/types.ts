// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CancellationToken,
    CompletionContext,
    CompletionItem,
    NotebookDocument,
    NotebookEditor,
    Position,
    TextDocument,
    Uri
} from 'vscode';
import { Resource } from '../platform/common/types';

export const INotebookKernelResolver = Symbol('INotebookKernelResolver');
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
    activeNotebookEditor: NotebookEditor | undefined;
    findNotebookEditor(resource: Resource): NotebookEditor | undefined;
    findAssociatedNotebookDocument(uri: Uri): NotebookDocument | undefined;
    registerEmbedNotebookProvider(provider: IEmbedNotebookEditorProvider): void;
}
