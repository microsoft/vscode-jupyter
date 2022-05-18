import { inject, injectable } from 'inversify';
import { CancellationToken, NotebookDocument, Uri } from 'vscode';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { ExportFormat, IExportBase, INbConvertExport } from './types';

@injectable()
export class ExportToPDF implements INbConvertExport {
    constructor(@inject(IExportBase) protected readonly exportBase: IExportBase) {}

    public async export(
        sourceDocument: NotebookDocument,
        interpreter: PythonEnvironment,
        defaultFileName: string | undefined,
        token: CancellationToken
    ): Promise<Uri | undefined> {
        return await this.exportBase.executeCommand(
            sourceDocument,
            defaultFileName,
            ExportFormat.pdf,
            interpreter,
            token
        );
    }
}
