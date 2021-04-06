// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import type { nbformat } from '@jupyterlab/coreutils/lib/nbformat';
import { inject, injectable, named } from 'inversify';
import { Memento, NotebookCellKind, NotebookDocument } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IPythonExtensionChecker } from '../../api/types';
import { IVSCodeNotebook } from '../../common/application/types';
import { PYTHON_LANGUAGE } from '../../common/constants';
import { traceWarning } from '../../common/logger';
import { GLOBAL_MEMENTO, IDisposableRegistry, IMemento } from '../../common/types';
import { swallowExceptions } from '../../common/utils/decorators';
import { translateKernelLanguageToMonaco } from '../common';
import { getLanguageInNotebookMetadata } from '../jupyter/kernels/helpers';
import { IJupyterKernelSpec } from '../types';
import { getNotebookMetadata, isJupyterNotebook } from './helpers/helpers';

export const LastSavedNotebookCellLanguage = 'DATASCIENCE.LAST_SAVED_CELL_LANGUAGE';
/**
 * Responsible for determining the default language of a cell for new notebooks.
 * It should not always be `Python`, not all data scientists or users of notebooks use Python.
 */
@injectable()
export class NotebookCellLanguageService implements IExtensionSingleActivationService {
    constructor(
        @inject(IVSCodeNotebook) private readonly vscNotebook: IVSCodeNotebook,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IPythonExtensionChecker) private readonly pythonExtensionChecker: IPythonExtensionChecker,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento
    ) {}
    /**
     * Gets the language to be used for the default cell in an empty notebook.
     * Give preference to `python` when we don't know what to use.
     */
    public getPreferredLanguage(metadata?: nbformat.INotebookMetadata) {
        const jupyterLanguage =
            metadata?.language_info?.name ||
            (metadata?.kernelspec as IJupyterKernelSpec | undefined)?.language ||
            this.lastSavedNotebookCellLanguage;

        // Default to python language only if the Python extension is installed.
        const defaultLanguage = this.pythonExtensionChecker.isPythonExtensionInstalled ? PYTHON_LANGUAGE : 'plaintext';
        // Note, what ever language is returned here, when the user selects a kernel, the cells (of blank documents) get updated based on that kernel selection.
        return translateKernelLanguageToMonaco(jupyterLanguage || defaultLanguage);
    }
    public async activate() {
        this.vscNotebook.onDidSaveNotebookDocument(this.onDidSaveNotebookDocument, this, this.disposables);
    }
    private get lastSavedNotebookCellLanguage(): string | undefined {
        return this.globalMemento.get<string | undefined>(LastSavedNotebookCellLanguage);
    }
    @swallowExceptions('Saving last saved cell language')
    private async onDidSaveNotebookDocument(doc: NotebookDocument) {
        if (!isJupyterNotebook(doc)) {
            return;
        }
        const language = this.getLanguageOfFirstCodeCell(doc);
        if (language && language !== this.lastSavedNotebookCellLanguage) {
            await this.globalMemento.update(LastSavedNotebookCellLanguage, language);
        }
    }
    private getLanguageOfFirstCodeCell(doc: NotebookDocument) {
        // If the document has been closed, accessing cell information can fail.
        // Ignore such exceptions.
        try {
            // Give preference to the language information in the metadata.
            const language = getLanguageInNotebookMetadata(getNotebookMetadata(doc));
            // Fall back to the language of the first code cell in the notebook.
            return language || doc.getCells().find((cell) => cell.kind === NotebookCellKind.Code)?.document.languageId;
        } catch (ex) {
            traceWarning('Failed to determine language of first cell', ex);
        }
    }
}
