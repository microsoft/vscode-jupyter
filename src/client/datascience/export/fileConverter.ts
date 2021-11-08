import { inject, injectable, named } from 'inversify';
import * as path from 'path';
import { CancellationToken, NotebookCellData, NotebookData, NotebookDocument, Uri, workspace } from 'vscode';
import { IApplicationShell } from '../../common/application/types';
import { traceError } from '../../common/logger';
import { IFileSystem, TemporaryDirectory } from '../../common/platform/types';
import { IConfigurationService, IExtensions } from '../../common/types';
import * as localize from '../../common/utils/localize';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { sendTelemetryEvent } from '../../telemetry';
import { Telemetry } from '../constants';
import { ProgressReporter } from '../progress/progressReporter';
import { ExportFileOpener } from './exportFileOpener';
import { ExportInterpreterFinder } from './exportInterpreterFinder';
import { ExportUtil } from './exportUtil';
import { ExportFormat, INbConvertExport, IExportDialog, IFileConverter, IExport } from './types';

// Class is responsible for file conversions (ipynb, py, pdf, html) and managing nb convert for some of those conversions
@injectable()
export class FileConverter implements IFileConverter {
    constructor(
        @inject(INbConvertExport) @named(ExportFormat.pdf) private readonly exportToPDF: INbConvertExport,
        @inject(INbConvertExport) @named(ExportFormat.html) private readonly exportToHTML: INbConvertExport,
        @inject(INbConvertExport) @named(ExportFormat.python) private readonly exportToPython: INbConvertExport,
        @inject(IExport) @named(ExportFormat.python) private readonly exportToPythonPlain: IExport,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IExportDialog) private readonly filePicker: IExportDialog,
        @inject(ProgressReporter) private readonly progressReporter: ProgressReporter,
        @inject(ExportUtil) private readonly exportUtil: ExportUtil,
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(ExportFileOpener) private readonly exportFileOpener: ExportFileOpener,
        @inject(ExportInterpreterFinder) private exportInterpreterFinder: ExportInterpreterFinder,
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(IConfigurationService) private readonly configuration: IConfigurationService
    ) {}

    // Import a notebook file on disk to a .py file
    public async importIpynb(source: Uri): Promise<void> {
        const reporter = this.progressReporter.createProgressIndicator(localize.DataScience.importingIpynb(), true);
        let nbDoc;
        try {
            // Open the source as a NotebookDocument, note that this doesn't actually show an editor, and we don't need
            // a specific close action as VS Code owns the lifetime
            nbDoc = await workspace.openNotebookDocument(source);
            await this.exportImpl(ExportFormat.python, nbDoc, reporter.token);
        } finally {
            reporter.dispose();
        }
    }

    public async export(
        format: ExportFormat,
        sourceDocument: NotebookDocument,
        defaultFileName?: string,
        candidateInterpreter?: PythonEnvironment
    ): Promise<undefined> {
        const reporter = this.progressReporter.createProgressIndicator(
            localize.DataScience.exportingToFormat().format(format.toString()),
            true
        );

        try {
            await this.exportImpl(format, sourceDocument, reporter.token, defaultFileName, candidateInterpreter);
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
            sendTelemetryEvent(Telemetry.ExportNotebookAsFailed, undefined, { format: format });

            if (format === ExportFormat.pdf) {
                traceError(localize.DataScience.exportToPDFDependencyMessage());
            }

            this.showExportFailed(localize.DataScience.exportFailedGeneralMessage());
        }
    }

    private async performExport(
        format: ExportFormat,
        sourceDocument: NotebookDocument,
        target: Uri,
        token: CancellationToken,
        candidateInterpreter?: PythonEnvironment
    ) {
        const pythonNbconvert = this.configuration.getSettings(sourceDocument.uri).pythonExportMethod === 'nbconvert';

        if (format === ExportFormat.python && !pythonNbconvert) {
            // Unless selected by the setting use plain conversion for python script convert
            await this.performPlainExport(format, sourceDocument, target, token);
        } else {
            // For all others (or if 'nbconvert' set for python export method) use nbconvert path
            // Get the interpreter to use for the export, checking the candidate interpreter first
            const exportInterpreter = await this.exportInterpreterFinder.getExportInterpreter(candidateInterpreter);
            const contents = await this.getContent(sourceDocument);
            await this.performNbConvertExport(format, contents, target, exportInterpreter, token);
        }

        await this.exportFileOpener.openFile(format, target);
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

    private async performNbConvertExport(
        format: ExportFormat,
        contents: string,
        target: Uri,
        interpreter: PythonEnvironment,
        cancelToken: CancellationToken
    ) {
        /* Need to make a temp directory here, instead of just a temp file. This is because
           we need to store the contents of the notebook in a file that is named the same
           as what we want the title of the exported file to be. To ensure this file path will be unique
           we store it in a temp directory. The name of the file matters because when
           exporting to certain formats the filename is used within the exported document as the title. */
        const tempDir = await this.exportUtil.generateTempDir();
        const source = await this.makeSourceFile(target, contents, tempDir);

        try {
            await this.exportToFormat(source, target, format, interpreter, cancelToken);
        } finally {
            tempDir.dispose();
        }
    }

    private async getTargetFile(format: ExportFormat, source: Uri, defaultFileName?: string): Promise<Uri | undefined> {
        let target;

        if (format !== ExportFormat.python) {
            target = await this.filePicker.showDialog(format, source, defaultFileName);
        } else {
            target = Uri.file((await this.fs.createTemporaryLocalFile('.py')).filePath);
        }

        return target;
    }

    private async makeSourceFile(target: Uri, contents: string, tempDir: TemporaryDirectory): Promise<Uri> {
        // Creates a temporary file with the same base name as the target file
        const fileName = path.basename(target.fsPath, path.extname(target.fsPath));
        const sourceFilePath = await this.exportUtil.makeFileInDirectory(contents, `${fileName}.ipynb`, tempDir.path);
        return Uri.file(sourceFilePath);
    }

    private showExportFailed(msg: string) {
        // eslint-disable-next-line
        this.applicationShell.showErrorMessage(`${localize.DataScience.failedExportMessage()} ${msg}`).then();
    }

    private async exportToFormat(
        source: Uri,
        target: Uri,
        format: ExportFormat,
        interpreter: PythonEnvironment,
        cancelToken: CancellationToken
    ) {
        if (format === ExportFormat.pdf) {
            // When exporting to PDF we need to remove any SVG output. This is due to an error
            // with nbconvert and a dependency of its called InkScape.
            await this.exportUtil.removeSvgs(source);
        }

        switch (format) {
            case ExportFormat.python:
                await this.exportToPython.export(source, target, interpreter, cancelToken);
                break;

            case ExportFormat.pdf:
                await this.exportToPDF.export(source, target, interpreter, cancelToken);
                break;

            case ExportFormat.html:
                await this.exportToHTML.export(source, target, interpreter, cancelToken);
                break;

            default:
                break;
        }
    }
    private async getContent(document: NotebookDocument): Promise<string> {
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
            data.mime = c.mime;
            data.outputs = [...c.outputs];
            return data;
        });
        const notebookData = new NotebookData(cellData);
        notebookData.metadata = document.metadata;
        return serializerApi.exports.exportNotebook(notebookData);
    }
}
