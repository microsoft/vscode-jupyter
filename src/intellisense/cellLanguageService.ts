// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import type * as nbformat from '@jupyterlab/nbformat';
import { inject, injectable, named } from 'inversify';
import { Memento, NotebookCellKind, NotebookDocument } from 'vscode';
import { IExtensionSingleActivationService } from '../client/activation/types';
import { IJupyterKernelSpec } from '../client/api/extension';
import { IPythonExtensionChecker } from '../client/api/types';
import { IVSCodeNotebook } from '../client/common/application/types';
import { PYTHON_LANGUAGE } from '../client/common/constants';
import { traceWarning } from '../client/common/logger';
import { IDisposableRegistry, IMemento, GLOBAL_MEMENTO } from '../client/common/types';
import { swallowExceptions } from '../client/common/utils/decorators';
import { translateKernelLanguageToMonaco } from '../client/datascience/common';
import { LanguagesSupportedByPythonkernel, VSCodeKnownNotebookLanguages } from '../datascience-ui/common/constants';
import {
    isPythonKernelConnection,
    getKernelConnectionLanguage,
    getLanguageInNotebookMetadata
} from '../kernels/helpers';
import { KernelConnectionMetadata } from '../kernels/types';
import { isJupyterNotebook, getNotebookMetadata } from '../notebooks/helpers';

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
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento,
        @inject(IPythonExtensionChecker) private readonly pythonExtensionChecker: IPythonExtensionChecker
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
    public getSupportedLanguages(kernelConnection: KernelConnectionMetadata): string[] {
        if (isPythonKernelConnection(kernelConnection)) {
            return LanguagesSupportedByPythonkernel;
        } else {
            const language = translateKernelLanguageToMonaco(getKernelConnectionLanguage(kernelConnection) || '');
            // We should set `supportedLanguages` only if VS Code knows about them.
            // Assume user has a kernel for `go` & VS Code doesn't know about `go` language, & we initailize `supportedLanguages` to [go]
            // In such cases VS Code will not allow execution of this cell (because `supportedLanguages` by definition limits execution to languages defined).
            if (language && VSCodeKnownNotebookLanguages.includes(language)) {
                return [language];
            }
            // Support all languages
            return [];
        }
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
