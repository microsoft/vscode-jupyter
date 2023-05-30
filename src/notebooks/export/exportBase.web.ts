// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import uuid from 'uuid/v4';
import * as urlPath from '../../platform/vscode-path/resources';
import * as nbformat from '@jupyterlab/nbformat';
import { inject, injectable } from 'inversify';
import { Uri, CancellationToken, NotebookDocument } from 'vscode';
import * as path from '../../platform/vscode-path/path';
import { DisplayOptions } from '../../kernels/displayOptions';
import { executeSilently, jvscIdentifier } from '../../kernels/helpers';
import { IKernel, IKernelProvider, isRemoteConnection } from '../../kernels/types';
import { concatMultilineString } from '../../platform/common/utils';
import { IFileSystem } from '../../platform/common/platform/types';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { ExportUtilBase } from './exportUtil';
import { ExportFormat, IExportBase, IExportDialog, INbConvertExport } from './types';
import { traceLog } from '../../platform/logging';
import { reportAction } from '../../platform/progress/decorator';
import { ReportableAction } from '../../platform/progress/types';
import { Contents, ContentsManager } from '@jupyterlab/services';
import { IBackupFile } from '../../kernels/jupyter/types';
import { JupyterConnection } from '../../kernels/jupyter/connection/jupyterConnection';
import { noop } from '../../platform/common/utils/misc';
import { Resource } from '../../platform/common/types';
import { DataScience } from '../../platform/common/utils/localize';

/**
 * Base class for exporting on web. Uses the kernel to perform the export and then translates the blob sent back to a file.
 */
@injectable()
export class ExportBase implements INbConvertExport, IExportBase {
    constructor(
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IExportDialog) protected readonly filePicker: IExportDialog,
        @inject(ExportUtilBase) protected readonly exportUtil: ExportUtilBase,
        @inject(JupyterConnection) protected readonly connection: JupyterConnection
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

        if (!kernel.session || !isRemoteConnection(kernel.kernelConnectionMetadata)) {
            return;
        }

        const connection = await this.connection.createRemoveConnectionInfo(
            kernel.kernelConnectionMetadata.serverHandle
        );
        const contentManager = new ContentsManager({ serverSettings: connection.serverSettings });
        try {
            const session = kernel.session;
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

            await this.invokeWithFileSynced(contentManager, kernel.resourceUri, contents, async (file) => {
                const pwd = await this.getCWD(kernel);
                const filePath = `${pwd}/${file.filePath}`;
                const tempTarget = await contentManager.newUntitled({ type: 'file', ext: fileExt });
                const outputs = await executeSilently(
                    session,
                    `!jupyter nbconvert ${filePath} --to ${format} --output ${path.basename(tempTarget.path)}`
                );

                const text = this.parseStreamOutput(outputs);
                if (this.isExportFailed(text)) {
                    throw new Error(text || `Failed to export to ${format}`);
                } else if (text) {
                    // trace the output in case we didn't identify all errors
                    traceLog(text);
                }

                if (format === ExportFormat.pdf) {
                    const content = await contentManager.get(tempTarget.path, {
                        type: 'file',
                        format: 'base64',
                        content: true
                    });
                    const bytes = this.b64toBlob(content.content, 'application/pdf');
                    const buffer = await bytes.arrayBuffer();
                    await this.fs.writeFile(target!, Buffer.from(buffer));
                    await contentManager.delete(tempTarget.path);
                } else {
                    const content = await contentManager.get(tempTarget.path, {
                        type: 'file',
                        format: 'text',
                        content: true
                    });
                    await this.fs.writeFile(target!, content.content as string);
                    await contentManager.delete(tempTarget.path);
                }
            });
        } finally {
            contentManager.dispose();
        }
    }

    async invokeWithFileSynced(
        contentsManager: ContentsManager,
        resource: Resource,
        contents: string,
        handler: (file: IBackupFile) => Promise<void>
    ): Promise<void> {
        if (!resource) {
            return;
        }

        const backingFile = await this.createBackingFile(resource, contentsManager);

        await contentsManager
            .save(backingFile!.filePath, {
                content: JSON.parse(contents),
                type: 'notebook'
            })
            .catch(noop);

        await handler({
            filePath: backingFile.filePath,
            dispose: backingFile.dispose.bind(backingFile)
        });

        await backingFile.dispose();
        await contentsManager.delete(backingFile.filePath).catch(noop);
    }

    public async createBackingFile(
        resource: Uri,
        contentsManager: ContentsManager
    ): Promise<{ dispose: () => Promise<unknown>; filePath: string }> {
        // However jupyter does not support relative paths outside of the original root.
        const backingFileOptions: Contents.ICreateOptions = { type: 'notebook' };

        // Generate a more descriptive name
        const newName = generateBackingIPyNbFileName(resource);

        // Create a temporary notebook for this session. Each needs a unique name (otherwise we get the same session every time)
        let backingFile = await contentsManager.newUntitled(backingFileOptions);
        const backingFileDir = path.dirname(backingFile.path);
        backingFile = await contentsManager.rename(
            backingFile.path,
            backingFileDir.length && backingFileDir !== '.' ? `${backingFileDir}/${newName}` : newName // Note, the docs say the path uses UNIX delimiters.
        );

        const filePath = backingFile.path;
        return {
            filePath,
            dispose: () => contentsManager.delete(filePath)
        };
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
function getRemoteIPynbSuffix(): string {
    return `${jvscIdentifier}${uuid()}`;
}

function generateBackingIPyNbFileName(resource: Resource) {
    // Generate a more descriptive name
    const suffix = `${getRemoteIPynbSuffix()}${uuid()}.ipynb`;
    return resource
        ? `${urlPath.basename(resource, '.ipynb')}${suffix}`
        : `${DataScience.defaultNotebookName}${suffix}`;
}
