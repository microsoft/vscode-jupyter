// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type * as nbformat from '@jupyterlab/nbformat';
import { inject, injectable } from 'inversify';
import {
    CodeLens,
    commands,
    Event,
    EventEmitter,
    NotebookDocument,
    Position,
    Range,
    Selection,
    TextDocument,
    TextEditor,
    TextEditorRevealType,
    Uri,
    window,
    workspace
} from 'vscode';

import { ICellRange, IConfigurationService, IDisposable, Resource } from '../../platform/common/types';
import { isUri, noop } from '../../platform/common/utils/misc';
import { capturePerfTelemetry, captureUsageTelemetry, sendTelemetryEvent } from '../../telemetry';
import { ICodeExecutionHelper } from '../../platform/terminals/types';
import { InteractiveCellResultError } from '../../platform/errors/interactiveCellResultError';
import { Telemetry, Commands, Identifiers, InteractiveWindowView } from '../../platform/common/constants';
import { IInteractiveWindowProvider, IInteractiveWindow } from '../types';
import { CellMatcher } from './cellMatcher';
import { ICodeWatcher, ICodeLensFactory } from './types';
import { debugDecorator } from '../../platform/logging';
import { TraceOptions } from '../../platform/logging/types';
import * as urlPath from '../../platform/vscode-path/resources';
import { IDataScienceErrorHandler } from '../../kernels/errors/types';
import { dispose } from '../../platform/common/utils/lifecycle';
import { dedentCode } from '../../platform/common/helpers';

function getIndex(index: number, length: number): number {
    // return index within the length range with negative indexing
    if (length <= 0) {
        throw new RangeError(`Length must be > 0 not ${length}`);
    }
    // negative index count back from length
    if (index < 0) {
        index += length;
    }
    // bounded index
    if (index < 0) {
        return 0;
    } else if (index >= length) {
        return length - 1;
    } else {
        return index;
    }
}

/**
 * CodeWatchers watch source files, provide code lenses in them, and handle the execution of
 * the code lenses. Code lenses are provided by a CodeLensFactory.
 */
@injectable()
export class CodeWatcher implements ICodeWatcher {
    private document?: TextDocument;
    private version: number = -1;
    private codeLenses: CodeLens[] = [];
    private cells: ICellRange[] = [];
    private codeLensUpdatedEvent: EventEmitter<void> = new EventEmitter<void>();
    private disposables: IDisposable[] = [this.codeLensUpdatedEvent];

    constructor(
        @inject(IInteractiveWindowProvider) private interactiveWindowProvider: IInteractiveWindowProvider,
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(ICodeExecutionHelper) private executionHelper: ICodeExecutionHelper,
        @inject(IDataScienceErrorHandler) protected dataScienceErrorHandler: IDataScienceErrorHandler,
        @inject(ICodeLensFactory) private codeLensFactory: ICodeLensFactory
    ) {}

    public setDocument(document: TextDocument) {
        this.document = document;

        // Cache the version, we don't want to pull an old version if the document is updated
        this.version = document.version;

        // Use the factory to generate our new code lenses.
        this.codeLenses = this.codeLensFactory.createCodeLenses(document);
        this.cells = this.codeLensFactory.getCellRanges(document);

        // Listen for changes
        this.disposables.push(this.codeLensFactory.updateRequired(this.onCodeLensFactoryUpdated.bind(this)));

        // Make sure to stop listening for changes when this document closes.
        this.disposables.push(workspace.onDidCloseTextDocument(this.onDocumentClosed.bind(this)));

        // clean up goto code lenses when interactive windows close
        this.disposables.push(workspace.onDidCloseNotebookDocument(this.ondidCloseNotebook.bind(this)));
    }

    public get codeLensUpdated(): Event<void> {
        return this.codeLensUpdatedEvent.event;
    }

    public get uri() {
        return this.document?.uri;
    }

    public getVersion() {
        return this.version;
    }

    public getCodeLenses() {
        const document = this.document;
        if (document && document.version != this.version) {
            this.codeLenses = this.codeLensFactory.createCodeLenses(document);
            this.cells = this.codeLensFactory.getCellRanges(document);
            this.version = document.version;
        }
        return this.codeLenses;
    }

    @captureUsageTelemetry(Telemetry.DebugCurrentCell)
    public async debugCurrentCell() {
        if (!window.activeTextEditor || !window.activeTextEditor.document) {
            return;
        }

        // Run the cell that matches the current cursor position.
        return this.runMatchingCell(window.activeTextEditor.selection, false, true);
    }
    public dispose() {
        let perfMeasures = this.codeLensFactory.getPerfMeasures();
        if (perfMeasures && perfMeasures.codeLensUpdateCount > 0) {
            sendTelemetryEvent(Telemetry.DocumentWithCodeCells, {
                codeLensUpdateTime: perfMeasures.totalCodeLensUpdateTimeInMs / perfMeasures.codeLensUpdateCount,
                maxCellCount: perfMeasures.maxCellCount
            });
        }

        dispose(this.disposables);
    }

    @captureUsageTelemetry(Telemetry.RunAllCells)
    public async runAllCells(debug?: boolean) {
        const iw = await this.getActiveInteractiveWindow();
        const runCellCommands = this.codeLenses.filter(
            (c) =>
                c.command &&
                c.command.command === Commands.RunCell &&
                c.command.arguments &&
                c.command.arguments.length >= 5
        );
        let leftCount = runCellCommands.length;
        // Run all of our code lenses, they should always be ordered in the file so we can just
        // run them one by one
        let finished = Promise.resolve(true);
        for (const lens of runCellCommands) {
            // Make sure that we have the correct command (RunCell) lenses
            let range: Range = new Range(
                lens.command!.arguments![1],
                lens.command!.arguments![2],
                lens.command!.arguments![3],
                lens.command!.arguments![4]
            );
            if (this.document) {
                // Special case, if this is the first, expand our range to always include the top.
                if (leftCount === runCellCommands.length) {
                    range = new Range(new Position(0, 0), range.end);
                }

                const code = this.document.getText(range);
                leftCount -= 1;

                // Note: We do a get or create active before all addCode commands to make sure that we either have a history up already
                // or if we do not we need to start it up as these commands are all expected to start a new history if needed
                finished = this.addCode(iw, code, this.document.uri, range.start.line, debug);
            }
        }

        await finished;

        // If there are no codelenses, just run all of the code as a single cell
        if (runCellCommands.length === 0) {
            return this.runFileAsOneCell(debug ?? false);
        }
    }

    @captureUsageTelemetry(Telemetry.RunFileInteractive)
    public async runFileInteractive() {
        if (this.document && this.configService.getSettings(this.document?.uri).splitRunFileIntoCells) {
            return this.runAllCells();
        } else if (this.document) {
            return this.runFileAsOneCell(false);
        }
    }

    @captureUsageTelemetry(Telemetry.DebugFileInteractive)
    public async debugFileInteractive() {
        if (this.document && this.configService.getSettings(this.document?.uri).splitRunFileIntoCells) {
            return this.runAllCells(true);
        } else if (this.document) {
            return this.runFileAsOneCell(true);
        }
    }

    // Run all cells up to the cell containing this start line and character
    @captureUsageTelemetry(Telemetry.RunAllCellsAbove)
    public async runAllCellsAbove(stopLine: number, stopCharacter: number) {
        const iw = await this.getActiveInteractiveWindow();
        const runCellCommands = this.codeLenses.filter((c) => c.command && c.command.command === Commands.RunCell);
        let leftCount = runCellCommands.findIndex(
            (c) => c.range.start.line >= stopLine && c.range.start.character >= stopCharacter
        );
        if (leftCount < 0) {
            leftCount = runCellCommands.length;
        }
        const startCount = leftCount;

        // Run our code lenses up to this point, lenses are created in order on document load
        // so we can rely on them being in linear order for this
        let finished = Promise.resolve(true);
        for (const lens of runCellCommands) {
            // Make sure we are dealing with run cell based code lenses in case more types are added later
            if (leftCount > 0 && this.document) {
                let range: Range = new Range(lens.range.start, lens.range.end);

                // If this is the first, make sure it extends to the top
                if (leftCount === startCount) {
                    range = new Range(new Position(0, 0), range.end);
                }

                // We have a cell and we are not past or at the stop point
                leftCount -= 1;
                const code = this.document.getText(range);
                finished = this.addCode(iw, code, this.document.uri, lens.range.start.line);
            } else {
                // If we get a cell past or at the stop point stop
                break;
            }
        }

        await finished;
    }

    @captureUsageTelemetry(Telemetry.RunCellAndAllBelow)
    public async runCellAndAllBelow(startLine: number, startCharacter: number) {
        const iw = await this.getActiveInteractiveWindow();
        const runCellCommands = this.codeLenses.filter((c) => c.command && c.command.command === Commands.RunCell);
        const index = runCellCommands.findIndex(
            (c) => c.range.start.line >= startLine && c.range.start.character >= startCharacter
        );
        let leftCount = index > 0 ? runCellCommands.length - index : runCellCommands.length;

        // Run our code lenses from this point to the end, lenses are created in order on document load
        // so we can rely on them being in linear order for this
        let finished = Promise.resolve(true);
        for (let pos = index; pos >= 0 && pos < runCellCommands.length; pos += 1) {
            if (leftCount > 0 && this.document) {
                const lens = runCellCommands[pos];
                // We have a cell and we are not past or at the stop point
                leftCount -= 1;
                const code = this.document.getText(lens.range);
                finished = this.addCode(iw, code, this.document.uri, lens.range.start.line);
            }
        }

        await finished;
    }

    @captureUsageTelemetry(Telemetry.RunSelectionOrLine)
    public async runSelectionOrLine(activeEditor: TextEditor | undefined, text?: string | Uri) {
        if (this.document && activeEditor && urlPath.isEqual(activeEditor.document.uri, this.document.uri)) {
            const iw = await this.getActiveInteractiveWindow();
            let codeToExecute: string | undefined;
            if (text === undefined || isUri(text)) {
                // Get just the text of the selection or the current line if none
                codeToExecute = this.executionHelper.getSelectedTextToExecute(activeEditor);
            } else {
                codeToExecute = text;
            }
            if (!codeToExecute) {
                return;
            }

            const normalize =
                this.configService.getSettings(activeEditor.document.uri).normalizeSelectionForInteractiveWindow ??
                true;
            const normalizedCode = normalize
                ? await this.executionHelper.normalizeLines(codeToExecute!)
                : codeToExecute;
            if (!normalizedCode || normalizedCode.trim().length === 0) {
                return;
            }
            await this.addCode(iw, normalizedCode, this.document.uri, activeEditor.selection.start.line);
        }
    }

    @captureUsageTelemetry(Telemetry.RunToLine)
    public async runToLine(targetLine: number) {
        if (this.document && targetLine > 0) {
            const iw = await this.getActiveInteractiveWindow();
            const previousLine = this.document.lineAt(targetLine - 1);
            const code = this.document.getText(
                new Range(0, 0, previousLine.range.end.line, previousLine.range.end.character)
            );

            if (code && code.trim().length) {
                await this.addCode(iw, code, this.document.uri, 0);
            }
        }
    }

    @captureUsageTelemetry(Telemetry.RunFromLine)
    public async runFromLine(targetLine: number) {
        if (this.document && targetLine < this.document.lineCount) {
            const iw = await this.getActiveInteractiveWindow();
            const lastLine = this.document.lineAt(this.document.lineCount - 1);
            const code = this.document.getText(
                new Range(targetLine, 0, lastLine.range.end.line, lastLine.range.end.character)
            );

            if (code && code.trim().length) {
                await this.addCode(iw, code, this.document.uri, targetLine);
            }
        }
    }

    @debugDecorator('CodeWatcher::runCell', TraceOptions.BeforeCall)
    public async runCell(range: Range): Promise<void> {
        if (!window.activeTextEditor || !window.activeTextEditor.document) {
            return;
        }

        // Run the cell clicked. Advance if the cursor is inside this cell and we're allowed to.
        const advance =
            range.contains(window.activeTextEditor.selection.start) &&
            this.configService.getSettings(window.activeTextEditor.document.uri).enableAutoMoveToNextCell;
        return this.runMatchingCell(range, advance);
    }

    @captureUsageTelemetry(Telemetry.DebugCurrentCell)
    public async debugCell(range: Range): Promise<void> {
        if (!window.activeTextEditor || !window.activeTextEditor.document) {
            return;
        }

        // Debug the cell clicked.
        return this.runMatchingCell(range, false, true);
    }

    @captureUsageTelemetry(Telemetry.RunCurrentCell)
    public async runCurrentCell(): Promise<void> {
        if (!window.activeTextEditor || !window.activeTextEditor.document) {
            return;
        }

        // Run the cell that matches the current cursor position.
        return this.runMatchingCell(window.activeTextEditor.selection, false);
    }

    @captureUsageTelemetry(Telemetry.RunCurrentCellAndAdvance)
    public async runCurrentCellAndAdvance() {
        if (!window.activeTextEditor || !window.activeTextEditor.document) {
            return;
        }

        // Run the cell that matches the current cursor position. Always advance
        return this.runMatchingCell(window.activeTextEditor.selection, true);
    }

    // telemetry captured on CommandRegistry
    public async addEmptyCellToBottom(): Promise<void> {
        const editor = window.activeTextEditor;
        if (editor) {
            this.insertCell(editor, editor.document.lineCount + 1);
        }
    }

    @capturePerfTelemetry(Telemetry.RunCurrentCellAndAddBelow)
    public async runCurrentCellAndAddBelow(): Promise<void> {
        if (!window.activeTextEditor || !window.activeTextEditor.document) {
            return;
        }

        const editor = window.activeTextEditor;
        const cellMatcher = new CellMatcher(this.configService.getSettings(editor.document.uri));
        let index = 0;
        const cellDelineator = this.getDefaultCellMarker(editor.document.uri);

        if (editor) {
            editor
                .edit((editBuilder) => {
                    let lastCell = true;

                    for (let i = editor.selection.end.line + 1; i < editor.document.lineCount; i += 1) {
                        if (cellMatcher.isCell(editor.document.lineAt(i).text)) {
                            lastCell = false;
                            index = i;
                            editBuilder.insert(new Position(i, 0), `${cellDelineator}\n\n`);
                            break;
                        }
                    }

                    if (lastCell) {
                        index = editor.document.lineCount;
                        editBuilder.insert(new Position(editor.document.lineCount, 0), `\n${cellDelineator}\n`);
                    }
                })
                .then(noop, noop);
        }

        // Run the cell that matches the current cursor position, and then advance to the new cell
        const newPosition = new Position(index + 1, 0);
        return this.runMatchingCell(editor.selection, false).then(() =>
            this.advanceToRange(new Range(newPosition, newPosition))
        );
    }

    @capturePerfTelemetry(Telemetry.InsertCellBelowPosition)
    public insertCellBelowPosition() {
        const editor = window.activeTextEditor;
        if (editor && editor.selection) {
            this.insertCell(editor, editor.selection.end.line + 1);
        }
    }

    @capturePerfTelemetry(Telemetry.InsertCellBelow)
    public insertCellBelow() {
        const editor = window.activeTextEditor;
        if (editor && editor.selection) {
            const cell = this.getCellFromPosition(editor.selection.end);
            if (cell) {
                this.insertCell(editor, cell.range.end.line + 1);
            } else {
                this.insertCell(editor, editor.selection.end.line + 1);
            }
        }
    }

    @capturePerfTelemetry(Telemetry.InsertCellAbove)
    public insertCellAbove() {
        const editor = window.activeTextEditor;
        if (editor && editor.selection) {
            const cell = this.getCellFromPosition(editor.selection.start);
            if (cell) {
                this.insertCell(editor, cell.range.start.line);
            } else {
                this.insertCell(editor, editor.selection.start.line);
            }
        }
    }

    @capturePerfTelemetry(Telemetry.DeleteCells)
    public deleteCells() {
        const editor = window.activeTextEditor;
        if (!editor || !editor.selection) {
            return;
        }

        const firstLastCells = this.getStartEndCells(editor.selection);
        if (!firstLastCells) {
            return;
        }
        const startCell = firstLastCells[0];
        const endCell = firstLastCells[1];

        // Start of the document should start at position 0, 0 and end one line ahead.
        let startLineNumber = 0;
        let startCharacterNumber = 0;
        let endLineNumber = endCell.range.end.line + 1;
        let endCharacterNumber = 0;
        // Anywhere else in the document should start at the end of line before the
        // cell and end at the last character of the cell.
        if (startCell.range.start.line > 0) {
            startLineNumber = startCell.range.start.line - 1;
            startCharacterNumber = editor.document.lineAt(startLineNumber).range.end.character;
            endLineNumber = endCell.range.end.line;
            endCharacterNumber = endCell.range.end.character;
        }
        const cellExtendedRange = new Range(
            new Position(startLineNumber, startCharacterNumber),
            new Position(endLineNumber, endCharacterNumber)
        );
        editor
            .edit((editBuilder) => {
                editBuilder.replace(cellExtendedRange, '');
                this.codeLensUpdatedEvent.fire();
            })
            .then(noop, noop);
    }

    @capturePerfTelemetry(Telemetry.SelectCell)
    public selectCell() {
        const editor = window.activeTextEditor;
        if (editor && editor.selection) {
            const startEndCells = this.getStartEndCells(editor.selection);
            if (startEndCells) {
                const startCell = startEndCells[0];
                const endCell = startEndCells[1];
                if (editor.selection.anchor.isBeforeOrEqual(editor.selection.active)) {
                    editor.selection = new Selection(startCell.range.start, endCell.range.end);
                } else {
                    editor.selection = new Selection(endCell.range.end, startCell.range.start);
                }
            }
        }
    }

    @capturePerfTelemetry(Telemetry.SelectCellContents)
    public selectCellContents() {
        const editor = window.activeTextEditor;
        if (!editor || !editor.selection) {
            return;
        }
        const startEndCellIndex = this.getStartEndCellIndex(editor.selection);
        if (!startEndCellIndex) {
            return;
        }
        const startCellIndex = startEndCellIndex[0];
        const endCellIndex = startEndCellIndex[1];
        const isAnchorLessEqualActive = editor.selection.anchor.isBeforeOrEqual(editor.selection.active);

        const cells = this.cells;
        const selections: Selection[] = [];
        for (let i = startCellIndex; i <= endCellIndex; i += 1) {
            const cell = cells[i];
            let anchorLine = cell.range.start.line + 1;
            let achorCharacter = 0;
            let activeLine = cell.range.end.line;
            let activeCharacter = cell.range.end.character;
            // if cell is only one line long, select the end of that line
            if (cell.range.start.line === cell.range.end.line) {
                anchorLine = cell.range.start.line;
                achorCharacter = editor.document.lineAt(anchorLine).range.end.character;
                activeLine = anchorLine;
                activeCharacter = achorCharacter;
            }
            if (isAnchorLessEqualActive) {
                selections.push(new Selection(anchorLine, achorCharacter, activeLine, activeCharacter));
            } else {
                selections.push(new Selection(activeLine, activeCharacter, anchorLine, achorCharacter));
            }
        }
        editor.selections = selections;
    }

    @capturePerfTelemetry(Telemetry.ExtendSelectionByCellAbove)
    public extendSelectionByCellAbove() {
        // This behaves similarly to excel "Extend Selection by One Cell Above".
        // The direction of the selection matters (i.e. where the active cursor)
        // position is. First, it ensures that complete cells are selection.
        // If so, then if active cursor is in cells below it contracts the
        // selection range. If the active cursor is above, it expands the
        // selection range.
        const editor = window.activeTextEditor;
        if (!editor || !editor.selection) {
            return;
        }
        const currentSelection = editor.selection;
        const startEndCellIndex = this.getStartEndCellIndex(editor.selection);
        if (!startEndCellIndex) {
            return;
        }

        const isAnchorLessThanActive = editor.selection.anchor.isBefore(editor.selection.active);

        const cells = this.cells;
        const startCellIndex = startEndCellIndex[0];
        const endCellIndex = startEndCellIndex[1];
        const startCell = cells[startCellIndex];
        const endCell = cells[endCellIndex];

        if (
            !startCell.range.start.isEqual(currentSelection.start) ||
            !endCell.range.end.isEqual(currentSelection.end)
        ) {
            // full cell range not selected, first select a full cell range.
            let selection: Selection;
            if (isAnchorLessThanActive) {
                if (startCellIndex < endCellIndex) {
                    // active at end of cell before endCell
                    selection = new Selection(startCell.range.start, cells[endCellIndex - 1].range.end);
                } else {
                    // active at end of startCell
                    selection = new Selection(startCell.range.end, startCell.range.start);
                }
            } else {
                // active at start of start cell.
                selection = new Selection(endCell.range.end, startCell.range.start);
            }
            editor.selection = selection;
        } else {
            let newCell: ICellRange | undefined;
            // full cell range is selected now decide if expanding or contracting?
            if (isAnchorLessThanActive && startCellIndex < endCellIndex) {
                // anchor is above active, contract selection by cell below.
                newCell = cells[endCellIndex - 1];
                editor.selection = new Selection(startCell.range.start, newCell.range.end);
            } else {
                // anchor is below active, expand selection by cell above.
                if (startCellIndex > 0) {
                    newCell = cells[startCellIndex - 1];
                    editor.selection = new Selection(endCell.range.end, newCell.range.start);
                }
            }

            if (newCell) {
                editor.revealRange(newCell.range, TextEditorRevealType.Default);
            }
        }
    }

    @capturePerfTelemetry(Telemetry.ExtendSelectionByCellBelow)
    public extendSelectionByCellBelow() {
        // This behaves similarly to excel "Extend Selection by One Cell Above".
        // The direction of the selection matters (i.e. where the active cursor)
        // position is. First, it ensures that complete cells are selection.
        // If so, then if active cursor is in cells below it expands the
        // selection range. If the active cursor is above, it contracts the
        // selection range.
        const editor = window.activeTextEditor;
        if (!editor || !editor.selection) {
            return;
        }
        const currentSelection = editor.selection;
        const startEndCellIndex = this.getStartEndCellIndex(editor.selection);
        if (!startEndCellIndex) {
            return;
        }

        const isAnchorLessEqualActive = editor.selection.anchor.isBeforeOrEqual(editor.selection.active);

        const cells = this.cells;
        const startCellIndex = startEndCellIndex[0];
        const endCellIndex = startEndCellIndex[1];
        const startCell = cells[startCellIndex];
        const endCell = cells[endCellIndex];

        if (
            !startCell.range.start.isEqual(currentSelection.start) ||
            !endCell.range.end.isEqual(currentSelection.end)
        ) {
            // full cell range not selected, first select a full cell range.
            let selection: Selection;
            if (isAnchorLessEqualActive) {
                // active at start of start cell.
                selection = new Selection(startCell.range.start, endCell.range.end);
            } else {
                if (startCellIndex < endCellIndex) {
                    // active at end of cell before endCell
                    selection = new Selection(cells[startCellIndex + 1].range.start, endCell.range.end);
                } else {
                    // active at end of startCell
                    selection = new Selection(endCell.range.start, endCell.range.end);
                }
            }
            editor.selection = selection;
        } else {
            let newCell: ICellRange | undefined;
            // full cell range is selected now decide if expanding or contracting?
            if (isAnchorLessEqualActive || startCellIndex === endCellIndex) {
                // anchor is above active, expand selection by cell below.
                if (endCellIndex < cells.length - 1) {
                    newCell = cells[endCellIndex + 1];
                    editor.selection = new Selection(startCell.range.start, newCell.range.end);
                }
            } else {
                // anchor is below active, contract selection by cell above.
                if (startCellIndex < endCellIndex) {
                    newCell = cells[startCellIndex + 1];
                    editor.selection = new Selection(endCell.range.end, newCell.range.start);
                }
            }

            if (newCell) {
                editor.revealRange(newCell.range, TextEditorRevealType.Default);
            }
        }
    }

    @capturePerfTelemetry(Telemetry.MoveCellsUp)
    public async moveCellsUp(): Promise<void> {
        await this.moveCellsDirection(true);
    }

    @capturePerfTelemetry(Telemetry.MoveCellsDown)
    public async moveCellsDown(): Promise<void> {
        await this.moveCellsDirection(false);
    }

    @capturePerfTelemetry(Telemetry.ChangeCellToMarkdown)
    public changeCellToMarkdown() {
        this.applyToCells((editor, cell, _) => {
            return this.changeCellTo(editor, cell, 'markdown');
        });
    }

    @capturePerfTelemetry(Telemetry.ChangeCellToCode)
    public changeCellToCode() {
        this.applyToCells((editor, cell, _) => {
            return this.changeCellTo(editor, cell, 'code');
        });
    }

    @capturePerfTelemetry(Telemetry.GotoNextCellInFile)
    public gotoNextCell() {
        const editor = window.activeTextEditor;
        if (!editor || !editor.selection) {
            return;
        }

        const currentSelection = editor.selection;

        const currentRunCellLens = this.getCurrentCellLens(currentSelection.start);
        const nextRunCellLens = this.getNextCellLens(currentSelection.start);

        if (currentRunCellLens && nextRunCellLens) {
            this.advanceToRange(nextRunCellLens.range);
        }
    }

    @capturePerfTelemetry(Telemetry.GotoPrevCellInFile)
    public gotoPreviousCell() {
        const editor = window.activeTextEditor;
        if (!editor || !editor.selection) {
            return;
        }

        const currentSelection = editor.selection;

        const currentRunCellLens = this.getCurrentCellLens(currentSelection.start);
        const prevRunCellLens = this.getPreviousCellLens(currentSelection.start);

        if (currentRunCellLens && prevRunCellLens) {
            this.advanceToRange(prevRunCellLens.range);
        }
    }

    private applyToCells(callback: (editor: TextEditor, cell: ICellRange, cellIndex: number) => void) {
        const editor = window.activeTextEditor;
        const startEndCellIndex = this.getStartEndCellIndex(editor?.selection);
        if (!editor || !startEndCellIndex) {
            return;
        }
        const cells = this.cells;
        const startIndex = startEndCellIndex[0];
        const endIndex = startEndCellIndex[1];
        for (let cellIndex = startIndex; cellIndex <= endIndex; cellIndex += 1) {
            callback(editor, cells[cellIndex], cellIndex);
        }
    }

    private changeCellTo(editor: TextEditor, cell: ICellRange, toCellType: nbformat.CellType) {
        // change cell from code -> markdown or markdown -> code
        if (toCellType === 'raw') {
            throw Error('Cell Type raw not implemented');
        }

        // don't change cell type if already that type
        if (cell.cell_type === toCellType) {
            return;
        }
        const cellMatcher = new CellMatcher(this.configService.getSettings(editor.document.uri));
        const definitionLine = editor.document.lineAt(cell.range.start.line);
        const definitionText = editor.document.getText(definitionLine.range);

        // new definition text
        const cellMarker = this.getDefaultCellMarker(editor.document.uri);
        const definitionMatch =
            toCellType === 'markdown'
                ? cellMatcher.codeExecRegEx.exec(definitionText) // code -> markdown
                : cellMatcher.markdownExecRegEx.exec(definitionText); // markdown -> code
        if (!definitionMatch) {
            return;
        }
        const definitionExtra = definitionMatch[definitionMatch.length - 1];
        const newDefinitionText =
            toCellType === 'markdown'
                ? `${cellMarker} [markdown]${definitionExtra}` // code -> markdown
                : `${cellMarker}${definitionExtra}`; // markdown -> code

        editor
            .edit(async (editBuilder) => {
                editBuilder.replace(definitionLine.range, newDefinitionText);
                cell.cell_type = toCellType;
                if (cell.range.start.line < cell.range.end.line) {
                    editor.selection = new Selection(
                        cell.range.start.line + 1,
                        0,
                        cell.range.end.line,
                        cell.range.end.character
                    );
                    // ensure all lines in markdown cell have a comment.
                    // these are not included in the test because it's unclear
                    // how TypeMoq works with them.
                    commands.executeCommand('editor.action.removeCommentLine').then(noop, noop);
                    if (toCellType === 'markdown') {
                        commands.executeCommand('editor.action.addCommentLine').then(noop, noop);
                    }
                }
            })
            .then(noop, noop);
    }

    private async moveCellsDirection(directionUp: boolean): Promise<boolean> {
        const editor = window.activeTextEditor;
        if (!editor || !editor.selection) {
            return false;
        }
        const startEndCellIndex = this.getStartEndCellIndex(editor.selection);
        if (!startEndCellIndex) {
            return false;
        }
        const startCellIndex = startEndCellIndex[0];
        const endCellIndex = startEndCellIndex[1];
        const cells = this.cells;
        const startCell = cells[startCellIndex];
        const endCell = cells[endCellIndex];
        if (!startCell || !endCell) {
            return false;
        }
        const currentRange = new Range(startCell.range.start, endCell.range.end);
        const relativeSelectionRange = new Range(
            editor.selection.start.line - currentRange.start.line,
            editor.selection.start.character,
            editor.selection.end.line - currentRange.start.line,
            editor.selection.end.character
        );
        const isActiveBeforeAnchor = editor.selection.active.isBefore(editor.selection.anchor);
        let thenSetSelection: Thenable<boolean>;
        if (directionUp) {
            if (startCellIndex === 0) {
                return false;
            } else {
                const aboveCell = cells[startCellIndex - 1];
                const thenExchangeTextLines = this.exchangeTextLines(editor, aboveCell.range, currentRange);
                thenSetSelection = thenExchangeTextLines.then((isEditSuccessful) => {
                    if (isEditSuccessful) {
                        editor.selection = new Selection(
                            aboveCell.range.start.line + relativeSelectionRange.start.line,
                            relativeSelectionRange.start.character,
                            aboveCell.range.start.line + relativeSelectionRange.end.line,
                            relativeSelectionRange.end.character
                        );
                    }
                    return isEditSuccessful;
                });
            }
        } else {
            if (endCellIndex === cells.length - 1) {
                return false;
            } else {
                const belowCell = cells[endCellIndex + 1];
                const thenExchangeTextLines = this.exchangeTextLines(editor, currentRange, belowCell.range);
                const belowCellLineLength = belowCell.range.end.line - belowCell.range.start.line;
                const aboveCellLineLength = currentRange.end.line - currentRange.start.line;
                const diffCellLineLength = belowCellLineLength - aboveCellLineLength;
                thenSetSelection = thenExchangeTextLines.then((isEditSuccessful) => {
                    if (isEditSuccessful) {
                        editor.selection = new Selection(
                            belowCell.range.start.line + diffCellLineLength + relativeSelectionRange.start.line,
                            relativeSelectionRange.start.character,
                            belowCell.range.start.line + diffCellLineLength + relativeSelectionRange.end.line,
                            relativeSelectionRange.end.character
                        );
                    }
                    return isEditSuccessful;
                });
            }
        }
        return thenSetSelection.then((isEditSuccessful) => {
            if (isEditSuccessful && isActiveBeforeAnchor) {
                editor.selection = new Selection(editor.selection.active, editor.selection.anchor);
            }
            return true;
        });
    }

    private exchangeTextLines(editor: TextEditor, aboveRange: Range, belowRange: Range): Thenable<boolean> {
        const aboveStartLine = aboveRange.start.line;
        const aboveEndLine = aboveRange.end.line;
        const belowStartLine = belowRange.start.line;
        const belowEndLine = belowRange.end.line;

        if (aboveEndLine >= belowStartLine) {
            throw RangeError(`Above lines must be fully above not ${aboveEndLine} <= ${belowStartLine}`);
        }

        const above = new Range(
            aboveStartLine,
            0,
            aboveEndLine,
            editor.document.lineAt(aboveEndLine).range.end.character
        );
        const aboveText = editor.document.getText(above);

        const below = new Range(
            belowStartLine,
            0,
            belowEndLine,
            editor.document.lineAt(belowEndLine).range.end.character
        );
        const belowText = editor.document.getText(below);

        let betweenText = '';
        if (aboveEndLine + 1 < belowStartLine) {
            const betweenStatLine = aboveEndLine + 1;
            const betweenEndLine = belowStartLine - 1;
            const between = new Range(
                betweenStatLine,
                0,
                betweenEndLine,
                editor.document.lineAt(betweenEndLine).range.end.character
            );
            betweenText = `${editor.document.getText(between)}\n`;
        }

        const newText = `${belowText}\n${betweenText}${aboveText}`;
        const newRange = new Range(above.start, below.end);
        return editor.edit((editBuilder) => {
            editBuilder.replace(newRange, newText);
            this.codeLensUpdatedEvent.fire();
        });
    }

    private getStartEndCells(selection: Selection): ICellRange[] | undefined {
        const startEndCellIndex = this.getStartEndCellIndex(selection);
        if (startEndCellIndex) {
            const startCell = this.getCellFromIndex(startEndCellIndex[0]);
            const endCell = this.getCellFromIndex(startEndCellIndex[1]);
            return [startCell, endCell];
        }
    }

    private getStartEndCellIndex(selection?: Selection): number[] | undefined {
        if (!selection) {
            return undefined;
        }
        let startCellIndex = this.getCellIndex(selection.start);
        let endCellIndex = startCellIndex;
        // handle if the selection is the same line, hence same cell
        if (selection.start.line !== selection.end.line) {
            endCellIndex = this.getCellIndex(selection.end);
        }
        // handle when selection is above the top most cell
        if (startCellIndex === -1) {
            if (endCellIndex === -1) {
                return undefined;
            } else {
                // selected a range above the first cell.
                startCellIndex = 0;
                const startCell = this.getCellFromIndex(0);
                if (selection.start.line > startCell.range.start.line) {
                    throw RangeError(
                        `Should not be able to pick a range with an end in a cell and start after a cell. ${selection.start.line} > ${startCell.range.end.line}`
                    );
                }
            }
        }
        if (startCellIndex >= 0 && endCellIndex >= 0) {
            return [startCellIndex, endCellIndex];
        }
    }

    private insertCell(editor: TextEditor, line: number) {
        // insertCell
        //
        // Inserts a cell at current line defined as two new lines and then
        // moves cursor to within the cell.
        // ```
        // # %%
        //
        // ```
        //
        const cellDelineator = this.getDefaultCellMarker(editor.document.uri);
        const newCell = line >= editor.document.lineCount ? `\n${cellDelineator}\n` : `${cellDelineator}\n\n`;

        const cellStartPosition = new Position(line, 0);
        const newCursorPosition = new Position(line + 1, 0);

        editor
            .edit((editBuilder) => {
                editBuilder.insert(cellStartPosition, newCell);
                this.codeLensUpdatedEvent.fire();
            })
            .then(noop, noop);

        editor.selection = new Selection(newCursorPosition, newCursorPosition);
    }

    private getDefaultCellMarker(resource: Resource): string {
        return this.configService.getSettings(resource).defaultCellMarker || Identifiers.DefaultCodeCellMarker;
    }

    private onCodeLensFactoryUpdated(): void {
        // Update our code lenses.
        if (this.document) {
            this.codeLenses = this.codeLensFactory.createCodeLenses(this.document);
            this.cells = this.codeLensFactory.getCellRanges(this.document);
        }
        this.codeLensUpdatedEvent.fire();
    }

    private onDocumentClosed(doc: TextDocument): void {
        if (this.document && urlPath.isEqual(doc.uri, this.document.uri)) {
            dispose(this.disposables);
        }
    }

    private ondidCloseNotebook(notebook: NotebookDocument): void {
        if (
            notebook.notebookType === InteractiveWindowView &&
            this.configService.getSettings(this.document?.uri).addGotoCodeLenses
        ) {
            this.onCodeLensFactoryUpdated();
        }
    }

    private getActiveInteractiveWindow() {
        return this.interactiveWindowProvider.getOrCreate(this.document?.uri);
    }

    private async addCode(
        interactiveWindow: IInteractiveWindow,
        code: string,
        file: Uri,
        line: number,
        debug?: boolean
    ): Promise<boolean> {
        let result = false;
        try {
            if (debug) {
                result = await interactiveWindow.debugCode(code, file, line);
            } else {
                result = await interactiveWindow.addCode(code, file, line);
            }
        } catch (err) {
            if (!(err instanceof InteractiveCellResultError)) {
                await this.dataScienceErrorHandler.handleError(err);
            }
        }

        return result;
    }

    private async runMatchingCell(range: Range, advance?: boolean, debug?: boolean) {
        const currentRunCellLens = this.getCurrentCellLens(range.start);
        const nextRunCellLens = this.getNextCellLens(range.start);

        if (currentRunCellLens && this.document) {
            const code = dedentCode(this.document.getText(currentRunCellLens.range));

            // Move the next cell if allowed.
            if (advance) {
                const editor = window.activeTextEditor;
                const { newCellOnRunLast } = this.configService.getSettings(this.document.uri);
                const cellMatcher = new CellMatcher(this.configService.getSettings(this.document.uri));

                if (nextRunCellLens) {
                    this.advanceToRange(nextRunCellLens.range);
                } else if (newCellOnRunLast && editor && !cellMatcher.isEmptyCell(code)) {
                    // insert new cell at bottom after current
                    this.insertCell(editor, currentRunCellLens.range.end.line + 1);
                }
            }

            // Run the cell after moving the selection
            const iw = await this.getActiveInteractiveWindow();
            await this.addCode(iw, code, this.document.uri, currentRunCellLens.range.start.line, debug);
        }
    }

    private getCellIndex(position: Position): number {
        return this.cells.findIndex((cell) => position && cell.range.contains(position));
    }

    private getCellFromIndex(index: number): ICellRange {
        const cells = this.cells;
        const indexBounded = getIndex(index, cells.length);
        return cells[indexBounded];
    }

    private getCellFromPosition(position?: Position): ICellRange | undefined {
        if (!position) {
            const editor = window.activeTextEditor;
            if (editor && editor.selection) {
                position = editor.selection.active;
            }
        }
        if (position) {
            const index = this.getCellIndex(position);
            if (index >= 0) {
                return this.cells[index];
            }
        }
    }

    private getCurrentCellLens(pos: Position): CodeLens | undefined {
        return this.codeLenses.find(
            (l) => l.range.contains(pos) && l.command !== undefined && l.command.command === Commands.RunCell
        );
    }

    private getNextCellLens(pos: Position): CodeLens | undefined {
        const currentIndex = this.codeLenses.findIndex(
            (l) => l.range.contains(pos) && l.command !== undefined && l.command.command === Commands.RunCell
        );
        if (currentIndex >= 0) {
            return this.codeLenses.find(
                (l: CodeLens, i: number) =>
                    l.command !== undefined && l.command.command === Commands.RunCell && i > currentIndex
            );
        }
        return undefined;
    }

    private getPreviousCellLens(pos: Position): CodeLens | undefined {
        const currentIndex = this.codeLenses.findIndex(
            (l) => l.range.contains(pos) && l.command !== undefined && l.command.command === Commands.RunCell
        );
        if (currentIndex >= 1) {
            return this.codeLenses.find(
                (l: CodeLens, i: number) => l.command !== undefined && i < currentIndex && i + 1 === currentIndex
            );
        }
        return undefined;
    }

    private async runFileAsOneCell(debug: boolean) {
        if (this.document) {
            const iw = await this.getActiveInteractiveWindow();
            const code = this.document.getText();

            await this.addCode(iw, code, this.document.uri, 0, debug);
        }
    }

    // Advance the cursor to the selected range
    private advanceToRange(targetRange: Range) {
        const editor = window.activeTextEditor;
        const newSelection = new Selection(targetRange.start, targetRange.start);
        if (editor) {
            editor.selection = newSelection;
            editor.revealRange(targetRange, TextEditorRevealType.Default);
        }
    }
}
