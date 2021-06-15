// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { languages, NotebookCellKind, NotebookDocument } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IVSCodeNotebook } from '../../common/application/types';
import { PYTHON_LANGUAGE } from '../../common/constants';
import { traceError } from '../../common/logger';
import { IDisposableRegistry } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { translateKernelLanguageToMonaco } from '../common';
import { isJupyterNotebook } from './helpers/helpers';
import { chainWithPendingUpdates } from './helpers/notebookUpdater';
import { VSCodeNotebookController } from './vscodeNotebookController';
import { INotebookControllerManager } from './types';
/**
 * If user creates a blank notebook, then they'll mostl likely end up with a blank cell with language, lets assume `Python`.
 * Now if the user changes the kernel to say `Julia`. After this, they need to also change the language of the cell.
 * That two steps & few clicks.
 * This class will ensure empty code cells will have the same language as that of the selected kernel.
 * This logic is applied only when all code cells in the notebook are empty.
 */
@injectable()
export class EmptyNotebookCellLanguageService implements IExtensionSingleActivationService {
    constructor(
        @inject(IVSCodeNotebook) private readonly notebook: IVSCodeNotebook,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(INotebookControllerManager) private readonly notebookControllerManager: INotebookControllerManager
    ) {}
    public async activate(): Promise<void> {
        this.notebookControllerManager.onNotebookControllerSelected(
            this.onDidChangeNotebookController,
            this,
            this.disposables
        );
    }

    private async onDidChangeNotebookController(event: {
        notebook: NotebookDocument;
        controller: VSCodeNotebookController;
    }) {
        const document = event.notebook;
        const connection = event.controller.connection;
        // We're only interested in our Jupyter Notebooks & our kernels.
        if (!isJupyterNotebook(document)) {
            return;
        }
        // If connecting to a default kernel of Jupyter server, then we don't know the language of the kernel.
        if (connection.kind === 'startUsingDefaultKernel') {
            return;
        }
        const editor = this.notebook.notebookEditors.find((item) => item.document === document);
        if (!editor) {
            return;
        }
        // If we have just empty cells, then update the code cells to use the same language as that of the kernel.
        const emptyCodeCells = document
            .getCells()
            .filter((cell) => cell.kind === NotebookCellKind.Code && cell.document.getText().trim().length === 0);
        const codeCells = document.getCells().filter((cell) => cell.kind === NotebookCellKind.Code).length;
        // Change language of the cells only if all code cells are empty.
        if (emptyCodeCells.length === 0 || emptyCodeCells.length !== codeCells) {
            return;
        }

        let language: string | undefined;
        const kernelKind = connection.kind;
        switch (connection.kind) {
            case 'connectToLiveKernel': {
                language = connection.kernelModel.language;
                break;
            }
            case 'startUsingKernelSpec': {
                language = connection.kernelSpec.language;
                break;
            }
            case 'startUsingPythonInterpreter': {
                language = PYTHON_LANGUAGE;
                break;
            }
            default: {
                traceError(`Unsupported kernel kind encountered ${kernelKind}`);
                return;
            }
        }
        if (!language) {
            return;
        }

        const monacoLanguage = translateKernelLanguageToMonaco(language);
        chainWithPendingUpdates(editor.document, async () => {
            await emptyCodeCells.map(async (cell) => {
                if (monacoLanguage.toLowerCase() === cell.document.languageId) {
                    return;
                }
                return languages.setTextDocumentLanguage(cell.document, monacoLanguage).then(noop, noop);
            });
        }).then(noop, noop);
    }
}
