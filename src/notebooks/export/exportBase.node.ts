// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import * as path from '../../platform/vscode-path/path';
import { CancellationToken, NotebookDocument, Uri } from 'vscode';
import { INotebookImporter } from '../../kernels/jupyter/types';
import { IJupyterSubCommandExecutionService } from '../../kernels/jupyter/types.node';
import { IFileSystemNode } from '../../platform/common/platform/types.node';

import { reportAction } from '../../platform/progress/decorator';
import { ReportableAction } from '../../platform/progress/types';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { ExportFormat, IExportBase } from './types';
import { ExportUtilNode, removeSvgs } from './exportUtil.node';
import { TemporaryDirectory } from '../../platform/common/platform/types';
import { ExportInterpreterFinder } from './exportInterpreterFinder.node';
import { IPythonExecutionFactory, IPythonExecutionService } from '../../platform/interpreter/types.node';
import { ExportUtilBase } from './exportUtil';

/**
 * Base class for using nbconvert to perform different export operations on node
 */
@injectable()
export class ExportBase implements IExportBase {
    constructor(
        @inject(IPythonExecutionFactory) protected readonly pythonExecutionFactory: IPythonExecutionFactory,
        @inject(IJupyterSubCommandExecutionService)
        protected jupyterService: IJupyterSubCommandExecutionService,
        @inject(IFileSystemNode) protected readonly fs: IFileSystemNode,
        @inject(ExportUtilBase) protected readonly exportUtil: ExportUtilBase,
        @inject(INotebookImporter) protected readonly importer: INotebookImporter,
        @inject(ExportInterpreterFinder) private exportInterpreterFinder: ExportInterpreterFinder
    ) {}

    public async export(
        _sourceDocument: NotebookDocument,
        _target: Uri,
        _interpreter: PythonEnvironment,
        _token: CancellationToken
    ): Promise<void> {
        return;
    }

    @reportAction(ReportableAction.PerformingExport)
    public async executeCommand(
        sourceDocument: NotebookDocument,
        target: Uri,
        format: ExportFormat,
        interpreter: PythonEnvironment | undefined,
        token: CancellationToken
    ): Promise<void> {
        if (token.isCancellationRequested) {
            return;
        }

        interpreter = await this.exportInterpreterFinder.getExportInterpreter(interpreter);

        if (format === ExportFormat.python) {
            const contents = await this.importer.importFromFile(sourceDocument.uri, interpreter);
            await this.fs.writeFile(target, contents);
            return;
        }

        let contents = await this.exportUtil.getContent(sourceDocument);

        if (format === ExportFormat.pdf) {
            // When exporting to PDF we need to remove any SVG output. This is due to an error
            // with nbconvert and a dependency of its called InkScape.
            contents = await removeSvgs(contents);
        }

        /* Need to make a temp directory here, instead of just a temp file. This is because
            we need to store the contents of the notebook in a file that is named the same
            as what we want the title of the exported file to be. To ensure this file path will be unique
            we store it in a temp directory. The name of the file matters because when
            exporting to certain formats the filename is used within the exported document as the title. */
        const tempDir = await new ExportUtilNode().generateTempDir();
        const source = await this.makeSourceFile(target, contents, tempDir);

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
                await this.fs.copy(Uri.file(tempTarget.filePath), target);
            } else {
                throw new Error('File size is zero during conversion. Outputting error.');
            }
        } catch {
            throw new Error(result.stderr);
        } finally {
            tempTarget.dispose();
        }

        return;
    }

    private async makeSourceFile(target: Uri, contents: string, tempDir: TemporaryDirectory): Promise<Uri> {
        // Creates a temporary file with the same base name as the target file
        const fileName = path.basename(target.fsPath, path.extname(target.fsPath));
        const sourceFilePath = await new ExportUtilNode().makeFileInDirectory(
            contents,
            `${fileName}.ipynb`,
            tempDir.path
        );
        return Uri.file(sourceFilePath);
    }

    protected async getExecutionService(
        source: Uri,
        interpreter: PythonEnvironment
    ): Promise<IPythonExecutionService | undefined> {
        return this.pythonExecutionFactory.createActivatedEnvironment({
            resource: source,
            interpreter
        });
    }
}
