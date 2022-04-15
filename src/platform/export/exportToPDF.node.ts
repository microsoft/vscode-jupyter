import { injectable } from 'inversify';
import { CancellationToken, Uri } from 'vscode';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { ExportBase } from './exportBase.node';
import { ExportFormat } from './types';

@injectable()
export class ExportToPDF extends ExportBase {
    public override async export(
        source: Uri,
        target: Uri,
        interpreter: PythonEnvironment,
        token: CancellationToken
    ): Promise<void> {
        await this.executeCommand(source, target, ExportFormat.pdf, interpreter, token);
    }
}
