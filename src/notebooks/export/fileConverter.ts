// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject } from 'inversify';
import { CancellationToken, NotebookDocument, Uri, window, workspace } from 'vscode';
import { sendTelemetryEvent } from '../../telemetry';
import { Telemetry } from '../../platform/common/constants';
import { IConfigurationService } from '../../platform/common/types';
import * as localize from '../../platform/common/utils/localize';
import { noop } from '../../platform/common/utils/misc';
import { traceError } from '../../platform/logging';
import { ProgressReporter } from '../../platform/progress/progressReporter';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { ExportFileOpener } from './exportFileOpener';
import { ExportFormat, IExportUtil, IFileConverter } from './types';
import { ExportToPython } from './exportToPython';
import { ExportToPDF } from './exportToPDF';
import { ExportToHTML } from './exportToHTML';
import { ExportToPythonPlain } from './exportToPythonPlain';

/**
 * Converts different file formats to others. Used in export.
 */
export abstract class FileConverterBase implements IFileConverter {
    constructor(
        @inject(IExportUtil) protected readonly exportUtil: IExportUtil,
        @inject(ProgressReporter) private readonly progressReporter: ProgressReporter,
        @inject(IConfigurationService) protected readonly configuration: IConfigurationService
    ) {}

    async importIpynb(source: Uri): Promise<void> {
        const reporter = this.progressReporter.createProgressIndicator(localize.DataScience.importingIpynb, true);
        try {
            // Open the source as a NotebookDocument, note that this doesn't actually show an editor, and we don't need
            // a specific close action as VS Code owns the lifetime
            const nbDoc = await workspace.openNotebookDocument(source);
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
            localize.DataScience.exportingToFormat(format.toString()),
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
            let target = await this.exportUtil.getTargetFile(format, sourceDocument.uri, defaultFileName);
            if (!target) {
                return;
            }
            await this.performExport(format, sourceDocument, target, token, candidateInterpreter);
        } catch (e) {
            traceError('Export failed', e);
            sendTelemetryEvent(Telemetry.ExportNotebookAsFailed, undefined, { format: format });

            if (format === ExportFormat.pdf) {
                traceError(localize.DataScience.exportToPDFDependencyMessage);
            }

            this.showExportFailed(localize.DataScience.exportFailedGeneralMessage);
        }
    }

    protected async performExport(
        format: ExportFormat,
        sourceDocument: NotebookDocument,
        target: Uri,
        token: CancellationToken,
        candidateInterpreter?: PythonEnvironment
    ) {
        // For web, we perform plain export for Python
        if (
            format === ExportFormat.python &&
            this.configuration.getSettings(sourceDocument.uri).pythonExportMethod !== 'nbconvert'
        ) {
            // Unless selected by the setting use plain conversion for python script convert
            await this.performPlainExport(format, sourceDocument, target, token);
        } else {
            await this.performNbConvertExport(sourceDocument, format, target, candidateInterpreter, token);
        }

        if (target) {
            // As far as this method is concerned the export was successful, whether the user opens the file or not
            // should not have any bearing on the completion (resolving) this method.
            // Hence don't await.
            this.openExportedFile(format, target).catch(noop);
        }
    }

    protected async openExportedFile(format: ExportFormat, target: Uri) {
        await new ExportFileOpener().openFile(format, target, true).catch(noop);
    }

    protected async performPlainExport(
        format: ExportFormat,
        sourceDocument: NotebookDocument,
        target: Uri,
        cancelToken: CancellationToken
    ): Promise<Uri | undefined> {
        if (target) {
            switch (format) {
                case ExportFormat.python:
                    await new ExportToPythonPlain().export(sourceDocument, target, cancelToken);
                    break;
            }
        }

        return target;
    }

    protected async performNbConvertExport(
        sourceDocument: NotebookDocument,
        format: ExportFormat,
        target: Uri,
        interpreter: PythonEnvironment | undefined,
        cancelToken: CancellationToken
    ) {
        try {
            return await this.exportToFormat(sourceDocument, target, format, interpreter, cancelToken);
        } finally {
        }
    }

    protected async exportToFormat(
        sourceDocument: NotebookDocument,
        target: Uri,
        format: ExportFormat,
        interpreter: PythonEnvironment | undefined,
        cancelToken: CancellationToken
    ) {
        switch (format) {
            case ExportFormat.python:
                return new ExportToPython().export(sourceDocument, target, interpreter!, cancelToken);

            case ExportFormat.pdf:
                return new ExportToPDF().export(sourceDocument, target, interpreter!, cancelToken);

            case ExportFormat.html:
                return new ExportToHTML().export(sourceDocument, target, interpreter!, cancelToken);

            default:
                break;
        }
    }

    private showExportFailed(msg: string) {
        void window.showErrorMessage(`${localize.DataScience.failedExportMessage} ${msg}`);
    }
}
