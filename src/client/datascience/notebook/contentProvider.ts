// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
import detectIndent = require('detect-indent');
import * as uuid from 'uuid/v4';
import type { nbformat } from '@jupyterlab/coreutils';
import { inject, injectable } from 'inversify';
import { CancellationToken, NotebookSerializer as VSCNotebookSerializer, NotebookData } from 'vscode';
import { IVSCodeNotebook } from '../../common/application/types';
import { sendLanguageTelemetry } from '../notebookStorage/nativeEditorStorage';
import { createJupyterCellFromVSCNotebookCell, notebookModelToVSCNotebookData } from './helpers/helpers';
import { NotebookCellLanguageService } from './cellLanguageService';
import { pruneCell } from '../common';

/**
 * This class is responsible for reading a notebook file (ipynb or other files) and returning VS Code with the NotebookData.
 * Its up to extension authors to read the files and return it in a format that VSCode understands.
 * Same with the cells and cell output.
 */
@injectable()
export class NotebookSerializer implements VSCNotebookSerializer {
    constructor(
        @inject(IVSCodeNotebook) readonly notebookProvider: IVSCodeNotebook,
        @inject(NotebookCellLanguageService) private readonly cellLanguageService: NotebookCellLanguageService
    ) {}
    public async deserializeNotebook(content: Uint8Array, _token: CancellationToken): Promise<NotebookData> {
        const contents = content.length > 0 ? Buffer.from(content).toString() : '';
        const json = contents ? (JSON.parse(contents) as Partial<nbformat.INotebookContent>) : undefined;

        // Double check json (if we have any)
        if (json && !json.cells) {
            return new NotebookData([]);
        }

        // Then compute indent. It's computed from the contents
        const indentAmount = contents ? detectIndent(contents).indent : ' ';

        // Then save the contents. We'll stick our cells back into this format when we save
        if (json) {
            // Log language or kernel telemetry
            sendLanguageTelemetry(json);
        }
        const preferredCellLanguage = this.cellLanguageService.getPreferredLanguage(json?.metadata);
        const data = notebookModelToVSCNotebookData(
            { ...json, cells: [] },
            json?.cells || [],
            preferredCellLanguage,
            json || {}
        );
        data.metadata = data.metadata.with({ indentAmount, __vsc_id: uuid() });
        if (json?.nbformat) {
            data.metadata = data.metadata.with({ nbformat: json.nbformat });
        }
        if (json?.nbformat_minor) {
            data.metadata = data.metadata.with({ nbformat_minor: json.nbformat_minor });
        }
        return data;
    }
    public async serializeNotebook(data: NotebookData, _token: CancellationToken): Promise<Uint8Array> {
        const json: nbformat.INotebookContent = {
            cells: [],
            metadata: { orig_nbformat: 4 },
            nbformat: 4,
            nbformat_minor: 2
        };
        if ('nbformat' in data.metadata) {
            json.nbformat = data.metadata.nbformat;
        }
        if ('nbformat_minor' in data.metadata) {
            json.nbformat = data.metadata.nbformat_minor;
        }
        const indentAmount =
            'indentAmount' in data.metadata && typeof data.metadata.indentAmount === 'string'
                ? data.metadata.indentAmount
                : ' ';
        json.cells = data.cells.map((cell) => createJupyterCellFromVSCNotebookCell(cell)).map(pruneCell);

        return Buffer.from(JSON.stringify(json, undefined, indentAmount), 'utf-8');
    }
    // public async openNotebook(uri: Uri, openContext: NotebookDocumentOpenContext): Promise<NotebookData> {
    //     if (!this.compatibilitySupport.canOpenWithVSCodeNotebookEditor(uri)) {
    //         // If not supported, return a notebook with error displayed.
    //         // We cannot, not display a notebook.
    //         return {
    //             cells: [
    //                 new NotebookCellData(
    //                     NotebookCellKind.Markup,
    //                     `# ${DataScience.usingPreviewNotebookWithOtherNotebookWarning()}`,
    //                     MARKDOWN_LANGUAGE,
    //                     [],
    //                     new NotebookCellMetadata()
    //                 )
    //             ],
    //             metadata: new NotebookDocumentMetadata()
    //         };
    //     }
    //     // If there's no backup id, then skip loading dirty contents.
    //     const model = await this.notebookStorage.getOrCreateModel({
    //         file: uri,
    //         backupId: openContext.backupId,
    //         isNative: true,
    //         skipLoadingDirtyContents: openContext.backupId === undefined
    //     });
    //     if (!(model instanceof VSCodeNotebookModel)) {
    //         throw new Error('Incorrect NotebookModel, expected VSCodeNotebookModel');
    //     }
    //     sendTelemetryEvent(Telemetry.CellCount, undefined, { count: model.cellCount });
    //     return model.getNotebookData();
    // }
    // @captureTelemetry(Telemetry.Save, undefined, true)
    // public async saveNotebook(document: NotebookDocument, cancellation: CancellationToken) {
    //     const model = await this.notebookStorage.getOrCreateModel({ file: document.uri, isNative: true });
    //     if (cancellation.isCancellationRequested) {
    //         return;
    //     }
    //     await this.notebookStorage.save(model, cancellation);
    // }

    // public async saveNotebookAs(
    //     targetResource: Uri,
    //     document: NotebookDocument,
    //     cancellation: CancellationToken
    // ): Promise<void> {
    //     const model = await this.notebookStorage.getOrCreateModel({ file: document.uri, isNative: true });
    //     if (!cancellation.isCancellationRequested) {
    //         await this.notebookStorage.saveAs(model, targetResource);
    //     }
    // }
    // public async backupNotebook(
    //     document: NotebookDocument,
    //     _context: NotebookDocumentBackupContext,
    //     cancellation: CancellationToken
    // ): Promise<NotebookDocumentBackup> {
    //     const model = await this.notebookStorage.getOrCreateModel({ file: document.uri, isNative: true });
    //     const id = this.notebookStorage.generateBackupId(model);
    //     await this.notebookStorage.backup(model, cancellation, id);
    //     return {
    //         id,
    //         delete: () => this.notebookStorage.deleteBackup(model, id).ignoreErrors()
    //     };
    // }
}
