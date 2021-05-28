// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { nbformat } from '@jupyterlab/coreutils/lib/nbformat';
import { inject, injectable } from 'inversify';
import { Memento, Uri } from 'vscode';
import { IVSCodeNotebook, IWorkspaceService } from '../../common/application/types';
import { UseVSCodeNotebookEditorApi } from '../../common/constants';
import { ICryptoUtils } from '../../common/types';
import { NotebookCellLanguageService } from '../notebook/cellLanguageService';
import { ICell, INotebookModel } from '../types';
import { NativeEditorNotebookModel } from './notebookModel';
import { INotebookModelFactory } from './types';
import { VSCodeNotebookModel } from './vscNotebookModel';

@injectable()
export class NotebookModelFactory implements INotebookModelFactory {
    constructor(
        @inject(UseVSCodeNotebookEditorApi) private readonly useVSCodeNotebookEditorApi: boolean,
        @inject(IVSCodeNotebook) private vsCodeNotebook: IVSCodeNotebook,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(NotebookCellLanguageService) private readonly cellLanguageService: NotebookCellLanguageService
    ) {}
    public createModel(
        options: {
            file: Uri;
            cells: ICell[];
            notebookJson?: Partial<nbformat.INotebookContent>;
            defaultCellLanguage?: string;
            globalMemento: Memento;
            crypto: ICryptoUtils;
            indentAmount?: string;
            pythonNumber?: number;
            initiallyDirty?: boolean;
        },
        forVSCodeNotebook?: boolean
    ): INotebookModel {
        if (forVSCodeNotebook || this.useVSCodeNotebookEditorApi) {
            return new VSCodeNotebookModel(
                options.file,
                options.globalMemento,
                options.crypto,
                options.notebookJson,
                options.indentAmount,
                options.pythonNumber,
                this.vsCodeNotebook,
                options.defaultCellLanguage ||
                    this.cellLanguageService.getPreferredLanguage(options.notebookJson?.metadata)
            );
        }
        return new NativeEditorNotebookModel(
            this.workspace.isTrusted,
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
