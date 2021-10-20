import { inject, injectable } from 'inversify';
import { CancellationToken, NotebookCell, NotebookCellKind, NotebookDocument, Uri } from 'vscode';
import { appendLineFeed } from '../../../datascience-ui/common';
import { IFileSystem } from '../../common/platform/types';
import { IConfigurationService } from '../../common/types';
import { IExport } from './types';

// Handles exporting a NotebookDocument to python
@injectable()
export class ExportToPythonPlain implements IExport {
    public constructor(
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IConfigurationService) private readonly configuration: IConfigurationService
    ) {}

    public async export(sourceDocument: NotebookDocument, target: Uri, token: CancellationToken): Promise<void> {
        if (token.isCancellationRequested) {
            return;
        }

        const contents = this.exportDocument(sourceDocument);

        await this.fs.writeFile(target, contents);
    }

    // Convert an entire NotebookDocument to a single string
    private exportDocument(document: NotebookDocument): string {
        return document
            .getCells()
            .reduce((previousValue, currentValue) => previousValue + this.exportCell(currentValue), '');
    }

    // Convert one NotebookCell to a string, created a cell marker for it
    private exportCell(cell: NotebookCell): string {
        if (cell.document.lineCount) {
            const cellMarker = this.cellMarker(cell);
            let code = cell.document.getText().splitLines({ trim: false, removeEmptyEntries: false });

            // IANHU: Combine
            const results = appendLineFeed([cellMarker, ...code, '\n']).join('');
            return results;
        }

        return '';
    }

    // Determine the cell marker for a notebook cell, if it's in the metadata use that
    // if not use the default setting
    private cellMarker(cell: NotebookCell): string {
        const settings = this.configuration.getSettings(cell.notebook.uri);
        const marker = cell.metadata.interactiveWindowCellMarker ?? settings.defaultCellMarker;
        return cell.kind === NotebookCellKind.Code ? `${marker}` : `${marker} [markdown]`;
    }
}
