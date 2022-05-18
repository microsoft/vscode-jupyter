// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, named } from 'inversify';
import { CancellationToken, NotebookDocument, Uri, workspace } from 'vscode';
import { sendTelemetryEvent } from '../../telemetry';
import { IApplicationShell } from '../common/application/types';
import { Telemetry } from '../common/constants';
import * as localize from '../common/utils/localize';
import { traceError } from '../logging';
import { ProgressReporter } from '../progress/progressReporter';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { ExportFileOpener } from './exportFileOpener';
import { ExportFormat, IExport, IExportDialog, IFileConverter, INbConvertExport } from './types';

@injectable()
export class FileConverter implements IFileConverter {
    constructor(
        @inject(IExport) @named(ExportFormat.python) private readonly exportToPythonPlain: IExport,
        @inject(INbConvertExport) @named(ExportFormat.pdf) private readonly exportToPDF: INbConvertExport,
        @inject(INbConvertExport) @named(ExportFormat.html) private readonly exportToHTML: INbConvertExport,
        @inject(INbConvertExport) @named(ExportFormat.python) private readonly exportToPython: INbConvertExport,
        @inject(IExportDialog) protected readonly filePicker: IExportDialog,
        @inject(ProgressReporter) private readonly progressReporter: ProgressReporter,
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(ExportFileOpener) protected readonly exportFileOpener: ExportFileOpener
    ) {}

    async importIpynb(source: Uri): Promise<void> {
        const reporter = this.progressReporter.createProgressIndicator(localize.DataScience.importingIpynb(), true);
        let nbDoc;
        try {
            // Open the source as a NotebookDocument, note that this doesn't actually show an editor, and we don't need
            // a specific close action as VS Code owns the lifetime
            nbDoc = await workspace.openNotebookDocument(source);
            await this.exportImpl(ExportFormat.python, nbDoc, undefined, reporter.token);
        } finally {
            reporter.dispose();
        }
    }

    async export(
        format: ExportFormat,
        sourceDocument: NotebookDocument,
        defaultFileName?: string | undefined,
        candidateInterpreter?: PythonEnvironment
    ): Promise<undefined> {
        const reporter = this.progressReporter.createProgressIndicator(
            localize.DataScience.exportingToFormat().format(format.toString()),
            true
        );

        try {
            await this.exportImpl(format, sourceDocument, defaultFileName, reporter.token, candidateInterpreter);
        } finally {
            reporter.dispose();
        }

        if (reporter.token.isCancellationRequested) {
            sendTelemetryEvent(Telemetry.ExportNotebookAs, undefined, { format: format, cancelled: true });
            return;
        }
    }

    public async exportImpl(
        format: ExportFormat,
        sourceDocument: NotebookDocument,
        defaultFileName: string | undefined,
        token: CancellationToken,
        candidateInterpreter?: PythonEnvironment
    ): Promise<void> {
        try {
            await this.performExport(format, sourceDocument, defaultFileName, token, candidateInterpreter);
        } catch (e) {
            traceError('Export failed', e);
            sendTelemetryEvent(Telemetry.ExportNotebookAsFailed, undefined, { format: format });

            if (format === ExportFormat.pdf) {
                traceError(localize.DataScience.exportToPDFDependencyMessage());
            }

            this.showExportFailed(localize.DataScience.exportFailedGeneralMessage());
        }
    }

    protected async performExport(
        format: ExportFormat,
        sourceDocument: NotebookDocument,
        defaultFileName: string | undefined,
        token: CancellationToken,
        candidateInterpreter?: PythonEnvironment
    ) {
        let target: Uri | undefined;
        // For web, we perform plain export for Python
        if (format === ExportFormat.python) {
            // Unless selected by the setting use plain conversion for python script convert
            target = await this.performPlainExport(format, sourceDocument, defaultFileName, token);
        } else {
            target = await this.performNbConvertExport(
                sourceDocument,
                format,
                defaultFileName,
                candidateInterpreter,
                token
            );
        }

        if (target) {
            await this.exportFileOpener.openFile(format, target, true);
        }
    }

    protected async performPlainExport(
        format: ExportFormat,
        sourceDocument: NotebookDocument,
        defaultFileName: string | undefined,
        cancelToken: CancellationToken
    ): Promise<Uri | undefined> {
        switch (format) {
            case ExportFormat.python:
                return await this.exportToPythonPlain.export(sourceDocument, defaultFileName, cancelToken);
                break;
        }
    }

    protected async performNbConvertExport(
        sourceDocument: NotebookDocument,
        format: ExportFormat,
        defaultFileName: string | undefined,
        interpreter: PythonEnvironment | undefined,
        cancelToken: CancellationToken
    ) {
        try {
            return await this.exportToFormat(sourceDocument, defaultFileName, format, interpreter, cancelToken);
        } finally {
        }
    }

    protected async exportToFormat(
        sourceDocument: NotebookDocument,
        defaultFileName: string | undefined,
        format: ExportFormat,
        interpreter: PythonEnvironment | undefined,
        cancelToken: CancellationToken
    ) {
        switch (format) {
            case ExportFormat.python:
                return await this.exportToPython.export(sourceDocument, interpreter, defaultFileName, cancelToken);

            case ExportFormat.pdf:
                return await this.exportToPDF.export(sourceDocument, interpreter, defaultFileName, cancelToken);

            case ExportFormat.html:
                return await this.exportToHTML.export(sourceDocument, interpreter, defaultFileName, cancelToken);

            default:
                break;
        }
    }

    private showExportFailed(msg: string) {
        // eslint-disable-next-line
        this.applicationShell.showErrorMessage(`${localize.DataScience.failedExportMessage()} ${msg}`).then();
    }
}
