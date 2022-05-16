// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { CancellationToken, NotebookCell, NotebookCellKind, NotebookDocument, Uri } from 'vscode';
import { appendLineFeed } from '../../webviews/webview-side/common';
import { IFileSystem } from '../common/platform/types';
import { IConfigurationService } from '../common/types';
import { IExport } from './types';

// Handles exporting a NotebookDocument to python
export class ExportToPythonPlainBase implements IExport {
    public constructor(
        private readonly fs: IFileSystem,

        protected readonly configuration: IConfigurationService
    ) {}

    async writeFile(target: Uri, contents: string): Promise<void> {
        await this.fs.writeFile(target, contents);
    }

    getEOL(): string {
        return '\n';
    }

    // Export the given document to the target source file
    public async export(sourceDocument: NotebookDocument, target: Uri, token: CancellationToken): Promise<void> {
        if (token.isCancellationRequested) {
            return;
        }

        const contents = this.exportDocument(sourceDocument);
        await this.writeFile(target, contents);
    }

    // Convert an entire NotebookDocument to a single string
    private exportDocument(document: NotebookDocument): string {
        return document
            .getCells()
            .filter((cell) => !cell.metadata.isInteractiveWindowMessageCell) // We don't want interactive window sys info cells
            .reduce((previousValue, currentValue) => previousValue + this.exportCell(currentValue), '');
    }

    // Convert one NotebookCell to a string, created a cell marker for it
    private exportCell(cell: NotebookCell): string {
        if (cell.document.lineCount) {
            const cellMarker = this.cellMarker(cell);
            const eol = this.getEOL();

            switch (cell.kind) {
                case NotebookCellKind.Code:
                    return `${cellMarker}${eol}${this.exportCodeCell(cell)}${eol}${eol}`;
                case NotebookCellKind.Markup:
                    return `${cellMarker} [markdown]${eol}${this.exportMarkdownCell(cell)}${eol}${eol}`;
            }
        }

        return '';
    }

    // Convert one Code cell to a string
    private exportCodeCell(cell: NotebookCell): string {
        let code = cell.document.getText().splitLines({ trim: false, removeEmptyEntries: false });

        // Check to see if we should comment out Shell / Magic commands
        const commentMagic = this.configuration.getSettings(cell.notebook.uri).pythonExportMethod === 'commentMagics';

        return appendLineFeed(code, this.getEOL(), commentMagic ? commentMagicCommands : undefined).join('');
    }

    // Convert one Markup cell to a string
    private exportMarkdownCell(cell: NotebookCell): string {
        let code = cell.document.getText().splitLines({ trim: false, removeEmptyEntries: false });

        // Comment out lines of markdown cells
        return appendLineFeed(code, this.getEOL(), commentLine).join('');
    }

    // Determine the cell marker for a notebook cell, if it's in the metadata use that
    // if not use the default setting
    private cellMarker(cell: NotebookCell): string {
        const settings = this.configuration.getSettings(cell.notebook.uri);
        return cell.metadata.interactiveWindowCellMarker ?? settings.defaultCellMarker;
    }
}

// Comment out lines starting with !, % or %% for shell commands
// and line and cell magics
function commentMagicCommands(line: string): string {
    if (/^\s*!/.test(line) || /^\s*%/.test(line)) {
        return `# ${line}`;
    } else {
        return line;
    }
}

// Comment out all lines
function commentLine(line: string): string {
    return `# ${line}`;
}
