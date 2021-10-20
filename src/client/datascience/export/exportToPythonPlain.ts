import { inject, injectable } from 'inversify';
import { CancellationToken, NotebookCell, NotebookDocument, Uri } from 'vscode';
import { IFileSystem } from '../../common/platform/types';
import { IExport } from './types';

// Handles exporting a NotebookDocument to python
@injectable()
export class ExportToPythonPlain implements IExport {
    public constructor(@inject(IFileSystem) private readonly fs: IFileSystem) {}

    public async export(sourceDocument: NotebookDocument, target: Uri, token: CancellationToken): Promise<void> {
        if (token.isCancellationRequested) {
            return;
        }

        const contents = this.exportDocument(sourceDocument);

        await this.fs.writeFile(target, contents);
    }

    private exportDocument(document: NotebookDocument): string {
        return document
            .getCells()
            .reduce((previousValue, currentValue) => previousValue + this.exportCell(currentValue), '');
    }

    private exportCell(_cell: NotebookCell): string {
        return 'testing\n\r';
    }
}
