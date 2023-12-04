// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable, inject } from 'inversify';
import * as os from 'os';
import * as vscode from 'vscode';
import type * as lspConcat from '@vscode/lsp-notebook-concat';
import type * as protocol from 'vscode-languageserver-protocol';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { ICommandManager } from '../../platform/common/application/types';
import { PYTHON_LANGUAGE, NOTEBOOK_SELECTOR, Commands, EditorContexts } from '../../platform/common/constants';
import { ContextKey } from '../../platform/common/contextKey';
import { traceInfo } from '../../platform/logging';
import { IDisposableRegistry, IConfigurationService } from '../../platform/common/types';
import { sleep, waitForCondition } from '../../platform/common/utils/async';
import { noop, swallowExceptions } from '../../platform/common/utils/misc';
import { IFileSystem } from '../../platform/common/platform/types';
import { window } from 'vscode';

/**
 * Class used to replay pylance log output to regenerate a series of edits.
 *
 * To use this
 * - Have customer do a bunch of edits with these settings active:
 *   "notebook-intellisense.logLevel": "Trace"
 *   "notebook-intellisense.trace.server.verbosity": "Verbose",
 * - Save output of the 'language server' trace (should have the same name as the kernel)
 * - Run "Jupyter (dev): Replay pylance log" and pick the output file
 * - Click on the 'Step Pylance Log' button that appears
 *
 * Note:
 * There may be bugs with
 * - Creating new cells
 * - Deleting tabs (seems to only delete a single space)
 */
@injectable()
export class LogReplayService implements IExtensionSyncActivationService {
    private steps: protocol.DidChangeTextDocumentParams[] = [];
    private index = -1;
    private converter: lspConcat.NotebookConverter | undefined;
    private activeNotebook: vscode.NotebookDocument | undefined;
    private isLogActive: ContextKey | undefined;
    constructor(
        @inject(ICommandManager) private readonly commandService: ICommandManager,
        @inject(IDisposableRegistry) private readonly disposableRegistry: IDisposableRegistry,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IConfigurationService) private readonly configService: IConfigurationService
    ) {}
    public activate() {
        this.disposableRegistry.push(
            this.commandService.registerCommand(Commands.ReplayPylanceLog, this.replayPylanceLog, this)
        );
        this.disposableRegistry.push(
            this.commandService.registerCommand(Commands.ReplayPylanceLogStep, this.step, this)
        );
        this.isLogActive = new ContextKey(EditorContexts.ReplayLogLoaded, this.commandService);
        this.isLogActive.set(false).then(noop, noop);
    }

    private async replayPylanceLog() {
        if (vscode.window.activeNotebookEditor) {
            const file = await window.showOpenDialog({ title: 'Open Pylance Output Log' });
            if (file && file.length === 1) {
                this.activeNotebook = vscode.window.activeNotebookEditor.notebook;
                this.steps = await this.parsePylanceLogSteps(file[0].fsPath);
                this.index = -1;
                void this.isLogActive?.set(true);
            }
        } else {
            vscode.window.showErrorMessage(`Command should be run with a jupyter notebook open`).then(noop, noop);
        }
    }

    private async step() {
        if (
            this.steps.length - 1 > this.index &&
            this.steps.length > 0 &&
            this.activeNotebook === vscode.window.activeNotebookEditor?.notebook &&
            this.activeNotebook
        ) {
            window.showInformationMessage(`Replaying step ${this.index + 2} of ${this.steps.length}`).then(noop, noop);

            // Move to next step
            this.index += 1;
            let step = this.steps[this.index];
            let change: {
                range: protocol.Range;
                rangeLength: number;
                text: string;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } = step.contentChanges[0] as any;

            // Convert the change if necessary
            if (step.textDocument.uri.includes('_NotebookConcat_') && this.activeNotebook) {
                const converter = await this.getConverter();
                step.textDocument.uri = converter!
                    .getConcatDocument(this.activeNotebook.cellAt(0).document.uri.toString())
                    .concatUri?.toString();

                // Apply the change to our concat document
                if (converter) {
                    const originalChange: protocol.DidChangeTextDocumentParams = {
                        textDocument: {
                            version: step.textDocument.version,
                            uri: converter.toNotebookUri(step.textDocument.uri, change.range)
                        },
                        contentChanges: [
                            {
                                text: change.text,
                                range: converter.toNotebookRange(step.textDocument.uri, change.range),
                                rangeLength: change.rangeLength
                            }
                        ]
                    };

                    // Original change may be a replace for an entire cell. This happens when the user edits
                    // a line with a magic in it
                    if (change.text.startsWith(`import IPython\nIPython.get_ipython()\n`)) {
                        // Just replace the entire cell contents.
                        const newContents = change.text
                            .slice(`import IPython\nIPython.get_ipython()\n`.length)
                            .replace(` # type: ignore`, '');
                        const entireCell = this.activeNotebook
                            .getCells()
                            .find((c) => originalChange.textDocument.uri === c.document.uri.toString());
                        if (entireCell) {
                            originalChange.contentChanges = [
                                {
                                    text: newContents,
                                    range: new vscode.Range(
                                        new vscode.Position(0, 0),
                                        new vscode.Position(entireCell.document.lineCount, 0)
                                    ),
                                    rangeLength: entireCell.document.getText().length
                                }
                            ];
                        }
                    }

                    // Apply the original change to our concat document
                    converter.handleChange(originalChange);

                    // Change our step to the modified one (so we can apply it correctly to the real notebook)
                    step = originalChange;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    change = originalChange.contentChanges[0] as any;
                }
            } else {
                // Should be real pylance handling the result. Convert the cell into our active notebook. Really just need the fragment part for the cell
                // uri
                const fragment = /(#ch\d+)/.exec(step.textDocument.uri);
                const replaced =
                    fragment != null && fragment.length > 1
                        ? this.activeNotebook
                              .cellAt(0)
                              .document.uri.toString()
                              .replace(/(#ch\d+)/, fragment[1])
                        : step.textDocument.uri;
                step.textDocument.uri = replaced;
            }

            traceInfo(`*** Replaying step: ${JSON.stringify(step, undefined, '  ')}`);

            // Find the associated cell in the real notebook
            let cell = this.activeNotebook?.getCells().find((c) => c.document.uri.toString() === step.textDocument.uri);
            if (!cell) {
                // Cell doesn't exist yet, create it
                const index = this.activeNotebook.cellCount;
                const edit = new vscode.WorkspaceEdit();
                const cellData = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, '', PYTHON_LANGUAGE);
                cellData.outputs = [];
                cellData.metadata = {};
                const nbEdit = vscode.NotebookEdit.insertCells(index, [cellData]);
                edit.set(this.activeNotebook.uri, [nbEdit]);
                await vscode.workspace.applyEdit(edit);
                cell = this.activeNotebook.cellAt(this.activeNotebook.cellCount - 1);
            }

            // Reveal the cell (this should force the editor to become visible)
            const notebookRange = new vscode.NotebookRange(cell.index, cell.index + 1);
            vscode.window.activeNotebookEditor?.revealRange(
                notebookRange,
                vscode.NotebookEditorRevealType.InCenterIfOutsideViewport
            );

            // Wait for editor to show up
            await waitForCondition(
                async () => {
                    return vscode.window.visibleTextEditors.find((e) => e.document === cell!.document) !== undefined;
                },
                3000,
                10
            );
            // Find the associated document and apply the edit
            const editor = vscode.window.visibleTextEditors.find((e) => e.document === cell!.document);
            if (editor) {
                const vscodeRange = new vscode.Range(
                    new vscode.Position(change.range.start.line, change.range.start.character),
                    new vscode.Position(change.range.end.line, change.range.end.character)
                );

                // Jump to this range so we can see the edit happen
                editor.revealRange(vscodeRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
                editor.selection = new vscode.Selection(vscodeRange.start, vscodeRange.start);

                await sleep(100);

                // Then do the actual edit
                await editor.edit((b) => {
                    if (change.text == '') {
                        // This is a delete
                        b.delete(vscodeRange);
                    } else if (change.rangeLength > 0) {
                        // This is a replace
                        b.replace(vscodeRange, change.text);
                    } else {
                        b.insert(vscodeRange.start, change.text);
                    }
                });
            }
            if (this.steps.length === this.index) {
                swallowExceptions(() => this.isLogActive?.set(false));
                this.steps = [];
                this.index = -1;
            }
        } else if (
            this.activeNotebook?.toString() !== vscode.window.activeNotebookEditor?.notebook.uri.toString() &&
            this.index < this.steps.length - 1
        ) {
            window
                .showErrorMessage(`You changed the notebook editor in the middle of stepping through the log`)
                .then(noop, noop);
        }
    }

    private async parsePylanceLogSteps(fileName: string) {
        const contents = await this.fs.readFile(vscode.Uri.file(fileName));
        const results: protocol.DidChangeTextDocumentParams[] = [];
        const regex = /textDocument\/didChange'[\s\S]*?Params:\s(?<json_event>[\s\S]*?\n\})/g;

        // Split into textDocument/change groups
        let match: RegExpExecArray | null = null;
        while ((match = regex.exec(contents)) != null) {
            // This is necessary to avoid infinite loops with zero-width matches
            if (match.index === regex.lastIndex) {
                regex.lastIndex++;
            }
            if (match.groups && match.groups['json_event']) {
                const json = JSON.parse(match.groups['json_event']);

                // Json should already be a TextDocumentChangeEvent
                results.push(json);
            }
        }

        return results;
    }

    private getNotebookHeader(uri: vscode.Uri) {
        const settings = this.configService.getSettings(uri);
        // Run any startup commands that we specified. Support the old form too
        let setting = settings.runStartupCommands;

        // Convert to string in case we get an array of startup commands.
        if (Array.isArray(setting)) {
            setting = setting.join(`\n`);
        }

        if (setting) {
            // Cleanup the line feeds. User may have typed them into the settings UI so they will have an extra \\ on the front.
            return setting.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
        }
        return '';
    }

    private async getConverter() {
        if (!this.converter && this.activeNotebook) {
            const { createConverter } = await import('@vscode/lsp-notebook-concat');
            const converter = createConverter(
                (_u) => this.getNotebookHeader(this.activeNotebook!.uri),
                () => os.platform()
            );
            this.activeNotebook
                .getCells()
                .filter((c) => vscode.languages.match(NOTEBOOK_SELECTOR, c.document) > 0)
                .forEach((c) => {
                    converter.handleOpen({
                        textDocument: {
                            uri: c.document.uri.toString(),
                            text: c.document.getText(),
                            languageId: c.document.languageId,
                            version: c.document.version
                        }
                    });
                });

            this.converter = converter;
        }
        return this.converter;
    }
}
