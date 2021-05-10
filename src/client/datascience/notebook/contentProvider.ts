// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import {
    CancellationToken,
    NotebookCellKind,
    Uri,
    NotebookContentProvider as VSCNotebookContentProvider,
    NotebookData,
    NotebookDocument,
    NotebookDocumentBackup,
    NotebookDocumentBackupContext,
    NotebookDocumentOpenContext,
    NotebookDocumentMetadata,
    NotebookCellMetadata
} from 'vscode';
import { IVSCodeNotebook } from '../../common/application/types';
import { MARKDOWN_LANGUAGE } from '../../common/constants';
import { DataScience } from '../../common/utils/localize';
import { captureTelemetry, sendTelemetryEvent } from '../../telemetry';
import { Telemetry } from '../constants';
import { INotebookStorageProvider } from '../notebookStorage/notebookStorageProvider';
import { VSCodeNotebookModel } from '../notebookStorage/vscNotebookModel';
import { NotebookEditorCompatibilitySupport } from './notebookEditorCompatibilitySupport';
/**
 * This class is responsible for reading a notebook file (ipynb or other files) and returning VS Code with the NotebookData.
 * Its up to extension authors to read the files and return it in a format that VSCode understands.
 * Same with the cells and cell output.
 *
 * Also responsible for saving of notebooks.
 * When saving, VSC will provide their model and we need to take that and merge it with an existing ipynb json (if any, to preserve metadata).
 */
@injectable()
export class NotebookContentProvider implements VSCNotebookContentProvider {
    constructor(
        @inject(INotebookStorageProvider) private readonly notebookStorage: INotebookStorageProvider,
        @inject(NotebookEditorCompatibilitySupport)
        private readonly compatibilitySupport: NotebookEditorCompatibilitySupport,
        @inject(IVSCodeNotebook) readonly notebookProvider: IVSCodeNotebook
    ) {}
    public async openNotebook(uri: Uri, openContext: NotebookDocumentOpenContext): Promise<NotebookData> {
        if (!this.compatibilitySupport.canOpenWithVSCodeNotebookEditor(uri)) {
            // If not supported, return a notebook with error displayed.
            // We cannot, not display a notebook.
            return {
                cells: [
                    {
                        kind: NotebookCellKind.Markdown,
                        language: MARKDOWN_LANGUAGE,
                        source: `# ${DataScience.usingPreviewNotebookWithOtherNotebookWarning()}`,
                        metadata: new NotebookCellMetadata(),
                        outputs: []
                    }
                ],
                metadata: new NotebookDocumentMetadata()
            };
        }
        // If there's no backup id, then skip loading dirty contents.
        const model = await this.notebookStorage.getOrCreateModel({
            file: uri,
            backupId: openContext.backupId,
            isNative: true,
            skipLoadingDirtyContents: openContext.backupId === undefined
        });
        if (!(model instanceof VSCodeNotebookModel)) {
            throw new Error('Incorrect NotebookModel, expected VSCodeNotebookModel');
        }
        sendTelemetryEvent(Telemetry.CellCount, undefined, { count: model.cellCount });
        return model.getNotebookData();
    }
    @captureTelemetry(Telemetry.Save, undefined, true)
    public async saveNotebook(document: NotebookDocument, cancellation: CancellationToken) {
        const model = await this.notebookStorage.getOrCreateModel({ file: document.uri, isNative: true });
        if (cancellation.isCancellationRequested) {
            return;
        }
        await this.notebookStorage.save(model, cancellation);
    }

    public async saveNotebookAs(
        targetResource: Uri,
        document: NotebookDocument,
        cancellation: CancellationToken
    ): Promise<void> {
        const model = await this.notebookStorage.getOrCreateModel({ file: document.uri, isNative: true });
        if (!cancellation.isCancellationRequested) {
            await this.notebookStorage.saveAs(model, targetResource);
        }
    }
    public async backupNotebook(
        document: NotebookDocument,
        _context: NotebookDocumentBackupContext,
        cancellation: CancellationToken
    ): Promise<NotebookDocumentBackup> {
        const model = await this.notebookStorage.getOrCreateModel({ file: document.uri, isNative: true });
        const id = this.notebookStorage.generateBackupId(model);
        await this.notebookStorage.backup(model, cancellation, id);
        return {
            id,
            delete: () => this.notebookStorage.deleteBackup(model, id).ignoreErrors()
        };
    }
}
