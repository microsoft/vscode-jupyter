// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';
import * as nbformat from '@jupyterlab/nbformat';
import { inject, injectable } from 'inversify';
import { Uri, CancellationToken, NotebookDocument } from 'vscode';
import * as path from '../../platform/vscode-path/path';
import { DisplayOptions } from '../../kernels/displayOptions';
import { executeSilently } from '../../kernels/helpers';
import { IKernel, IKernelProvider } from '../../kernels/types';
import { concatMultilineString } from '../../webviews/webview-side/common';
import { IFileSystem } from '../common/platform/types';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { ExportUtilBase } from './exportUtil';
import { ExportFormat, IExportBase, IExportDialog, INbConvertExport } from './types';
import { traceError } from '../logging';

@injectable()
export class ExportBase implements INbConvertExport, IExportBase {
    constructor(
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IExportDialog) protected readonly filePicker: IExportDialog,
        @inject(ExportUtilBase) protected readonly exportUtil: ExportUtilBase
    ) {}

    public async export(
        _sourceDocument: NotebookDocument,
        _interpreter: PythonEnvironment,
        _defaultFileName: string | undefined,
        _token: CancellationToken
    ): Promise<Uri | undefined> {
        return undefined;
    }

    // @reportAction(ReportableAction.PerformingExport)
    async executeCommand(
        sourceDocument: NotebookDocument,
        defaultFileName: string | undefined,
        format: ExportFormat,
        _interpreter: PythonEnvironment,
        _token: CancellationToken
    ): Promise<Uri | undefined> {
        const kernel = this.kernelProvider.get(sourceDocument.uri);
        if (!kernel) {
            // trace error
            return;
        }

        if (!kernel.session) {
            await kernel.start(new DisplayOptions(false));
        }

        if (!kernel.session) {
            return;
        }

        if (kernel.session!.isServerSession()) {
            const session = kernel.session!;
            let contents = await this.exportUtil.getContent(sourceDocument);

            let target: Uri | undefined;

            await kernel.session!.invokeWithFileSynced(contents, async (file) => {
                const pwd = await this.getCWD(kernel);
                const filePath = `${pwd}/${file.filePath}`;

                if (format === ExportFormat.pdf) {
                    const tempTarget = await session.createTempfile('.pdf');
                    const outputs = await executeSilently(
                        session,
                        `!jupyter nbconvert ${filePath} --to pdf --output ${path.basename(tempTarget)}`
                    );

                    const text = this.parseStreamOutput(outputs);

                    if (this.exportSucceed(text)) {
                        const downloadUrl = await session.getDownloadPath(tempTarget);
                        target = Uri.parse(downloadUrl);
                    } else {
                        traceError(text || 'Failed to export to PDF');
                        throw new Error(text || 'Failed to export to PDF');
                    }
                } else {
                    target = await this.getTargetFile(format, sourceDocument.uri, defaultFileName);
                    if (target === undefined) {
                        return;
                    }

                    const outputs = await executeSilently(
                        session,
                        `!jupyter nbconvert ${filePath} --to ${format} --stdout`
                    );

                    const text = this.parseStreamOutput(outputs);
                    if (!text) {
                        return;
                    }

                    const headerRemoved = text
                        .split(/\r\n|\r|\n/g)
                        .slice(1)
                        .join('\n');

                    await this.fs.writeFile(target!, headerRemoved);
                }
            });

            return target;
        } else {
            // no op
        }
    }

    private exportSucceed(message: string | undefined) {
        if (!message) {
            return false;
        }

        return /\[NbConvertApp\].* successfully created/g.exec(message);
    }

    private parseStreamOutput(outputs: nbformat.IOutput[]): string | undefined {
        if (outputs.length === 0) {
            return;
        }

        const output: nbformat.IStream = outputs[0] as unknown as nbformat.IStream;
        if (output.name !== 'stdout' && output.output_type !== 'stream') {
            return;
        }

        const text = concatMultilineString(output.text).trim();
        return text;
    }

    private async getTargetFile(format: ExportFormat, source: Uri, defaultFileName?: string): Promise<Uri | undefined> {
        let target = await this.filePicker.showDialog(format, source, defaultFileName);

        return target;
    }

    private async getCWD(kernel: IKernel) {
        const outputs = await executeSilently(kernel.session!, `import os;os.getcwd();`);
        if (outputs.length === 0) {
            return;
        }

        const output: nbformat.IExecuteResult = outputs[0] as unknown as nbformat.IExecuteResult;
        if (output.output_type !== 'execute_result') {
            return undefined;
        }

        return output.data['text/plain'];
    }
}
