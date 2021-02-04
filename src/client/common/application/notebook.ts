// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Disposable, Event, EventEmitter } from 'vscode';
import type {
    notebook,
    NotebookCellMetadata,
    NotebookCellsChangeEvent as VSCNotebookCellsChangeEvent,
    NotebookContentProvider,
    NotebookDocument,
    NotebookDocumentFilter,
    NotebookEditor,
    NotebookEditorSelectionChangeEvent,
    NotebookKernel,
    NotebookKernelProvider,
    window as notebookWindow
} from '../../../../types/vscode-proposed';
import { UseVSCodeNotebookEditorApi } from '../constants';
import { IDisposableRegistry } from '../types';
import { IApplicationEnvironment, IVSCodeNotebook, NotebookCellChangedEvent } from './types';

@injectable()
export class VSCodeNotebook implements IVSCodeNotebook {
    public readonly onDidChangeActiveNotebookKernel: Event<{
        document: NotebookDocument;
        kernel: NotebookKernel | undefined;
    }>;
    public readonly onDidChangeNotebookEditorSelection: Event<NotebookEditorSelectionChangeEvent>;
    public readonly onDidChangeActiveNotebookEditor: Event<NotebookEditor | undefined>;
    public readonly onDidOpenNotebookDocument: Event<NotebookDocument>;
    public readonly onDidCloseNotebookDocument: Event<NotebookDocument>;
    public readonly onDidSaveNotebookDocument: Event<NotebookDocument>;
    public readonly onDidChangeNotebookDocument: Event<NotebookCellChangedEvent>;
    public get notebookDocuments(): ReadonlyArray<NotebookDocument> {
        return this.canUseNotebookApi ? this.notebook.notebookDocuments : [];
    }
    public get notebookEditors() {
        return this.canUseNotebookApi ? this.window.visibleNotebookEditors : [];
    }
    public get activeNotebookEditor(): NotebookEditor | undefined {
        if (!this.useNativeNb) {
            return;
        }
        try {
            return this.window.activeNotebookEditor;
        } catch {
            return undefined;
        }
    }
    private get notebook() {
        if (!this._notebook) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            this._notebook = require('vscode').notebook;
        }
        return this._notebook!;
    }
    private get window() {
        if (!this._window) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            this._window = require('vscode').window;
        }
        return this._window!;
    }
    private readonly _onDidChangeNotebookDocument = new EventEmitter<NotebookCellChangedEvent>();
    private addedEventHandlers?: boolean;
    private _notebook?: typeof notebook;
    private _window?: typeof notebookWindow;
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
            this.onDidChangeActiveNotebookKernel = this.notebook.onDidChangeActiveNotebookKernel;
            this.onDidChangeNotebookEditorSelection = this.window.onDidChangeNotebookEditorSelection;
            this.onDidChangeActiveNotebookEditor = this.window.onDidChangeActiveNotebookEditor;
            this.onDidOpenNotebookDocument = this.notebook.onDidOpenNotebookDocument;
            this.onDidCloseNotebookDocument = this.notebook.onDidCloseNotebookDocument;
            this.onDidSaveNotebookDocument = this.notebook.onDidSaveNotebookDocument;
            this.onDidChangeNotebookDocument = this._onDidChangeNotebookDocument.event;
        } else {
            this.onDidChangeActiveNotebookKernel = this.createDisposableEventEmitter<{
                document: NotebookDocument;
                kernel: NotebookKernel | undefined;
            }>();
            this.onDidChangeNotebookEditorSelection = this.createDisposableEventEmitter<
                NotebookEditorSelectionChangeEvent
            >();
            this.onDidChangeActiveNotebookEditor = this.createDisposableEventEmitter<NotebookEditor | undefined>();
            this.onDidOpenNotebookDocument = this.createDisposableEventEmitter<NotebookDocument>();
            this.onDidCloseNotebookDocument = this.createDisposableEventEmitter<NotebookDocument>();
            this.onDidSaveNotebookDocument = this.createDisposableEventEmitter<NotebookDocument>();
            this.onDidChangeNotebookDocument = this.createDisposableEventEmitter<NotebookCellChangedEvent>();
        }
    }
    public registerNotebookContentProvider(
        notebookType: string,
        provider: NotebookContentProvider,
        options?: {
            transientOutputs: boolean;
            transientMetadata: { [K in keyof NotebookCellMetadata]?: boolean };
        }
    ): Disposable {
        return this.notebook.registerNotebookContentProvider(notebookType, provider, options);
    }
    public registerNotebookKernelProvider(
        selector: NotebookDocumentFilter,
        provider: NotebookKernelProvider
    ): Disposable {
        return this.notebook.registerNotebookKernelProvider(selector, provider);
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
                this.notebook.onDidChangeCellLanguage((e) =>
                    this._onDidChangeNotebookDocument.fire({ ...e, type: 'changeCellLanguage' })
                ),
                this.notebook.onDidChangeCellMetadata((e) =>
                    this._onDidChangeNotebookDocument.fire({ ...e, type: 'changeCellMetadata' })
                ),
                this.notebook.onDidChangeNotebookDocumentMetadata((e) =>
                    this._onDidChangeNotebookDocument.fire({ ...e, type: 'changeNotebookMetadata' })
                ),
                this.notebook.onDidChangeCellOutputs((e) =>
                    this._onDidChangeNotebookDocument.fire({ ...e, type: 'changeCellOutputs' })
                ),
                this.notebook.onDidChangeNotebookCells((e) => {
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
