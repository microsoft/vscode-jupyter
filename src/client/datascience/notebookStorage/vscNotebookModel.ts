// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import type { nbformat } from '@jupyterlab/coreutils';
import { Memento, NotebookDocument, Uri } from 'vscode';
import { IVSCodeNotebook } from '../../common/application/types';
import { ICryptoUtils } from '../../common/types';
import { NotebookModelChange } from '../interactive-common/interactiveWindowTypes';
import {
    cellRunStateToCellState,
    createJupyterCellFromVSCNotebookCell,
    getNotebookMetadata,
    notebookModelToVSCNotebookData
} from '../notebook/helpers/helpers';
import { chainWithPendingUpdates } from '../notebook/helpers/notebookUpdater';
import { BaseNotebookModel, getDefaultNotebookContentForNativeNotebooks } from './baseModel';

// https://github.com/microsoft/vscode-python/issues/13155
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sortObjectPropertiesRecursively(obj: any): any {
    if (Array.isArray(obj)) {
        return obj.map(sortObjectPropertiesRecursively);
    }
    if (obj !== undefined && obj !== null && typeof obj === 'object' && Object.keys(obj).length > 0) {
        return (
            Object.keys(obj)
                .sort()
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .reduce<Record<string, any>>((sortedObj, prop) => {
                    sortedObj[prop] = sortObjectPropertiesRecursively(obj[prop]);
                    return sortedObj;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                }, {}) as any
        );
    }
    return obj;
}

// Exported for test mocks
export class VSCodeNotebookModel extends BaseNotebookModel {
    public get isDirty(): boolean {
        return this.document?.isDirty === true;
    }
    public get isDisposed() {
        // Possible the document has been closed/disposed
        if (
            this.document &&
            this.vscodeNotebook &&
            !this.vscodeNotebook?.notebookDocuments.find((doc) => doc === this.document)
        ) {
            return true;
        }
        return this._isDisposed === true;
    }
    public get notebookContentWithoutCells(): Exclude<Partial<nbformat.INotebookContent>, 'cells'> {
        return {
            ...this.notebookJson,
            cells: []
        };
    }
    public get isUntitled(): boolean {
        return this.document ? this.document.isUntitled : super.isUntitled;
    }
    private document?: NotebookDocument;

    constructor(
        isTrusted: boolean,
        file: Uri,
        globalMemento: Memento,
        crypto: ICryptoUtils,
        private readonly originalJson: Partial<nbformat.INotebookContent> = {},
        indentAmount: string = ' ',
        pythonNumber: number = 3,
        private readonly vscodeNotebook: IVSCodeNotebook,
        private readonly preferredLanguage: string
    ) {
        super(isTrusted, file, globalMemento, crypto, originalJson, indentAmount, pythonNumber, false);
        // Do not change this code without changing code in base class.
        // We cannot invoke this in base class as `cellLanguageService` is not available in base class.
        this.ensureNotebookJson();
    }
    public getCellCount() {
        return this.document ? this.document.cells.length : this.notebookJson.cells?.length ?? 0;
    }
    public getNotebookData() {
        if (!this.preferredLanguage) {
            throw new Error('Preferred Language not initialized');
        }
        return notebookModelToVSCNotebookData(
            this.isTrusted,
            this.notebookContentWithoutCells,
            this.file,
            this.notebookJson.cells || [],
            this.preferredLanguage,
            this.originalJson
        );
    }
    public getCellsWithId() {
        if (!this.document) {
            return [];
        }
        return this.document.cells.map((cell) => {
            return {
                id: cell.document.uri.toString(),
                data: createJupyterCellFromVSCNotebookCell(cell),
                state: cellRunStateToCellState(cell.metadata.runState)
            };
        });
    }
    /**
     * Unfortunately Notebook models are created early, well before a VSC Notebook Document is created.
     * We can associate an INotebookModel with a VSC Notebook, only after the Notebook has been opened.
     */
    public associateNotebookDocument(document: NotebookDocument) {
        this.document = document;
    }
    public async trustNotebook() {
        this.trust();
        const editor = this.vscodeNotebook?.notebookEditors.find((item) => item.document === this.document);
        const document = editor?.document;
        if (editor && document && !document.metadata.trusted) {
            await chainWithPendingUpdates(editor.document, (edit) => {
                edit.replaceNotebookMetadata(
                    document.uri,
                    document.metadata.with({
                        cellEditable: true,
                        editable: true,
                        trusted: true
                    })
                );
            });
        }
    }
    public getOriginalContentOnDisc(): string {
        return JSON.stringify(this.notebookJson, null, this.indentAmount);
    }
    protected getJupyterCells() {
        return this.document
            ? this.document.cells.map(createJupyterCellFromVSCNotebookCell.bind(undefined))
            : this.notebookJson.cells || [];
    }
    protected getDefaultNotebookContent() {
        return getDefaultNotebookContentForNativeNotebooks(this.preferredLanguage);
    }
    protected generateNotebookJson() {
        const json = super.generateNotebookJson();
        if (this.document) {
            // The metadata will be in the notebook document.
            const metadata = getNotebookMetadata(this.document);
            if (metadata) {
                json.metadata = metadata;
            }
        }

        // https://github.com/microsoft/vscode-python/issues/13155
        // Object keys in metadata, cells and the like need to be sorted alphabetically.
        // Jupyter (Python) seems to sort them alphabetically.
        // We should do the same to minimize changes to content when saving ipynb.
        return sortObjectPropertiesRecursively(json);
    }

    protected handleRedo(change: NotebookModelChange): boolean {
        super.handleRedo(change);
        return true;
    }
}
