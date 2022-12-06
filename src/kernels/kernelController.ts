// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { NotebookCell, NotebookCellExecution, NotebookController } from 'vscode';
import { IKernelController } from './types';

export class KernelController implements IKernelController {
    constructor(private readonly controller: NotebookController) {}
    public get id() {
        return this.controller.id;
    }
    createNotebookCellExecution(cell: NotebookCell): NotebookCellExecution {
        return this.controller.createNotebookCellExecution(cell);
    }
}
