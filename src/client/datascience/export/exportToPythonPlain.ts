import { inject, injectable } from 'inversify';
import { CancellationToken, NotebookDocument, Uri } from 'vscode';
import { IFileSystem } from '../../common/platform/types';
import { IExport } from './types';

// Handles exporting a NotebookDocument to python
@injectable()
export class ExportToPythonPlain implements IExport {
    public constructor(@inject(IFileSystem) private readonly fs: IFileSystem) {}

    public async export(_sourceDocument: NotebookDocument, target: Uri, token: CancellationToken): Promise<void> {
        if (token.isCancellationRequested) {
            return;
        }

        const contents = 'test';

        await this.fs.writeFile(target, contents);
    }
}
