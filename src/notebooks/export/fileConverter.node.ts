// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { Uri } from 'vscode';
import { IApplicationShell } from '../../platform/common/application/types';
import { IConfigurationService } from '../../platform/common/types';
import { ProgressReporter } from '../../platform/progress/progressReporter';
import { ExportFileOpener } from './exportFileOpener';
import { ExportFormat, INbConvertExport, IExportDialog, IFileConverter, IExport } from './types';
import { IFileSystemNode } from '../../platform/common/platform/types.node';
import { FileConverter as FileConverterBase } from './fileConverter';
import { ExportUtil } from './exportUtil.node';
import { noop } from '../../platform/common/utils/misc';

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
        @inject(IConfigurationService) configuration: IConfigurationService
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
            configuration
        );
    }

    protected override async openExportedFile(format: ExportFormat, target: Uri) {
        await new ExportFileOpener().openFile(format, target).catch(noop);
    }
}
