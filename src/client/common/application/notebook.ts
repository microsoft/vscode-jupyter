// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import {
    Disposable,
    Event,
    EventEmitter,
    notebooks,
    NotebookCellsChangeEvent as VSCNotebookCellsChangeEvent,
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
    NotebookDocumentShowOptions
} from 'vscode';
import { UseVSCodeNotebookEditorApi } from '../constants';
import { IDisposableRegistry } from '../types';
import { isUri } from '../utils/misc';
import { IApplicationEnvironment, IVSCodeNotebook, NotebookCellChangedEvent } from './types';

@injectable()
export class VSCodeNotebook implements IVSCodeNotebook {
    public readonly onDidChangeNotebookEditorSelection: Event<NotebookEditorSelectionChangeEvent>;
    public readonly onDidChangeActiveNotebookEditor: Event<NotebookEditor | undefined>;
    public readonly onDidOpenNotebookDocument: Event<NotebookDocument>;
    public readonly onDidCloseNotebookDocument: Event<NotebookDocument>;
    public readonly onDidChangeVisibleNotebookEditors: Event<NotebookEditor[]>;
    public readonly onDidSaveNotebookDocument: Event<NotebookDocument>;
    public readonly onDidChangeNotebookDocument: Event<NotebookCellChangedEvent>;
    public get notebookDocuments(): ReadonlyArray<NotebookDocument> {
        return this.canUseNotebookApi ? workspace.notebookDocuments : [];
    }
    public get notebookEditors() {
        return this.canUseNotebookApi ? window.visibleNotebookEditors : [];
    }
    public get activeNotebookEditor(): NotebookEditor | undefined {
        if (!this.useNativeNb) {
            return;
        }
        try {
            return window.activeNotebookEditor;
        } catch {
            return;
        }
    }
    private readonly _onDidChangeNotebookDocument = new EventEmitter<NotebookCellChangedEvent>();
    private addedEventHandlers?: boolean;
    private readonly canUseNotebookApi?: boolean;
    private readonly handledCellChanges = new WeakSet<VSCNotebookCellsChangeEvent>();
    constructor(
        @inject(UseVSCodeNotebookEditorApi) private readonly useNativeNb: boolean,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IApplicationEnvironment) readonly env: IApplicationEnvironment
    ) {
        if (this.useNativeNb) {
            this.addEventHandlers();
            this.canUseNotebookApi = true;
            this.onDidChangeNotebookEditorSelection = window.onDidChangeNotebookEditorSelection;
            this.onDidChangeActiveNotebookEditor = window.onDidChangeActiveNotebookEditor;
            this.onDidOpenNotebookDocument = workspace.onDidOpenNotebookDocument;
            this.onDidCloseNotebookDocument = workspace.onDidCloseNotebookDocument;
            this.onDidChangeVisibleNotebookEditors = window.onDidChangeVisibleNotebookEditors;
            this.onDidSaveNotebookDocument = notebooks.onDidSaveNotebookDocument;
            this.onDidChangeNotebookDocument = this._onDidChangeNotebookDocument.event;
        } else {
            this.onDidChangeNotebookEditorSelection = this.createDisposableEventEmitter<
                NotebookEditorSelectionChangeEvent
            >();
            this.onDidChangeActiveNotebookEditor = this.createDisposableEventEmitter<NotebookEditor | undefined>();
            this.onDidOpenNotebookDocument = this.createDisposableEventEmitter<NotebookDocument>();
            this.onDidCloseNotebookDocument = this.createDisposableEventEmitter<NotebookDocument>();
            this.onDidChangeVisibleNotebookEditors = this.createDisposableEventEmitter<NotebookEditor[]>();
            this.onDidSaveNotebookDocument = this.createDisposableEventEmitter<NotebookDocument>();
            this.onDidChangeNotebookDocument = this.createDisposableEventEmitter<NotebookCellChangedEvent>();
        }
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
        return workspace.registerNotebookSerializer(notebookType, serializer, options, {
            displayName: 'Jupyter',
            filenamePattern: ['*.ipynb']
        });
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
    private createDisposableEventEmitter<T>() {
        const eventEmitter = new EventEmitter<T>();
        this.disposables.push(eventEmitter);
        return eventEmitter.event;
    }
    private addEventHandlers() {
        if (this.addedEventHandlers) {
            return;
        }
        this.addedEventHandlers = true;
        this.disposables.push(
            ...[
                notebooks.onDidChangeCellMetadata((e) =>
                    this._onDidChangeNotebookDocument.fire({ ...e, type: 'changeCellMetadata' })
                ),
                notebooks.onDidChangeNotebookDocumentMetadata((e) =>
                    this._onDidChangeNotebookDocument.fire({ ...e, type: 'changeNotebookMetadata' })
                ),
                notebooks.onDidChangeCellOutputs((e) =>
                    this._onDidChangeNotebookDocument.fire({ ...e, type: 'changeCellOutputs' })
                ),
                notebooks.onDidChangeNotebookCells((e) => {
                    if (this.handledCellChanges.has(e)) {
                        return;
                    }
                    this.handledCellChanges.add(e);
                    this._onDidChangeNotebookDocument.fire({ ...e, type: 'changeCells' });
                })
            ]
        );
    }
}
