// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Disposable, NotebookCell, NotebookController, NotebookDocument, NotebookSelector } from 'vscode';
import { IVSCodeNotebook } from '../../common/application/types';
import { traceInfo } from '../../common/logger';
import { getDescriptionOfKernelConnection, getDisplayNameOrNameOfKernelConnection } from '../jupyter/kernels/helpers';
import { KernelConnectionMetadata } from '../jupyter/kernels/types';
import { JupyterNotebookView } from './constants';

// IANHU: Rename file, rename class?
export class VSCodeNotebookController implements Disposable {
    private controller: NotebookController;
    private isDisposed = false;

    // IANHU: Passing the API in here? Not sure if that is right, but I like this class owning the create
    constructor(document: NotebookDocument, kernelConnection: KernelConnectionMetadata, notebookApi: IVSCodeNotebook) {
        const selector: NotebookSelector = { viewType: JupyterNotebookView, pattern: document.uri.fsPath };
        const id: string = `${document.uri.toString()} - ${kernelConnection.id}`;
        // IANHU: Preloads go here as well
        this.controller = notebookApi.createNotebookController(id, selector, getDisplayNameOrNameOfKernelConnection(kernelConnection), this.handleExecution.bind(this));
        this.controller.description = getDescriptionOfKernelConnection(kernelConnection);
        this.controller.hasExecutionOrder = true;
        this.controller.supportedLanguages = ['python'];
    }

    public dispose() {
        // IANHU: Need to make sure to check our disposes here
        if (!this.isDisposed) {
            this.isDisposed = true;
            this.controller.dispose();
        }
    }

    private handleExecution(cells: NotebookCell[]) {
        traceInfo('executing cell');
    }
}