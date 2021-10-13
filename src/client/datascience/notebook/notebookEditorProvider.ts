// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { Uri, NotebookData, NotebookCellData, NotebookCellKind } from 'vscode';
import { IVSCodeNotebook } from '../../common/application/types';
import '../../common/extensions';

import { captureTelemetry } from '../../telemetry';
import { defaultNotebookFormat, Telemetry } from '../constants';
import { INotebookEditorProvider } from '../types';
import { JupyterNotebookView } from './constants';
import { PYTHON_LANGUAGE } from '../../common/constants';

/**
 * Notebook Editor provider used by other parts of DS code.
 * This is an adapter, that takes the VSCode api for editors (did notebook editors open, close save, etc) and
 * then exposes them in a manner we expect - i.e. INotebookEditorProvider.
 * This is also responsible for tracking all notebooks that open and then keeping the VS Code notebook models updated with changes we made to our underlying model.
 * E.g. when cells are executed the results in our model is updated, this tracks those changes and syncs VSC cells with those updates.
 */
@injectable()
export class NotebookEditorProvider implements INotebookEditorProvider {
    constructor(@inject(IVSCodeNotebook) private readonly vscodeNotebook: IVSCodeNotebook) {}
    public async open(file: Uri): Promise<void> {
        const nb = await this.vscodeNotebook.openNotebookDocument(file);
        await this.vscodeNotebook.showNotebookDocument(nb);
    }
    @captureTelemetry(Telemetry.CreateNewNotebook, undefined, false)
    public async createNew(options?: { contents?: string; defaultCellLanguage: string }): Promise<void> {
        // contents will be ignored
        const language = options?.defaultCellLanguage ?? PYTHON_LANGUAGE;
        const cell = new NotebookCellData(NotebookCellKind.Code, '', language);
        const data = new NotebookData([cell]);
        data.metadata = {
            custom: {
                cells: [],
                metadata: {
                    orig_nbformat: defaultNotebookFormat.major
                },
                nbformat: defaultNotebookFormat.major,
                nbformat_minor: defaultNotebookFormat.minor
            }
        };
        const doc = await this.vscodeNotebook.openNotebookDocument(JupyterNotebookView, data);
        await this.vscodeNotebook.showNotebookDocument(doc);
    }
}
