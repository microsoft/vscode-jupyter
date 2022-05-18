import type * as nbformat from '@jupyterlab/nbformat';
import { inject, injectable } from 'inversify';
import * as os from 'os';
import * as path from '../../platform/vscode-path/path';
import * as uuid from 'uuid/v4';
import { TemporaryDirectory } from '../common/platform/types';
import { IFileSystemNode } from '../common/platform/types.node';
import { sleep } from '../common/utils/async';
import { ExportUtilBase } from './exportUtil';
import { IExtensions } from '../common/types';

@injectable()
export class ExportUtil extends ExportUtilBase {
    constructor(@inject(IFileSystemNode) private fs: IFileSystemNode, @inject(IExtensions) extensions: IExtensions) {
        super(extensions);
    }

    public async generateTempDir(): Promise<TemporaryDirectory> {
        const resultDir = path.join(os.tmpdir(), uuid());
        await this.fs.createLocalDirectory(resultDir);

        return {
            path: resultDir,
            dispose: async () => {
                // Try ten times. Process may still be up and running.
                // We don't want to do async as async dispose means it may never finish and then we don't
                // delete
                let count = 0;
                while (count < 10) {
                    try {
                        await this.fs.deleteLocalDirectory(resultDir);
                        count = 10;
                    } catch {
                        await sleep(3000);
                        count += 1;
                    }
                }
            }
        };
    }

    public async makeFileInDirectory(contents: string, fileName: string, dirPath: string): Promise<string> {
        const newFilePath = path.join(dirPath, fileName);

        await this.fs.writeLocalFile(newFilePath, contents);

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
