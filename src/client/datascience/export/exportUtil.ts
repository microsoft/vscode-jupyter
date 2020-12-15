import { nbformat } from '@jupyterlab/coreutils';
import { inject, injectable } from 'inversify';
import * as os from 'os';
import * as path from 'path';
import * as uuid from 'uuid/v4';
import { Uri } from 'vscode';
import { IFileSystem, TemporaryDirectory } from '../../common/platform/types';
import { sleep } from '../../common/utils/async';
import { INotebookStorage } from '../types';

@injectable()
export class ExportUtil {
    constructor(
        @inject(IFileSystem) private fs: IFileSystem,
        @inject(INotebookStorage) private notebookStorage: INotebookStorage
    ) {}

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

    public async removeSvgs(source: Uri) {
        const model = await this.notebookStorage.getOrCreateModel({ file: source });
        const content = JSON.parse(model.getContent()) as nbformat.INotebookContent;
        for (const cell of content.cells) {
            const outputs = cell.outputs as nbformat.IOutput[];
            if (Array.isArray(outputs)) {
                this.removeSvgFromOutputs(outputs);
            }
        }
        await this.fs.writeFile(source, JSON.stringify(content, undefined, model.indentAmount));
        model.dispose(); // We're modifying the JSON in file manually, hence blow away cached model.
    }

    private removeSvgFromOutputs(outputs: nbformat.IOutput[]) {
        const SVG = 'image/svg+xml';
        const PNG = 'image/png';
        for (const output of outputs as nbformat.IOutput[]) {
            if (output.data as nbformat.IMimeBundle) {
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
