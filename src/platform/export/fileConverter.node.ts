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
        defaultFileName: string | undefined,
        token: CancellationToken,
        candidateInterpreter?: PythonEnvironment
    ) {
        let target: Uri | undefined;
        const pythonNbconvert = this.configuration.getSettings(sourceDocument.uri).pythonExportMethod === 'nbconvert';

        if (format === ExportFormat.python && !pythonNbconvert) {
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
            await this.exportFileOpener.openFile(format, target);
        }
    }
}
