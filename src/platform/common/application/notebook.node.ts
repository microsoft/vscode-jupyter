// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import {
    Disposable,
    Event,
    notebooks,
    NotebookController,
    NotebookData,
    NotebookDocument,
    NotebookEditor,
    NotebookEditorSelectionChangeEvent,
    NotebookRendererScript,
    window,
    workspace,
    NotebookCell,
    NotebookSerializer,
    NotebookDocumentContentOptions,
    Uri,
    NotebookDocumentShowOptions,
    NotebookCellExecutionStateChangeEvent
} from 'vscode';
import { isUri } from '../utils/misc';
import { IApplicationEnvironment, IVSCodeNotebook } from './types';

@injectable()
export class VSCodeNotebook implements IVSCodeNotebook {
    public readonly onDidChangeNotebookEditorSelection: Event<NotebookEditorSelectionChangeEvent>;
    public readonly onDidChangeActiveNotebookEditor: Event<NotebookEditor | undefined>;
    public readonly onDidOpenNotebookDocument: Event<NotebookDocument>;
    public readonly onDidCloseNotebookDocument: Event<NotebookDocument>;
    public readonly onDidChangeVisibleNotebookEditors: Event<NotebookEditor[]>;
    public readonly onDidSaveNotebookDocument: Event<NotebookDocument>;
    public get onDidChangeNotebookCellExecutionState(): Event<NotebookCellExecutionStateChangeEvent> {
        return notebooks.onDidChangeNotebookCellExecutionState;
    }
    public get notebookDocuments(): ReadonlyArray<NotebookDocument> {
        return workspace.notebookDocuments;
    }
    public get notebookEditors() {
        return window.visibleNotebookEditors;
    }
    public get activeNotebookEditor(): NotebookEditor | undefined {
        return window.activeNotebookEditor;
    }
    constructor(@inject(IApplicationEnvironment) readonly env: IApplicationEnvironment) {
        this.onDidChangeNotebookEditorSelection = window.onDidChangeNotebookEditorSelection;
        this.onDidChangeActiveNotebookEditor = window.onDidChangeActiveNotebookEditor;
        this.onDidOpenNotebookDocument = workspace.onDidOpenNotebookDocument;
        this.onDidCloseNotebookDocument = workspace.onDidCloseNotebookDocument;
        this.onDidChangeVisibleNotebookEditors = window.onDidChangeVisibleNotebookEditors;
        this.onDidSaveNotebookDocument = workspace.onDidSaveNotebookDocument;
    }
    public async openNotebookDocument(uri: Uri): Promise<NotebookDocument>;
    public async openNotebookDocument(viewType: string, content?: NotebookData): Promise<NotebookDocument>;
    public async openNotebookDocument(viewOrUri: Uri | string, content?: NotebookData): Promise<NotebookDocument> {
        if (typeof viewOrUri === 'string') {
            return workspace.openNotebookDocument(viewOrUri, content);
        } else {
            return workspace.openNotebookDocument(viewOrUri);
        }
    }

    public async showNotebookDocument(uri: Uri, options?: NotebookDocumentShowOptions): Promise<NotebookEditor>;
    public async showNotebookDocument(
        document: NotebookDocument,
        options?: NotebookDocumentShowOptions
    ): Promise<NotebookEditor>;
    public async showNotebookDocument(
        uriOrDocument: Uri | NotebookDocument,
        options?: NotebookDocumentShowOptions
    ): Promise<NotebookEditor> {
        if (isUri(uriOrDocument)) {
            return window.showNotebookDocument(uriOrDocument, options);
        } else {
            return window.showNotebookDocument(uriOrDocument, options);
        }
    }

    public registerNotebookSerializer(
        notebookType: string,
        serializer: NotebookSerializer,
        options?: NotebookDocumentContentOptions
    ): Disposable {
        return workspace.registerNotebookSerializer(notebookType, serializer, options);
    }
    public createNotebookController(
        id: string,
        viewType: string,
        label: string,
        handler?: (
            cells: NotebookCell[],
            notebook: NotebookDocument,
            controller: NotebookController
        ) => void | Thenable<void>,
        rendererScripts?: NotebookRendererScript[]
    ): NotebookController {
        return notebooks.createNotebookController(id, viewType, label, handler, rendererScripts);
    }
}
