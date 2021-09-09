// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import {
    Event,
    EventEmitter,
    NotebookCellKind,
    NotebookRange,
    NotebookDocument,
    Uri,
    NotebookCellData,
    NotebookData
} from 'vscode';
import { ICommandManager, IVSCodeNotebook } from '../../common/application/types';
import { IDisposableRegistry, IExtensions } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { INotebook, INotebookEditor } from '../types';
import { NotebookCellLanguageService } from './cellLanguageService';
import { chainWithPendingUpdates } from './helpers/notebookUpdater';
import { getNotebookMetadata } from './helpers/helpers';

export class NotebookEditor implements INotebookEditor {
    public get closed(): Event<INotebookEditor> {
        return this._closed.event;
    }
    public get file(): Uri {
        return this.document.uri;
    }
    public notebook?: INotebook | undefined;

    private _closed = new EventEmitter<INotebookEditor>();
    constructor(
        public readonly document: NotebookDocument,
        private readonly vscodeNotebook: IVSCodeNotebook,
        private readonly commandManager: ICommandManager,
        disposables: IDisposableRegistry,
        private readonly cellLanguageService: NotebookCellLanguageService,
        private extensions: IExtensions
    ) {
        vscodeNotebook.onDidCloseNotebookDocument(this.onClosedDocument, this, disposables);
    }
    public getContent(): string {
        const serializerApi = this.extensions.getExtension<{ exportNotebook: (notebook: NotebookData) => string }>(
            'vscode.ipynb'
        );
        if (!serializerApi) {
            throw new Error(
                'Unable to export notebook as the built-in vscode.ipynb extension is currently unavailable.'
            );
        }
        const cells = this.document.getCells();
        const cellData = cells.map((c) => {
            const data = new NotebookCellData(c.kind, c.document.getText(), c.document.languageId);
            data.metadata = c.metadata;
            data.mime = c.mime;
            data.outputs = [...c.outputs];
            return data;
        });
        const notebookData = new NotebookData(cellData);
        notebookData.metadata = this.document.metadata;
        return serializerApi.exports.exportNotebook(notebookData);
    }
    public runAllCells(): void {
        this.commandManager.executeCommand('notebook.execute').then(noop, noop);
    }
    public addCellBelow(): void {
        this.commandManager.executeCommand('notebook.cell.insertCodeCellBelow').then(noop, noop);
    }
    public hasCell(): Promise<boolean> {
        return Promise.resolve(this.document.cellCount > 0);
    }
    public undoCells(): void {
        this.commandManager.executeCommand('notebook.undo').then(noop, noop);
    }
    public redoCells(): void {
        this.commandManager.executeCommand('notebook.redo').then(noop, noop);
    }
    public removeAllCells(): void {
        if (!this.vscodeNotebook.activeNotebookEditor) {
            return;
        }
        const defaultLanguage = this.cellLanguageService.getPreferredLanguage(getNotebookMetadata(this.document));
        const editor = this.vscodeNotebook.notebookEditors.find((item) => item.document === this.document);
        if (editor) {
            chainWithPendingUpdates(editor.document, (edit) =>
                edit.replaceNotebookCells(editor.document.uri, new NotebookRange(0, this.document.cellCount), [
                    new NotebookCellData(NotebookCellKind.Code, '', defaultLanguage)
                ])
            ).then(noop, noop);
        }
    }
    public expandAllCells(): void {
        if (!this.vscodeNotebook.activeNotebookEditor) {
            return;
        }
        const notebook = this.vscodeNotebook.activeNotebookEditor.document;
        const editor = this.vscodeNotebook.notebookEditors.find((item) => item.document === this.document);
        if (editor) {
            chainWithPendingUpdates(editor.document, (edit) => {
                notebook.getCells().forEach((cell, index) => {
                    const metadata = { ...(cell.metadata || {}), inputCollapsed: false, outputCollapsed: false };
                    edit.replaceNotebookCellMetadata(editor.document.uri, index, metadata);
                });
            }).then(noop, noop);
        }
    }
    public collapseAllCells(): void {
        if (!this.vscodeNotebook.activeNotebookEditor) {
            return;
        }
        const notebook = this.vscodeNotebook.activeNotebookEditor.document;
        const editor = this.vscodeNotebook.notebookEditors.find((item) => item.document === this.document);
        if (editor) {
            chainWithPendingUpdates(editor.document, (edit) => {
                notebook.getCells().forEach((cell, index) => {
                    const metadata = { ...(cell.metadata || {}), inputCollapsed: true, outputCollapsed: true };
                    edit.replaceNotebookCellMetadata(editor.document.uri, index, metadata);
                });
            }).then(noop, noop);
        }
    }

    public dispose() {
        this._closed.fire(this);
    }

    private onClosedDocument(e?: NotebookDocument) {
        if (this.document === e) {
            this._closed.fire(this);
        }
    }
}
