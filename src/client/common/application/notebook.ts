// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import {
    Disposable,
    Event,
    EventEmitter,
    notebooks,
    NotebookCellsChangeEvent as VSCNotebookCellsChangeEvent,
    NotebookContentProvider,
    NotebookController,
    NotebookDocument,
    NotebookEditor,
    NotebookEditorSelectionChangeEvent,
    NotebookExecuteHandler,
    NotebookRendererScript,
    window,
    workspace
} from 'vscode';
import { UseVSCodeNotebookEditorApi } from '../constants';
import { IDisposableRegistry } from '../types';
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
            console.error('Not using native');
            return;
        }
        try {
            console.error(`window.visibleNotebookEditors.length = ${window.visibleNotebookEditors.length}`);
            console.error(`workspace.notebookDocuments.length = ${workspace.notebookDocuments.length}`);
            console.error(`window.activeNotebookEditor = ${window.activeNotebookEditor}`);
            console.error(`window.activeTextEditor = ${window.activeTextEditor?.document?.uri?.toString()}`);
            return window.activeNotebookEditor;
        } catch {
            return undefined;
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
    public registerNotebookContentProvider(
        notebookType: string,
        provider: NotebookContentProvider,
        options?: {
            transientOutputs: boolean;
            transientCellMetadata?: { [x: string]: boolean | undefined } | undefined;
            transientDocumentMetadata?: { [x: string]: boolean | undefined } | undefined;
        }
    ): Disposable {
        return workspace.registerNotebookContentProvider(notebookType, provider, options);
    }
    public createNotebookController(
        id: string,
        viewType: string,
        label: string,
        handler?: NotebookExecuteHandler,
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
