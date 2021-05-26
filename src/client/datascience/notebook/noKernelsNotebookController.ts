// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Disposable, NotebookCell, NotebookController, NotebookControllerAffinity, NotebookDocument } from 'vscode';
import { IS_CI_SERVER } from '../../../test/ciConstants';
import { ICommandManager, IVSCodeNotebook } from '../../common/application/types';
import { JVSC_EXTENSION_ID, PYTHON_LANGUAGE } from '../../common/constants';
import { disposeAllDisposables } from '../../common/helpers';
import { IDisposable, IDisposableRegistry } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { getKernelNotInstalledErrorMessage } from '../errorHandler/errorHandler';
import { getLanguageInNotebookMetadata } from '../jupyter/kernels/helpers';
import { KernelSpecNotFoundError } from '../raw-kernel/liveshare/kernelSpecNotFoundError';
import { IDataScienceErrorHandler } from '../types';
import { JupyterNotebookView } from './constants';
import { getNotebookMetadata, translateErrorOutput } from './helpers/helpers';

export class NoKernelsNotebookController implements Disposable {
    private readonly disposables: IDisposable[] = [];
    private readonly controller: NotebookController;
    constructor(
        private readonly notebookApi: IVSCodeNotebook,
        private readonly commandManager: ICommandManager,
        disposableRegistry: IDisposableRegistry,
        private readonly errorHandler: IDataScienceErrorHandler
    ) {
        disposableRegistry.push(this);
        this.controller = this.notebookApi.createNotebookController(
            'NoKernels',
            JupyterNotebookView,
            'No Kernels',
            this.handleExecution.bind(this)
        );
        this.disposables.push(this.controller);
        this.controller.description = '';
        this.controller.detail = '';
    }

    public dispose() {
        disposeAllDisposables(this.disposables);
    }

    public async updateNotebookAffinity(notebook: NotebookDocument, affinity: NotebookControllerAffinity) {
        this.controller.updateNotebookAffinity(notebook, affinity);
        // Only on CI Server.
        if (IS_CI_SERVER) {
            await this.commandManager.executeCommand('notebook.selectKernel', {
                id: this.controller.id,
                extension: JVSC_EXTENSION_ID
            });
        }
        this.updateLabels(notebook);
    }
    private updateLabels(document: NotebookDocument) {
        const metadata = getNotebookMetadata(document);
        this.controller.label =
            metadata?.kernelspec?.display_name ||
            metadata?.kernelspec?.name ||
            getLanguageInNotebookMetadata(metadata) ||
            PYTHON_LANGUAGE;
    }
    /**
     * Display error message in the output.
     */
    private async handleExecution(cells: NotebookCell[]) {
        if (cells.length === 0) {
            return;
        }
        const cell = cells[0];
        const notebook = cell.notebook;
        const task = this.controller.createNotebookCellExecutionTask(cell);
        task.start();
        task.clearOutput(cell.index).then(noop, noop);
        const errorMessage = getKernelNotInstalledErrorMessage(getNotebookMetadata(notebook));
        const errorOutput = translateErrorOutput({
            ename: '',
            evalue: '',
            output_type: 'error',
            traceback: errorMessage.split('\n')
        });
        task.appendOutput(errorOutput).then(noop, noop);
        task.end();
        this.errorHandler.handleError(new KernelSpecNotFoundError(getNotebookMetadata(notebook))).catch(noop);
    }
}
