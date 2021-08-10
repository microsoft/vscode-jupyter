// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { nbformat } from '@jupyterlab/coreutils/lib/nbformat';
import { Memento, Uri } from 'vscode';
import { KernelConnectionMetadata } from '../jupyter/kernels/types';
import { ICell } from '../types';
import { BaseNotebookModel } from './baseModel';

export class NativeEditorNotebookModel extends BaseNotebookModel {
    public get isDirty(): boolean {
        return this.changeCount !== this.saveChangeCount;
    }
    public get cells(): ICell[] {
        return this._cells;
    }
    public get kernelConnection(): KernelConnectionMetadata | undefined {
        return this._kernelConnection;
    }
    private saveChangeCount: number = 0;
    private changeCount: number = 0;
    constructor(
        file: Uri,
        private _cells: ICell[],
        globalMemento: Memento,
        json: Partial<nbformat.INotebookContent> = {},
        indentAmount: string = ' ',
        pythonNumber: number = 3,
        isInitiallyDirty: boolean = false
    ) {
        super(file, globalMemento, json, indentAmount, pythonNumber);
        if (isInitiallyDirty) {
            // This means we're dirty. Indicate dirty and load from this content
            this.saveChangeCount = -1;
        }
    }
}
