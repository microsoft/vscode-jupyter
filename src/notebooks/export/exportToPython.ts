// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { CancellationToken, NotebookDocument, Uri } from 'vscode';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { ExportFormat, IExportBase, INbConvertExport } from './types';

/**
 * Specific implementation of INbConvertExport for exporting to a Python file
 */
@injectable()
export class ExportToPython implements INbConvertExport {
    constructor(@inject(IExportBase) protected readonly exportBase: IExportBase) {}

    public async export(
        sourceDocument: NotebookDocument,
        target: Uri,
        interpreter: PythonEnvironment,
        token: CancellationToken
    ): Promise<void> {
        await this.exportBase.executeCommand(sourceDocument, target, ExportFormat.python, interpreter, token);
    }
}
