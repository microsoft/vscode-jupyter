// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as nbformat from '@jupyterlab/nbformat';
import { inject, injectable } from 'inversify';
import { Uri, CancellationToken, NotebookDocument } from 'vscode';
import * as path from '../../platform/vscode-path/path';
import { DisplayOptions } from '../../kernels/displayOptions';
import { executeSilently } from '../../kernels/helpers';
import { IKernel, IKernelProvider } from '../../kernels/types';
import { concatMultilineString } from '../../platform/common/utils';
import { IFileSystem } from '../../platform/common/platform/types';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { ExportUtilBase } from './exportUtil';
import { ExportFormat, IExportBase, IExportDialog, INbConvertExport } from './types';
import { traceLog } from '../../platform/logging';
import { reportAction } from '../../platform/progress/decorator';
import { ReportableAction } from '../../platform/progress/types';
import { SessionDisposedError } from '../../platform/errors/sessionDisposedError';

/**
 * Base class for exporting on web. Uses the kernel to perform the export and then translates the blob sent back to a file.
 */
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
        _target: Uri,
        _interpreter: PythonEnvironment,
        _token: CancellationToken
    ): Promise<void> {
        return undefined;
    }

    @reportAction(ReportableAction.PerformingExport)
    async executeCommand(
        sourceDocument: NotebookDocument,
        target: Uri,
        format: ExportFormat,
        _interpreter: PythonEnvironment,
        _token: CancellationToken
    ): Promise<void> {
        const kernel = this.kernelProvider.get(sourceDocument);
        if (!kernel) {
            // trace error
            return;
        }

        if (!kernel.session) {
            await kernel.start(new DisplayOptions(false));
        }

        if (!kernel.session?.kernel) {
            return;
        }

        if (kernel.session!.isServerSession()) {
            const session = kernel.session;
            const kernelConnection = kernel.session.kernel;
            let contents = await this.exportUtil.getContent(sourceDocument);

            let fileExt = '';

            switch (format) {
                case ExportFormat.html:
                    fileExt = '.html';
                    break;
                case ExportFormat.pdf:
                    fileExt = '.pdf';
                    break;
                case ExportFormat.python:
                    fileExt = '.py';
                    break;
            }

            await kernel.session!.invokeWithFileSynced(contents, async (file) => {
                const pwd = await this.getCWD(kernel);
                const filePath = `${pwd}/${file.filePath}`;
                const tempTarget = await session.createTempfile(fileExt);
                const outputs = await executeSilently(
                    kernelConnection,
                    `!jupyter nbconvert ${filePath} --to ${format} --output ${path.basename(tempTarget)}`
                );

                const text = this.parseStreamOutput(outputs);
                if (this.isExportFailed(text)) {
                    throw new Error(text || `Failed to export to ${format}`);
                } else if (text) {
                    // trace the output in case we didn't identify all errors
                    traceLog(text);
                }

                if (format === ExportFormat.pdf) {
                    const content = await session.getContents(tempTarget, 'base64');
                    const bytes = this.b64toBlob(content.content, 'application/pdf');
                    const buffer = await bytes.arrayBuffer();
                    await this.fs.writeFile(target!, Buffer.from(buffer));
                    await session.deleteTempfile(tempTarget);
                } else {
                    const content = await session.getContents(tempTarget, 'text');
                    await this.fs.writeFile(target!, content.content as string);
                    await session.deleteTempfile(tempTarget);
                }
            });

            return;
        } else {
            // no op
        }
    }

    private b64toBlob(b64Data: string, contentType: string | undefined) {
        contentType = contentType || '';
        const sliceSize = 512;
        b64Data = b64Data.replace(/^[^,]+,/, '');
        b64Data = b64Data.replace(/\s/g, '');
        const byteCharacters = atob(b64Data);
        let byteArrays = [];

        for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
            const slice = byteCharacters.slice(offset, offset + sliceSize);

            let byteNumbers = new Array(slice.length);
            for (let i = 0; i < slice.length; i++) {
                byteNumbers[i] = slice.charCodeAt(i);
            }

            const byteArray = new Uint8Array(byteNumbers);
            byteArrays.push(byteArray);
        }

        const blob = new Blob(byteArrays, { type: contentType });
        return blob;
    }

    private isExportFailed(message: string | undefined) {
        if (!message) {
            return true;
        }

        return /Traceback \(most recent call last\)/g.exec(message);
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

    private async getCWD(kernel: IKernel) {
        if (!kernel.session?.kernel) {
            throw new SessionDisposedError();
        }
        const outputs = await executeSilently(kernel.session.kernel, `import os;os.getcwd();`);
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
