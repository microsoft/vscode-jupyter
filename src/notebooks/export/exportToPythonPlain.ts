// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken, NotebookCell, NotebookCellKind, NotebookDocument, Uri } from 'vscode';
import { splitLines } from '../../platform/common/helpers';
import { IFileSystem, IPlatformService } from '../../platform/common/platform/types';
import { IConfigurationService } from '../../platform/common/types';
import { appendLineFeed } from '../../platform/common/utils';
import { IExport } from './types';
import { ServiceContainer } from '../../platform/ioc/container';

// Handles exporting a NotebookDocument to python without using nbconvert
export class ExportToPythonPlain implements IExport {
    private readonly fs: IFileSystem;
    private readonly configuration: IConfigurationService;
    private platform: IPlatformService;
    private readonly eol: string;
    constructor() {
        this.fs = ServiceContainer.instance.get<IFileSystem>(IFileSystem);
        this.configuration = ServiceContainer.instance.get<IConfigurationService>(IConfigurationService);
        this.platform = ServiceContainer.instance.get<IPlatformService>(IPlatformService);
        this.eol = this.platform.isWindows ? '\r\n' : '\n';
    }

    async writeFile(target: Uri, contents: string): Promise<void> {
        await this.fs.writeFile(target, contents);
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
        const cells = document.getCells();
        return document
            .getCells()
            .filter((cell) => !cell.metadata?.isInteractiveWindowMessageCell) // We don't want interactive window sys info cells
            .reduce((previousValue, currentValue, index) => {
                const cell = this.exportCell(currentValue);
                // No need to add trailing empty lines for the last cell.
                // Else we end up with an exported file containing empty lines at the end.
                if (index === cells.length - 1) {
                    return previousValue + cell;
                } else {
                    return previousValue + cell + `${this.eol}${this.eol}`;
                }
            }, '');
    }

    // Convert one NotebookCell to a string, created a cell marker for it
    private exportCell(cell: NotebookCell): string {
        if (cell.document.lineCount) {
            const cellMarker = this.cellMarker(cell);
            switch (cell.kind) {
                case NotebookCellKind.Code:
                    return `${cellMarker}${this.eol}${this.exportCodeCell(cell)}`;
                case NotebookCellKind.Markup:
                    return `${cellMarker} [markdown]${this.eol}${this.exportMarkdownCell(cell)}`;
            }
        }

        return '';
    }

    // Convert one Code cell to a string
    private exportCodeCell(cell: NotebookCell): string {
        let code = splitLines(cell.document.getText(), { trim: false, removeEmptyEntries: false });

        // Check to see if we should comment out Shell / Magic commands
        const commentMagic = this.configuration.getSettings(cell.notebook.uri).pythonExportMethod === 'commentMagics';

        return appendLineFeed(code, this.eol, commentMagic ? commentMagicCommands : undefined).join('');
    }

    // Convert one Markup cell to a string
    private exportMarkdownCell(cell: NotebookCell): string {
        let code = splitLines(cell.document.getText(), { trim: false, removeEmptyEntries: false });

        // Comment out lines of markdown cells
        return appendLineFeed(code, this.eol, commentLine).join('');
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
