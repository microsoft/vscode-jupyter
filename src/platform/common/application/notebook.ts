// Copyright (c) Microsoft Corporation.
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
    window,
    workspace,
    NotebookCell,
    NotebookSerializer,
    NotebookDocumentContentOptions,
    Uri,
    NotebookDocumentShowOptions,
    commands,
    EventEmitter
} from 'vscode';
import { IDisposableRegistry } from '../types';
import { sleep } from '../utils/async';
import { testOnlyMethod } from '../utils/decorators';
import { IApplicationEnvironment, IVSCodeNotebook } from './types';

/**
 * Wrapper around the vscode notebook apis. Essential to running tests as some of the ways we close down notebooks don't fire the real VS code apis.
 */
@injectable()
export class VSCodeNotebook implements IVSCodeNotebook {
    public readonly onDidChangeNotebookEditorSelection: Event<NotebookEditorSelectionChangeEvent>;
    public readonly onDidChangeActiveNotebookEditor: Event<NotebookEditor | undefined>;
    public readonly onDidOpenNotebookDocument: Event<NotebookDocument>;
    public get onDidCloseNotebookDocument(): Event<NotebookDocument> {
        return this._onDidCloseNotebookDocument.event;
    }
    public readonly onDidChangeVisibleNotebookEditors: Event<readonly NotebookEditor[]>;
    public readonly onDidSaveNotebookDocument: Event<NotebookDocument>;
    public get notebookDocuments(): ReadonlyArray<NotebookDocument> {
        return workspace.notebookDocuments;
    }
    public get notebookEditors() {
        return window.visibleNotebookEditors;
    }
    public get activeNotebookEditor(): NotebookEditor | undefined {
        return window.activeNotebookEditor;
    }
    private _onDidCloseNotebookDocument = new EventEmitter<NotebookDocument>();
    constructor(
        @inject(IApplicationEnvironment) readonly env: IApplicationEnvironment,
        @inject(IDisposableRegistry) private diposables: IDisposableRegistry
    ) {
        this.onDidChangeNotebookEditorSelection = window.onDidChangeNotebookEditorSelection;
        this.onDidChangeActiveNotebookEditor = window.onDidChangeActiveNotebookEditor;
        this.onDidOpenNotebookDocument = workspace.onDidOpenNotebookDocument;
        workspace.onDidCloseNotebookDocument((n) => this._onDidCloseNotebookDocument.fire(n), this, this.diposables);
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

    public async showNotebookDocument(
        document: NotebookDocument,
        options?: NotebookDocumentShowOptions
    ): Promise<NotebookEditor> {
        return window.showNotebookDocument(document, options);
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
        _additionalLocalResourceRoots?: Uri[]
    ): NotebookController {
        return notebooks.createNotebookController(
            id,
            viewType,
            label,
            handler
            // Not suported yet. See https://github.com/microsoft/vscode/issues/149868
            // additionalLocalResourceRoots
        );
    }

    @testOnlyMethod()
    public async closeActiveNotebooks() {
        // We could have untitled notebooks, close them by reverting changes.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const documents = new Set<NotebookDocument>(this.notebookDocuments);
        while (window.activeNotebookEditor) {
            documents.add(window.activeNotebookEditor.notebook);
            await commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
            await sleep(10);
        }

        // That command does not cause notebook on close to fire. Fire this for every active editor
        documents.forEach((d) => this._onDidCloseNotebookDocument.fire(d));
    }
}
