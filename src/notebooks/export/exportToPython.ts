// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { CancellationToken, NotebookDocument, Uri } from 'vscode';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { ExportFormat, IExportBase, INbConvertExport } from './types';
import { ServiceContainer } from '../../platform/ioc/container';

/**
 * Specific implementation of INbConvertExport for exporting to a Python file
 */
@injectable()
export class ExportToPython implements INbConvertExport {
    public async export(
        sourceDocument: NotebookDocument,
        target: Uri,
        interpreter: PythonEnvironment,
        token: CancellationToken
    ): Promise<void> {
        const exportBase = ServiceContainer.instance.get<IExportBase>(IExportBase);
        await exportBase.executeCommand(sourceDocument, target, ExportFormat.python, interpreter, token);
    }
}
