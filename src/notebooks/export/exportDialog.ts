// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import * as path from '../../platform/vscode-path/path';
import { SaveDialogOptions, Uri } from 'vscode';
import { IApplicationShell, IWorkspaceService } from '../../platform/common/application/types';
import * as localize from '../../platform/common/utils/localize';
import { ExportFormat, IExportDialog } from './types';
import { IsWebExtension } from '../../platform/common/types';

// File extensions for each export method
export const PDFExtensions = { PDF: ['pdf'] };
export const HTMLExtensions = { HTML: ['html', 'htm'] };
export const PythonExtensions = { Python: ['py'] };

/**
 * UI for exporting a notebook to a file.
 */
@injectable()
export class ExportDialog implements IExportDialog {
    constructor(
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IWorkspaceService) private workspaceService: IWorkspaceService,
        @inject(IsWebExtension) private readonly isWebExtension: boolean
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
                const filtersKey = localize.DataScience.exportDialogFilter;
                fileExtensions[filtersKey] = ['ipynb'];
                break;

            default:
                return;
        }

        const targetFileName =
            defaultFileName || !source
                ? defaultFileName || ''
                : `${path.basename(source.path, path.extname(source.path))}${extension}`;

        const options: SaveDialogOptions = {
            defaultUri: await this.getDefaultUri(source, targetFileName),
            saveLabel: localize.DataScience.exportButtonTitle,
            filters: fileExtensions
        };

        return this.applicationShell.showSaveDialog(options);
    }

    private async getDefaultUri(source: Uri | undefined, targetFileName: string): Promise<Uri | undefined> {
        if (source && source.scheme === 'untitled' && this.isWebExtension) {
            // Force using simple file dialog
            return undefined;
        }

        if (
            !source ||
            source.scheme === 'file' ||
            source.scheme === 'untitled' ||
            source.scheme === 'vscode-interactive'
        ) {
            // Just combine the working directory with the file
            return Uri.file(path.join(await this.workspaceService.computeWorkingDirectory(source), targetFileName));
        }

        // Otherwise split off the end of the path and combine it with the target file name
        const newPath = path.join(path.dirname(source.path), targetFileName);
        return Uri.parse(`${source.scheme}://${newPath}`).with({ authority: source.authority });
    }
}
