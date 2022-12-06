// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type * as nbformat from '@jupyterlab/nbformat';
import { inject, injectable } from 'inversify';
import * as os from 'os';
import * as path from '../../platform/vscode-path/path';
import uuid from 'uuid/v4';
import { TemporaryDirectory } from '../../platform/common/platform/types';
import { IFileSystemNode } from '../../platform/common/platform/types.node';
import { sleep } from '../../platform/common/utils/async';
import { ExportUtilBase } from './exportUtil';
import { IExtensions } from '../../platform/common/types';
import { ExportFormat, IExportDialog } from './types';
import { Uri } from 'vscode';
import { getFilePath } from '../../platform/common/platform/fs-paths';

/**
 * Export utilities that only work in node
 */
@injectable()
export class ExportUtil extends ExportUtilBase {
    constructor(
        @inject(IFileSystemNode) private fs: IFileSystemNode,
        @inject(IExtensions) extensions: IExtensions,
        @inject(IExportDialog) filePicker: IExportDialog
    ) {
        super(extensions, filePicker);
    }

    public async generateTempDir(): Promise<TemporaryDirectory> {
        const resultDir = Uri.file(path.join(os.tmpdir(), uuid()));
        await this.fs.createDirectory(resultDir);

        return {
            path: getFilePath(resultDir),
            dispose: async () => {
                // Try ten times. Process may still be up and running.
                // We don't want to do async as async dispose means it may never finish and then we don't
                // delete
                let count = 0;
                while (count < 10) {
                    try {
                        await this.fs.delete(resultDir);
                        count = 10;
                    } catch {
                        await sleep(3000);
                        count += 1;
                    }
                }
            }
        };
    }

    override async getTargetFile(
        format: ExportFormat,
        source: Uri,
        defaultFileName?: string | undefined
    ): Promise<Uri | undefined> {
        let target;

        if (format !== ExportFormat.python) {
            target = await this.filePicker.showDialog(format, source, defaultFileName);
        } else {
            target = Uri.file((await this.fs.createTemporaryLocalFile('.py')).filePath);
        }

        return target;
    }

    public async makeFileInDirectory(contents: string, fileName: string, dirPath: string): Promise<string> {
        const newFilePath = path.join(dirPath, fileName);

        await this.fs.writeFile(Uri.file(newFilePath), contents);

        return newFilePath;
    }

    public async removeSvgs(model: string) {
        const content = JSON.parse(model) as nbformat.INotebookContent;
        for (const cell of content.cells) {
            const outputs = 'outputs' in cell ? (cell.outputs as nbformat.IOutput[]) : undefined;
            if (outputs && Array.isArray(outputs)) {
                this.removeSvgFromOutputs(outputs);
            }
        }
        return JSON.stringify(content, undefined, 4);
    }

    private removeSvgFromOutputs(outputs: nbformat.IOutput[]) {
        const SVG = 'image/svg+xml';
        const PNG = 'image/png';
        for (const output of outputs as nbformat.IOutput[]) {
            if ('data' in output) {
                const data = output.data as nbformat.IMimeBundle;
                // only remove the svg if there is a png available
                if (!(SVG in data)) {
                    continue;
                }
                if (PNG in data) {
                    delete data[SVG];
                }
            }
        }
    }
}
