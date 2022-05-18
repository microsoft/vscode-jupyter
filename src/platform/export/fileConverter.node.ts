import { inject, injectable, named } from 'inversify';
import { CancellationToken, NotebookDocument, Uri } from 'vscode';
import { IApplicationShell } from '../common/application/types';
import { IConfigurationService } from '../common/types';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { ProgressReporter } from '../progress/progressReporter';
import { ExportFileOpener } from './exportFileOpener';
import { ExportFormat, INbConvertExport, IExportDialog, IFileConverter, IExport } from './types';
import { IFileSystemNode } from '../common/platform/types.node';
import { FileConverter as FileConverterBase } from './fileConverter';

// Class is responsible for file conversions (ipynb, py, pdf, html) and managing nb convert for some of those conversions
@injectable()
export class FileConverter extends FileConverterBase implements IFileConverter {
    constructor(
        @inject(INbConvertExport) @named(ExportFormat.pdf) exportToPDF: INbConvertExport,
        @inject(INbConvertExport) @named(ExportFormat.html) exportToHTML: INbConvertExport,
        @inject(INbConvertExport) @named(ExportFormat.python) exportToPython: INbConvertExport,
        @inject(IExport) @named(ExportFormat.python) exportToPythonPlain: IExport,
        @inject(IExportDialog) filePicker: IExportDialog,
        @inject(ProgressReporter) progressReporter: ProgressReporter,
        @inject(IApplicationShell) applicationShell: IApplicationShell,
        @inject(ExportFileOpener) exportFileOpener: ExportFileOpener,
        @inject(IConfigurationService) readonly configuration: IConfigurationService,
        @inject(IFileSystemNode) readonly fs: IFileSystemNode
    ) {
        super(
            exportToPythonPlain,
            exportToPDF,
            exportToHTML,
            exportToPython,
            filePicker,
            progressReporter,
            applicationShell,
            exportFileOpener
        );
    }

    override async performExport(
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
            await this.performNbConvertExport(sourceDocument, format, target, candidateInterpreter, token);
        }

        await this.exportFileOpener.openFile(format, target);
    }

    override async getTargetFile(
        format: ExportFormat,
        source: Uri,
        defaultFileName?: string
    ): Promise<Uri | undefined> {
        let target;

        if (format !== ExportFormat.python) {
            target = await this.filePicker.showDialog(format, source, defaultFileName);
        } else {
            target = Uri.file((await this.fs.createTemporaryLocalFile('.py')).filePath);
        }

        return target;
    }
}
