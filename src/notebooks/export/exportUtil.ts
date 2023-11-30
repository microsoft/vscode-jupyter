// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { NotebookCellData, NotebookData, NotebookDocument, Uri, extensions } from 'vscode';
import { ExportFormat } from './types';
import { ExportDialog } from './exportDialog';

/**
 * Export utilities that are common to node/web
 */
@injectable()
export class ExportUtilBase {
    async getContent(document: NotebookDocument): Promise<string> {
        const serializerApi = extensions.getExtension<{ exportNotebook: (notebook: NotebookData) => string }>(
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
            data.mime = c.mime;
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
        let target = await new ExportDialog().showDialog(format, source, defaultFileName);

        return target;
    }
}
