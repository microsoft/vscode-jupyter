// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { NotebookDocument, NotebookKernel as VSCNotebookKernel } from '../../../../types/vscode-proposed';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IVSCodeNotebook } from '../../common/application/types';
import { PYTHON_LANGUAGE } from '../../common/constants';
import { traceError } from '../../common/logger';
import { IDisposableRegistry } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { translateKernelLanguageToMonaco } from '../common';
import { isJupyterKernel, isJupyterNotebook } from './helpers/helpers';
import { chainWithPendingUpdates } from './helpers/notebookUpdater';
// tslint:disable-next-line: no-var-requires no-require-imports
const vscodeNotebookEnums = require('vscode') as typeof import('vscode-proposed');

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
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {}
    public async activate(): Promise<void> {
        this.notebook.onDidChangeActiveNotebookKernel(this.onDidChangeActiveNotebookKernel, this, this.disposables);
    }
    private async onDidChangeActiveNotebookKernel({
        document,
        kernel
    }: {
        document: NotebookDocument;
        kernel: VSCNotebookKernel | undefined;
    }) {
        // We're only interested in our Jupyter Notebooks & our kernels.
        if (!isJupyterKernel(kernel) || !isJupyterNotebook(document)) {
            return;
        }
        // If connecting to a default kernel of Jupyter server, then we don't know the language of the kernel.
        if (kernel.selection.kind === 'startUsingDefaultKernel') {
            return;
        }
        const editor = this.notebook.notebookEditors.find((item) => item.document === document);
        if (!editor) {
            return;
        }
        // If we have just empty cells, then update the code cells to use the same language as that of the kernel.
        const emptyCodeCells = document.cells.filter(
            (cell) => cell.cellKind === vscodeNotebookEnums.CellKind.Code && cell.document.getText().trim().length === 0
        );
        const codeCells = document.cells.filter((cell) => cell.cellKind === vscodeNotebookEnums.CellKind.Code).length;
        // Change language of the cells only if all code cells are empty.
        if (emptyCodeCells.length === 0 || emptyCodeCells.length !== codeCells) {
            return;
        }

        let language: string | undefined;
        const kernelKind = kernel.selection.kind;
        switch (kernel.selection.kind) {
            case 'connectToLiveKernel': {
                language = kernel.selection.kernelModel.language;
                break;
            }
            case 'startUsingKernelSpec': {
                language = kernel.selection.kernelSpec.language;
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
        chainWithPendingUpdates(editor, (edit) => {
            emptyCodeCells.forEach((cell) => {
                if (monacoLanguage.toLowerCase() === cell.language) {
                    return;
                }
                edit.replaceCells(cell.index, 1, [
                    {
                        cellKind: cell.cellKind,
                        language: monacoLanguage,
                        metadata: cell.metadata,
                        outputs: cell.outputs,
                        source: cell.document.getText()
                    }
                ]);
            });
        }).then(noop, noop);
    }
}
