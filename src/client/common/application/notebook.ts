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
    NotebookKernel,
    NotebookKernelProvider,
    window as notebookWindow
} from '../../../../types/vscode-proposed';
import { UseProposedApi } from '../constants';
import { IDisposableRegistry } from '../types';
import { IApplicationEnvironment, IVSCodeNotebook, NotebookCellChangedEvent } from './types';

@injectable()
export class VSCodeNotebook implements IVSCodeNotebook {
    public get onDidChangeActiveNotebookKernel(): Event<{
        document: NotebookDocument;
        kernel: NotebookKernel | undefined;
    }> {
        return this.canUseNotebookApi
            ? this.notebook.onDidChangeActiveNotebookKernel
            : new EventEmitter<{
                  document: NotebookDocument;
                  kernel: NotebookKernel | undefined;
              }>().event;
    }
    public get onDidChangeActiveNotebookEditor(): Event<NotebookEditor | undefined> {
        return this.canUseNotebookApi
            ? this.window.onDidChangeActiveNotebookEditor
            : new EventEmitter<NotebookEditor | undefined>().event;
    }
    public get onDidOpenNotebookDocument(): Event<NotebookDocument> {
        return this.canUseNotebookApi
            ? this.notebook.onDidOpenNotebookDocument
            : new EventEmitter<NotebookDocument>().event;
    }
    public get onDidCloseNotebookDocument(): Event<NotebookDocument> {
        return this.canUseNotebookApi
            ? this.notebook.onDidCloseNotebookDocument
            : new EventEmitter<NotebookDocument>().event;
    }
    public get onDidSaveNotebookDocument(): Event<NotebookDocument> {
        return this.canUseNotebookApi
            ? this.notebook.onDidSaveNotebookDocument
            : new EventEmitter<NotebookDocument>().event;
    }
    public get notebookDocuments(): ReadonlyArray<NotebookDocument> {
        return this.canUseNotebookApi ? this.notebook.notebookDocuments : [];
    }
    public get notebookEditors() {
        return this.canUseNotebookApi ? this.window.visibleNotebookEditors : [];
    }
    public get onDidChangeNotebookDocument(): Event<NotebookCellChangedEvent> {
        return this.canUseNotebookApi
            ? this._onDidChangeNotebookDocument.event
            : new EventEmitter<NotebookCellChangedEvent>().event;
    }
    public get activeNotebookEditor(): NotebookEditor | undefined {
        if (!this.useProposedApi) {
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
        @inject(UseProposedApi) private readonly useProposedApi: boolean,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IApplicationEnvironment) readonly env: IApplicationEnvironment
    ) {
        if (this.useProposedApi && this.env.channel === 'insiders') {
            this.addEventHandlers();
            this.canUseNotebookApi = true;
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
