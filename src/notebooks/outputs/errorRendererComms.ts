// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import {
    commands,
    NotebookCell,
    NotebookEditor,
    NotebookRange,
    notebooks,
    Position,
    Range,
    Selection,
    TextEditorRevealType,
    Uri
} from 'vscode';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import {
    IDocumentManager,
    ICommandManager,
    IApplicationShell,
    IVSCodeNotebook
} from '../../platform/common/application/types';
import { IFileSystem } from '../../platform/common/platform/types';
import { IDisposableRegistry } from '../../platform/common/types';
import { InteractiveWindowMessages } from '../../messageTypes';
import { linkCommandAllowList, LineQueryRegex } from './linkProvider';

/**
 * Registers comm channel to the error renderer to handle link clicking
 */
@injectable()
export class ErrorRendererCommunicationHandler implements IExtensionSyncActivationService {
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IDocumentManager) private readonly documentManager: IDocumentManager,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IVSCodeNotebook) private readonly notebooks: IVSCodeNotebook
    ) {}

    activate(): void {
        const messageChannel = notebooks.createRendererMessaging('jupyter-error-renderer');
        messageChannel.onDidReceiveMessage(this.onDidReceiveMessage, this, this.disposables);
    }

    // Public for testing
    public async onDidReceiveMessage(e: {
        readonly editor: NotebookEditor;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        readonly message: any;
    }) {
        const message = e.message;
        if (message.message === InteractiveWindowMessages.OpenLink) {
            const href = message.payload;
            if (href.startsWith('file')) {
                await this.openFile(href);
            } else if (href.startsWith('vscode-notebook-cell')) {
                await this.openCell(href);
            } else if (href.startsWith('https://command:') || href.startsWith('command:')) {
                const temp: string = href.startsWith('https://command:') ? href.split(':')[2] : href.split(':')[1];
                const params: string[] = temp.includes('/?') ? temp.split('/?')[1].split(',') : [];
                let command = temp.split('/?')[0];
                if (command.endsWith('/')) {
                    command = command.substring(0, command.length - 1);
                }
                if (linkCommandAllowList.includes(command)) {
                    await commands.executeCommand(command, params);
                }
            } else {
                this.applicationShell.openUrl(href);
            }
        }
    }

    private async openFile(fileUri: string) {
        let uri = Uri.parse(fileUri);
        let selection: Range = new Range(new Position(0, 0), new Position(0, 0));
        if (uri.query) {
            // Might have a line number query on the file name
            const lineMatch = LineQueryRegex.exec(uri.query);
            if (lineMatch) {
                const lineNumber = parseInt(lineMatch[1], 10);
                selection = new Range(new Position(lineNumber, 0), new Position(lineNumber, 0));
            }
            uri = uri.with({ query: '' });
        }

        // Show the matching editor if there is one
        let editor = this.documentManager.visibleTextEditors.find((e) => this.fs.arePathsSame(e.document.uri, uri));
        if (editor) {
            return this.documentManager
                .showTextDocument(editor.document, { selection, viewColumn: editor.viewColumn, preserveFocus: false })
                .then((e) => {
                    e.revealRange(selection, TextEditorRevealType.InCenter);
                });
        } else {
            // Not a visible editor, try opening otherwise
            return this.commandManager.executeCommand('vscode.open', uri).then(() => {
                // See if that opened a text document
                editor = this.documentManager.visibleTextEditors.find((e) => this.fs.arePathsSame(e.document.uri, uri));
                if (editor) {
                    // Force the selection to change
                    editor.revealRange(selection);
                    editor.selection = new Selection(selection.start, selection.start);
                }
            });
        }
    }

    private async openCell(cellUri: string) {
        let selection: Range = new Range(new Position(0, 0), new Position(0, 0));
        // Might have a line number query on the fragment (URI doesn't seem to parse correctly)
        const lineMatch = LineQueryRegex.exec(cellUri);
        if (lineMatch) {
            const lineNumber = parseInt(lineMatch[1], 10);
            selection = new Range(new Position(lineNumber, 0), new Position(lineNumber, 0));
            cellUri = cellUri.slice(0, lineMatch.index - 1);
        }
        const uri = Uri.parse(cellUri);

        // Show the matching notebook if there is one
        let cell: NotebookCell | undefined;
        for (let i = 0; i < this.notebooks.notebookDocuments.length && !cell; i++) {
            cell = this.notebooks.notebookDocuments[i]
                .getCells()
                .find((c) => c.document.uri.toString() === uri.toString());
        }
        // If there is one, go to the cell that matches
        if (cell) {
            const cellRange = new NotebookRange(cell.index, cell.index);
            return this.notebooks
                .openNotebookDocument(cell.notebook.uri)
                .then((document) => this.notebooks.showNotebookDocument(document, { selections: [cellRange] }))
                .then((_e) => {
                    return this.commandManager.executeCommand('notebook.cell.edit').then(() => {
                        const cellEditor = this.documentManager.visibleTextEditors.find(
                            (v) => v.document.uri.toString() === cellUri
                        );
                        if (cellEditor) {
                            // Force the selection to change
                            cellEditor.revealRange(selection);
                            cellEditor.selection = new Selection(selection.start, selection.start);
                        }
                    });
                });
        }
    }
}
