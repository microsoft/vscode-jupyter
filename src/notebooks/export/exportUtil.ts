// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { NotebookCellData, NotebookData, NotebookDocument, Uri } from 'vscode';
import { IExtensions } from '../../platform/common/types';
import { ExportFormat, IExportDialog } from './types';

/**
 * Export utilities that are common to node/web
 */
@injectable()
export class ExportUtilBase {
    constructor(
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(IExportDialog) protected readonly filePicker: IExportDialog
    ) {}

    async getContent(document: NotebookDocument): Promise<string> {
        const serializerApi = this.extensions.getExtension<{ exportNotebook: (notebook: NotebookData) => string }>(
            'vscode.ipynb'
        );
        if (!serializerApi) {
            throw new Error(
                'Unable to export notebook as the built-in vscode.ipynb extension is currently unavailable.'
            );
        }
        // Via the interactive window export this might not be activated
        if (!serializerApi.isActive) {
            await serializerApi.activate();
        }

        const cells = document.getCells();
        const cellData = cells.map((c) => {
            const data = new NotebookCellData(c.kind, c.document.getText(), c.document.languageId);
            data.metadata = c.metadata;
            data.outputs = [...c.outputs];
            return data;
        });
        const notebookData = new NotebookData(cellData);
        notebookData.metadata = document.metadata;
        return serializerApi.exports.exportNotebook(notebookData);
    }

    async getTargetFile(
        format: ExportFormat,
        source: Uri,
        defaultFileName?: string | undefined
    ): Promise<Uri | undefined> {
        let target = await this.filePicker.showDialog(format, source, defaultFileName);

        return target;
    }
}
