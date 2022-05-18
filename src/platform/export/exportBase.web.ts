// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as nbformat from '@jupyterlab/nbformat';
import { inject, injectable } from 'inversify';
import { Uri, CancellationToken, NotebookDocument } from 'vscode';
import { DisplayOptions } from '../../kernels/displayOptions';
import { executeSilently } from '../../kernels/helpers';
import { IKernel, IKernelProvider } from '../../kernels/types';
import { concatMultilineString } from '../../webviews/webview-side/common';
import { IFileSystem } from '../common/platform/types';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { ExportUtilBase } from './exportUtil';
import { ExportFormat, IExportBase, INbConvertExport } from './types';

@injectable()
export class ExportBase implements INbConvertExport, IExportBase {
    constructor(
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(ExportUtilBase) protected readonly exportUtil: ExportUtilBase
    ) {}

    public async export(
        _sourceDocument: NotebookDocument,
        _target: Uri,
        _interpreter: PythonEnvironment,
        _token: CancellationToken
        // eslint-disable-next-line no-empty,@typescript-eslint/no-empty-function
    ): Promise<void> {}

    // @reportAction(ReportableAction.PerformingExport)
    async executeCommand(
        sourceDocument: NotebookDocument,
        target: Uri,
        _format: ExportFormat,
        _interpreter: PythonEnvironment,
        _token: CancellationToken
    ): Promise<void> {
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
            let contents = await this.exportUtil.getContent(sourceDocument);

            await kernel.session!.invokeWithFileSynced(contents, async (file) => {
                const pwd = await this.getCWD(kernel);
                console.log(pwd);

                const filePath = `${pwd}/${file.filePath}`;

                const outputs = await executeSilently(
                    kernel.session!,
                    `!jupyter nbconvert ${filePath} --to html --stdout`
                );

                if (outputs.length === 0) {
                    return;
                }

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const output: nbformat.IStream = outputs[0] as any;
                if (output.name !== 'stdout' && output.output_type !== 'stream') {
                    return;
                }

                const text = concatMultilineString(output.text).trim().toLowerCase();
                const headerRemoved = text
                    .split(/\r\n|\r|\n/g)
                    .slice(1)
                    .join('\n');

                await this.fs.writeFile(target, headerRemoved);
            });
        } else {
            // no op
        }
    }

    private async getCWD(kernel: IKernel) {
        const outputs = await executeSilently(kernel.session!, `import os;os.getcwd();`);
        if (outputs.length === 0) {
            return;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const output: nbformat.IExecuteResult = outputs[0] as any;
        if (output.output_type !== 'execute_result') {
            return undefined;
        }

        return output.data['text/plain'];
    }
}
