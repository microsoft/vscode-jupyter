import { inject, injectable } from 'inversify';
import * as path from 'path';
import { SaveDialogOptions, Uri } from 'vscode';

import { IApplicationShell, IWorkspaceService } from '../../common/application/types';
import * as localize from '../../common/utils/localize';
import { computeWorkingDirectory } from '../jupyter/jupyterUtils';
import { ExportFormat, IExportDialog } from './types';

// File extensions for each export method
export const PDFExtensions = { PDF: ['pdf'] };
export const HTMLExtensions = { HTML: ['html', 'htm'] };
export const PythonExtensions = { Python: ['py'] };

@injectable()
export class ExportDialog implements IExportDialog {
    constructor(
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IWorkspaceService) private workspaceService: IWorkspaceService
    ) {}

    public async showDialog(
        format: ExportFormat,
        source: Uri | undefined,
        defaultFileName?: string
    ): Promise<Uri | undefined> {
        // map each export method to a set of file extensions
        let fileExtensions: { [name: string]: string[] } = {};
        let extension: string | undefined;
        switch (format) {
            case ExportFormat.python:
                fileExtensions = PythonExtensions;
                extension = '.py';
                break;

            case ExportFormat.pdf:
                extension = '.pdf';
                fileExtensions = PDFExtensions;
                break;

            case ExportFormat.html:
                extension = '.html';
                fileExtensions = HTMLExtensions;
                break;

            case ExportFormat.ipynb:
                extension = '.ipynb';
                const filtersKey = localize.DataScience.exportDialogFilter();
                fileExtensions[filtersKey] = ['ipynb'];
                break;

            default:
                return;
        }

        const targetFileName =
            defaultFileName || !source
                ? defaultFileName || ''
                : `${path.basename(source.fsPath, path.extname(source.fsPath))}${extension}`;

        const options: SaveDialogOptions = {
            defaultUri: await this.getDefaultUri(source, targetFileName),
            saveLabel: localize.DataScience.exportButtonTitle(),
            filters: fileExtensions
        };

        return this.applicationShell.showSaveDialog(options);
    }

    private async getDefaultUri(source: Uri | undefined, targetFileName: string): Promise<Uri> {
        if (!source || source.scheme === 'file' || source.scheme === 'untitled') {
            // Just combine the working directory with the file
            return Uri.file(path.join(await computeWorkingDirectory(source, this.workspaceService), targetFileName));
        }

        // Otherwise split off the end of the path and combine it with the target file name
        const newPath = path.join(path.dirname(source.path), targetFileName);
        return Uri.parse(`${source.scheme}://${newPath}`);
    }
}
