// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { nbformat } from '@jupyterlab/coreutils/lib/nbformat';
import { inject, injectable } from 'inversify';
import { Memento, Uri } from 'vscode';
import { IWorkspaceService } from '../../common/application/types';
import { ICryptoUtils } from '../../common/types';
import { ICell, INotebookModel } from '../types';
import { NativeEditorNotebookModel } from './notebookModel';
import { INotebookModelFactory } from './types';

@injectable()
export class NotebookModelFactory implements INotebookModelFactory {
    constructor(@inject(IWorkspaceService) private readonly workspace: IWorkspaceService) {}
    public createModel(options: {
        trusted: boolean;
        file: Uri;
        cells: ICell[];
        notebookJson?: Partial<nbformat.INotebookContent>;
        defaultCellLanguage?: string;
        globalMemento: Memento;
        crypto: ICryptoUtils;
        indentAmount?: string;
        pythonNumber?: number;
        initiallyDirty?: boolean;
    }): INotebookModel {
        return new NativeEditorNotebookModel(
            () => this.workspace.isTrusted,
            options.file,
            options.cells,
            options.globalMemento,
            options.crypto,
            options.notebookJson,
            options.indentAmount,
            options.pythonNumber,
            options.initiallyDirty
        );
    }
}
