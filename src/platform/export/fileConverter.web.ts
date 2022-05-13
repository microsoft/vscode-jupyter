// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, named } from 'inversify';
import { CancellationToken, CancellationTokenSource, NotebookDocument, Uri } from 'vscode';
import { traceError } from '../logging';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { ExportFileOpener } from './exportFileOpener';
import { ExportFormat, IExport, IExportDialog, IFileConverter } from './types';

@injectable()
export class FileConverter implements IFileConverter {
    constructor(
        @inject(IExport) @named(ExportFormat.python) private readonly exportToPythonPlain: IExport,
        @inject(IExportDialog) private readonly filePicker: IExportDialog,
        @inject(ExportFileOpener) private readonly exportFileOpener: ExportFileOpener
    ) { }

    async export(
        format: ExportFormat,
        sourceDocument: NotebookDocument,
        defaultFileName?: string | undefined,
        candidateInterpreter?: PythonEnvironment
    ): Promise<undefined> {
        try {
            const cancellation = new CancellationTokenSource();
            await this.exportImpl(format, sourceDocument, cancellation.token, defaultFileName, candidateInterpreter);
            cancellation.dispose();
        } finally {
        }

        return;
    }

    public async exportImpl(
        format: ExportFormat,
        sourceDocument: NotebookDocument,
        token: CancellationToken,
        defaultFileName?: string,
        candidateInterpreter?: PythonEnvironment
    ): Promise<undefined> {
        let target;
        try {
            target = await this.getTargetFile(format, sourceDocument.uri, defaultFileName);
            if (!target) {
                return;
            }
            await this.performExport(format, sourceDocument, target, token, candidateInterpreter);
        } catch (e) {
            traceError('Export failed', e);
        }
    }

    private async performExport(
        format: ExportFormat,
        sourceDocument: NotebookDocument,
        target: Uri,
        token: CancellationToken,
        _candidateInterpreter?: PythonEnvironment
    ) {
        // For web, we perform plain export for Python
        if (format === ExportFormat.python) {
            // Unless selected by the setting use plain conversion for python script convert
            await this.performPlainExport(format, sourceDocument, target, token);
            await this.exportFileOpener.openFile(format, target, true);
        } else {
            throw new Error('Method not implemented.');
        }
    }

    private async performPlainExport(
        format: ExportFormat,
        sourceDocument: NotebookDocument,
        target: Uri,
        cancelToken: CancellationToken
    ) {
        switch (format) {
            case ExportFormat.python:
                await this.exportToPythonPlain.export(sourceDocument, target, cancelToken);
                break;
        }
    }

    private async getTargetFile(format: ExportFormat, source: Uri, defaultFileName?: string): Promise<Uri | undefined> {
        let target = await this.filePicker.showDialog(format, source, defaultFileName);

        return target;
    }

    importIpynb(_source: Uri): Promise<void> {
        throw new Error('Method not implemented.');
    }
}
