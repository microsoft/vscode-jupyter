// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from '../../platform/vscode-path/path';
import { SaveDialogOptions, Uri, window } from 'vscode';
import { IWorkspaceService } from '../../platform/common/application/types';
import * as localize from '../../platform/common/utils/localize';
import { ExportFormat } from './types';
import { IsWebExtension } from '../../platform/common/types';
import { ServiceContainer } from '../../platform/ioc/container';

// File extensions for each export method
export const PDFExtensions = { PDF: ['pdf'] };
export const HTMLExtensions = { HTML: ['html', 'htm'] };
export const PythonExtensions = { Python: ['py'] };

/**
 * UI for exporting a notebook to a file.
 */
export class ExportDialog {
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

        return window.showSaveDialog(options);
    }

    private async getDefaultUri(source: Uri | undefined, targetFileName: string): Promise<Uri | undefined> {
        const isWebExtension = ServiceContainer.instance.get<boolean>(IsWebExtension);
        if (source && source.scheme === 'untitled' && isWebExtension) {
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
            const workspaceService = ServiceContainer.instance.get<IWorkspaceService>(IWorkspaceService);
            return Uri.file(path.join(await workspaceService.computeWorkingDirectory(source), targetFileName));
        }

        // Otherwise split off the end of the path and combine it with the target file name
        const newPath = path.join(path.dirname(source.path), targetFileName);
        return Uri.parse(`${source.scheme}://${newPath}`).with({ authority: source.authority });
    }
}
