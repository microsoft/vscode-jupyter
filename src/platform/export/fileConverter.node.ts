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
import { ExportUtil } from './exportUtil.node';

// Class is responsible for file conversions (ipynb, py, pdf, html) and managing nb convert for some of those conversions
@injectable()
export class FileConverter extends FileConverterBase implements IFileConverter {
    constructor(
        @inject(INbConvertExport) @named(ExportFormat.pdf) exportToPDF: INbConvertExport,
        @inject(INbConvertExport) @named(ExportFormat.html) exportToHTML: INbConvertExport,
        @inject(INbConvertExport) @named(ExportFormat.python) exportToPython: INbConvertExport,
        @inject(IExport) @named(ExportFormat.python) exportToPythonPlain: IExport,
        @inject(ExportUtil) override readonly exportUtil: ExportUtil,
        @inject(IFileSystemNode) readonly fs: IFileSystemNode,
        @inject(IExportDialog) filePicker: IExportDialog,
        @inject(ProgressReporter) progressReporter: ProgressReporter,
        @inject(IApplicationShell) applicationShell: IApplicationShell,
        @inject(ExportFileOpener) exportFileOpener: ExportFileOpener,
        @inject(IConfigurationService) readonly configuration: IConfigurationService
    ) {
        super(
            exportToPythonPlain,
            exportToPDF,
            exportToHTML,
            exportToPython,
            filePicker,
            exportUtil,
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

        if (target) {
            await this.exportFileOpener.openFile(format, target);
        }
    }
}
