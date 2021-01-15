import { inject, injectable } from 'inversify';
import * as path from 'path';
import { CancellationToken, Uri } from 'vscode';
import { IFileSystem } from '../../common/platform/types';

import { IPythonExecutionFactory, IPythonExecutionService } from '../../common/process/types';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { reportAction } from '../progress/decorator';
import { ReportableAction } from '../progress/types';
import { IJupyterSubCommandExecutionService, INotebookImporter } from '../types';
import { ExportFormat, IExport } from './types';

@injectable()
export class ExportBase implements IExport {
    constructor(
        @inject(IPythonExecutionFactory) protected readonly pythonExecutionFactory: IPythonExecutionFactory,
        @inject(IJupyterSubCommandExecutionService)
        protected jupyterService: IJupyterSubCommandExecutionService,
        @inject(IFileSystem) protected readonly fs: IFileSystem,
        @inject(INotebookImporter) protected readonly importer: INotebookImporter
    ) {}

    public async export(
        _source: Uri,
        _target: Uri,
        _interpreter: PythonEnvironment,
        _token: CancellationToken
        // eslint-disable-next-line no-empty,@typescript-eslint/no-empty-function
    ): Promise<void> {}

    @reportAction(ReportableAction.PerformingExport)
    public async executeCommand(
        source: Uri,
        target: Uri,
        format: ExportFormat,
        interpreter: PythonEnvironment,
        token: CancellationToken
    ): Promise<void> {
        if (token.isCancellationRequested) {
            return;
        }

        const service = await this.getExecutionService(source, interpreter);
        if (!service) {
            return;
        }

        if (token.isCancellationRequested) {
            return;
        }

        const tempTarget = await this.fs.createTemporaryLocalFile(path.extname(target.fsPath));
        const args = [
            source.fsPath,
            '--to',
            format,
            '--output',
            path.basename(tempTarget.filePath),
            '--output-dir',
            path.dirname(tempTarget.filePath),
            '--debug'
        ];
        const result = await service.execModule('jupyter', ['nbconvert'].concat(args), {
            throwOnStdErr: false,
            encoding: 'utf8',
            token: token
        });

        if (token.isCancellationRequested) {
            tempTarget.dispose();
            return;
        }
        try {
            if ((await this.fs.stat(Uri.file(tempTarget.filePath))).size > 1) {
                await this.fs.copyLocal(tempTarget.filePath, target.fsPath);
            } else {
                throw new Error('File size is zero during conversion. Outputting error.');
            }
        } catch {
            throw new Error(result.stderr);
        } finally {
            tempTarget.dispose();
        }
    }

    protected async getExecutionService(
        source: Uri,
        interpreter: PythonEnvironment
    ): Promise<IPythonExecutionService | undefined> {
        return this.pythonExecutionFactory.createActivatedEnvironment({
            resource: source,
            interpreter,
            allowEnvironmentFetchExceptions: false,
            bypassCondaExecution: true
        });
    }
}
