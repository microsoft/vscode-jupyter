// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
import detectIndent = require('detect-indent');
import type { nbformat } from '@jupyterlab/coreutils';
import { inject, injectable } from 'inversify';
import { CancellationToken, NotebookSerializer as VSCNotebookSerializer, NotebookData, NotebookDocument } from 'vscode';
import { createJupyterCellFromVSCNotebookCell, notebookModelToVSCNotebookData } from './helpers/helpers';
import { NotebookCellLanguageService } from './cellLanguageService';
import { pruneCell } from '../common';
import { traceInfoIf } from '../../common/logger';
import { defaultNotebookFormat } from '../constants';
import { isCI } from '../../common/constants';

/**
 * This class is responsible for reading a notebook file (ipynb or other files) and returning VS Code with the NotebookData.
 * Its up to extension authors to read the files and return it in a format that VSCode understands.
 * Same with the cells and cell output.
 */
@injectable()
export class NotebookSerializer implements VSCNotebookSerializer {
    constructor(
        @inject(NotebookCellLanguageService) private readonly cellLanguageService: NotebookCellLanguageService
    ) {}
    public deserializeNotebook(content: Uint8Array, _token: CancellationToken): NotebookData {
        const contents = Buffer.from(content).toString();
        const json = contents ? (JSON.parse(contents) as Partial<nbformat.INotebookContent>) : {};
        traceInfoIf(isCI, `NotebookJSON ${JSON.stringify(json)}`);

        // Then compute indent. It's computed from the contents
        const indentAmount = contents ? detectIndent(contents).indent : ' ';
        const preferredCellLanguage = this.cellLanguageService.getPreferredLanguage(json?.metadata);
        traceInfoIf(isCI, `Preferred language in deserializer ${preferredCellLanguage}`);
        // Ensure we always have a blank cell.
        if ((json?.cells || []).length === 0) {
            json.cells = [
                {
                    cell_type: 'code',
                    execution_count: null,
                    metadata: {},
                    outputs: [],
                    source: ''
                }
            ];
        }
        // For notebooks without metadata default the language in metadata to the preferred language.
        if (!json.metadata || (!json.metadata.kernelspec && !json.metadata.language_info)) {
            json.metadata = json?.metadata || { orig_nbformat: defaultNotebookFormat.major };
            json.metadata.language_info = json.metadata.language_info || { name: preferredCellLanguage };
        }
        const data = notebookModelToVSCNotebookData(
            { ...json, cells: [] },
            json?.cells || [],
            preferredCellLanguage,
            json || {}
        );
        data.metadata = data.metadata || {};
        data.metadata.indentAmount = indentAmount;

        return data;
    }
    public serializeNotebookDocument(data: NotebookDocument): string {
        return this.serialize(data);
    }
    public serializeNotebook(data: NotebookData, _token: CancellationToken): Uint8Array {
        return Buffer.from(this.serialize(data), 'utf-8');
    }
    private serialize(data: NotebookDocument | NotebookData): string {
        const notebookContent: Partial<nbformat.INotebookContent> =
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            JSON.parse(JSON.stringify(data.metadata?.custom as any)) || {};
        notebookContent.cells = notebookContent.cells || [];
        notebookContent.nbformat = notebookContent.nbformat || 4;
        notebookContent.nbformat_minor = notebookContent.nbformat_minor || 2;
        notebookContent.metadata = notebookContent.metadata || { orig_nbformat: 4 };

        // Override with what ever is in the metadata.
        const indentAmount =
            data.metadata && 'indentAmount' in data.metadata && typeof data.metadata.indentAmount === 'string'
                ? data.metadata.indentAmount
                : ' ';

        if ('notebookType' in data) {
            notebookContent.cells = data
                .getCells()
                .map((cell) => createJupyterCellFromVSCNotebookCell(cell))
                .map(pruneCell);
        } else {
            notebookContent.cells = data.cells.map((cell) => createJupyterCellFromVSCNotebookCell(cell)).map(pruneCell);
        }

        return JSON.stringify(notebookContent, undefined, indentAmount);
    }
}
