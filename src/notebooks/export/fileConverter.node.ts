// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Uri } from 'vscode';
import { IConfigurationService } from '../../platform/common/types';
import { ProgressReporter } from '../../platform/progress/progressReporter';
import { ExportFileOpener } from './exportFileOpener';
import { ExportFormat, IExportUtil, IFileConverter } from './types';
import { IFileSystemNode } from '../../platform/common/platform/types.node';
import { FileConverterBase } from './fileConverter';
import { noop } from '../../platform/common/utils/misc';

// Class is responsible for file conversions (ipynb, py, pdf, html) and managing nb convert for some of those conversions
@injectable()
export class FileConverter extends FileConverterBase implements IFileConverter {
    constructor(
        @inject(IExportUtil) override readonly exportUtil: IExportUtil,
        @inject(IFileSystemNode) readonly fs: IFileSystemNode,
        @inject(ProgressReporter) progressReporter: ProgressReporter,
        @inject(IConfigurationService) configuration: IConfigurationService
    ) {
        super(exportUtil, progressReporter, configuration);
    }

    protected override async openExportedFile(format: ExportFormat, target: Uri) {
        await new ExportFileOpener().openFile(format, target).catch(noop);
    }
}
