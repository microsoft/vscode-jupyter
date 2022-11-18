// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import type * as nbformat from '@jupyterlab/nbformat';
import { inject, injectable, named } from 'inversify';
import { Memento, NotebookDocument } from 'vscode';
import { IExtensionSingleActivationService } from '../../platform/activation/types';
import { IPythonExtensionChecker } from '../../platform/api/types';
import { IVSCodeNotebook } from '../../platform/common/application/types';
import {
    LanguagesSupportedByPythonkernel,
    PYTHON_LANGUAGE,
    VSCodeKnownNotebookLanguages
} from '../../platform/common/constants';
import { IDisposableRegistry, IMemento, GLOBAL_MEMENTO } from '../../platform/common/types';
import { swallowExceptions } from '../../platform/common/utils/decorators';
import { getKernelConnectionLanguage, isPythonKernelConnection } from '../../kernels/helpers';
import { isJupyterNotebook, translateKernelLanguageToMonaco } from '../../platform/common/utils';
import { IJupyterKernelSpec, KernelConnectionMetadata } from '../../kernels/types';
import { getLanguageOfNotebookDocument } from './helpers';

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
            if (language && VSCodeKnownNotebookLanguages.includes(language.toLowerCase())) {
                return [language, 'raw'];
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
        const language = getLanguageOfNotebookDocument(doc);
        if (language && language !== this.lastSavedNotebookCellLanguage) {
            await this.globalMemento.update(LastSavedNotebookCellLanguage, language);
        }
    }
}
