// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import {
    Disposable,
    NotebookCellExecutionStateChangeEvent,
    NotebookDocument,
    Position,
    Range,
    TextDocumentChangeEvent,
    TextDocumentContentChangeEvent,
    Uri
} from 'vscode';

import { splitMultilineString } from '../../platform/common/utils';
import { IDocumentManager, IVSCodeNotebook } from '../../platform/common/application/types';
import { traceInfo } from '../../platform/logging';
import { IConfigurationService, IDisposableRegistry } from '../../platform/common/types';
import { uncommentMagicCommands } from './cellFactory';
import { CellMatcher } from './cellMatcher';
import { IGeneratedCode, IInteractiveWindowCodeGenerator, IGeneratedCodeStore, InteractiveCellMetadata } from './types';
import { computeHash } from '../../platform/common/crypto';

// This class provides generated code for debugging jupyter cells. Call getGeneratedCode just before starting debugging to compute all of the
// generated codes for cells & update the source maps in the python debugger.
export class CodeGenerator implements IInteractiveWindowCodeGenerator {
    // Map of file to Map of start line to actual hash
    private executionCount: number = 0;
    private cellIndexesCounted: Record<number, boolean> = {};
    private disposed?: boolean;
    private disposables: Disposable[] = [];
    constructor(
        private readonly documentManager: IDocumentManager,
        private readonly configService: IConfigurationService,
        private readonly storage: IGeneratedCodeStore,
        private readonly notebook: NotebookDocument,
        notebooks: IVSCodeNotebook,
        disposables: IDisposableRegistry
    ) {
        disposables.push(this);
        // Watch document changes so we can update our generated code
        this.documentManager.onDidChangeTextDocument(this.onChangedDocument, this, this.disposables);
        notebooks.onDidChangeNotebookCellExecutionState(this.onDidCellStateChange, this, this.disposables);
    }

    public dispose() {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.storage.clear();
        this.disposables.forEach((d) => d.dispose());
    }

    public reset() {
        this.storage.clear();
        this.executionCount = 0;
    }

    public async generateCode(
        metadata: Pick<InteractiveCellMetadata, 'interactive' | 'id' | 'interactiveWindowCellMarker'>,
        cellIndex: number,
        debug: boolean,
        usingJupyterDebugProtocol?: boolean
    ) {
        // Don't log empty cells
        const { executableLines } = this.extractExecutableLines(metadata);
        // user added code that we're about to execute, so increase the execution count for the code that we need to generate
        this.executionCount += 1;
        this.cellIndexesCounted[cellIndex] = true;
        if (executableLines.length > 0 && executableLines.find((s) => s.trim().length > 0)) {
            return this.generateCodeImpl(metadata, this.executionCount, debug, usingJupyterDebugProtocol);
        }
    }

    public extractExecutableLines(
        metadata: Pick<InteractiveCellMetadata, 'interactive' | 'id' | 'interactiveWindowCellMarker'>
    ): { lines: string[]; executableLines: string[] } {
        const code = metadata.interactive.originalSource;
        const settings = this.configService.getSettings(this.notebook.uri);
        const cellMatcher = new CellMatcher(settings);
        const lines = splitMultilineString(code);

        if (settings.magicCommandsAsComments) {
            lines.forEach((line, index) => (lines[index] = uncommentMagicCommands(line)));
        }

        // If we have a cell magic then don't send the cell marker.
        // For cell magics the first line must be the magic, including code line `#` which is a Python comment treats the cell as a Python code cell
        // then the rest of the code line the magic & the latext code gets treated as Python code, instead of a cell magic.
        if (
            metadata.interactiveWindowCellMarker &&
            lines.length &&
            lines[0].trim() === metadata.interactiveWindowCellMarker.trim()
        ) {
            const nonEmptyLines = lines.slice(1).filter((line) => line.trim().length > 0);
            if (nonEmptyLines.length > 0 && nonEmptyLines[0].trim().startsWith('%%')) {
                const executableLines = lines.slice(lines.indexOf(nonEmptyLines[0]));
                return { lines: executableLines, executableLines };
            }
        }

        // Only strip this off the first line. Otherwise we want the markers in the code.
        if (lines.length > 0 && (cellMatcher.isCode(lines[0]) || cellMatcher.isMarkdown(lines[0]))) {
            return { lines, executableLines: lines.slice(1) };
        }
        return { lines, executableLines: lines };
    }

    private onDidCellStateChange(e: NotebookCellExecutionStateChangeEvent) {
        if (
            e.cell.notebook !== this.notebook ||
            !e.cell.executionSummary?.executionOrder ||
            this.cellIndexesCounted[e.cell.index]
        ) {
            return;
        }
        // A cell executed that we haven't counted yet, likely from the input box, so bump the execution count
        // Cancelled cells (from earlier cells in the queue) don't have an execution order and shoud not increase the execution count
        this.executionCount += 1;
        this.cellIndexesCounted[e.cell.index] = true;
    }

    private async generateCodeImpl(
        metadata: Pick<InteractiveCellMetadata, 'interactive' | 'id' | 'interactiveWindowCellMarker'>,
        expectedCount: number,
        debug: boolean,
        usingJupyterDebugProtocol?: boolean
    ) {
        // Find the text document that matches. We need more information than
        // the add code gives us
        const { lineIndex: cellLine, uristring } = metadata.interactive;
        const doc = this.documentManager.textDocuments.find((d) => d.uri.toString() === uristring);
        if (!doc) {
            return;
        }
        // Compute the code that will really be sent to jupyter
        const { stripped, trueStartLine } = this.extractStrippedLines(metadata);

        const line = doc.lineAt(trueStartLine);
        const endLine = doc.lineAt(Math.min(trueStartLine + stripped.length - 1, doc.lineCount - 1));

        // Find the first non blank line
        let firstNonBlankIndex = 0;
        while (firstNonBlankIndex < stripped.length && stripped[firstNonBlankIndex].trim().length === 0) {
            firstNonBlankIndex += 1;
        }
        const firstNonBlankLineIndex = firstNonBlankIndex + trueStartLine;

        // Use the original values however to track edits. This is what we need
        // to move around
        const startOffset = doc.offsetAt(new Position(cellLine, 0));
        const endOffset = doc.offsetAt(endLine.rangeIncludingLineBreak.end);
        const hasCellMarker = (metadata.interactiveWindowCellMarker || '').length > 0;

        // Compute the runtime line and adjust our cell/stripped source for debugging
        const { runtimeLine, debuggerStartLine } = this.addHiddenLines(
            debug,
            stripped,
            trueStartLine,
            firstNonBlankLineIndex,
            hasCellMarker,
            usingJupyterDebugProtocol
        );

        const hashedCode = stripped.join('');
        const realCode = doc.getText(new Range(new Position(cellLine, 0), endLine.rangeIncludingLineBreak.end));
        const hashValue = (await computeHash(hashedCode, 'SHA-1')).substring(0, 12);
        const runtimeFile = this.getRuntimeFile(hashValue, expectedCount);
        // If we're debugging reduce one line for the `breakpoint()` statement added by us.
        const lineOffsetRelativeToIndexOfFirstLineInCell = debug ? -1 : 0;

        const hash: IGeneratedCode = {
            line: line ? line.lineNumber + 1 : 1,
            endLine: endLine ? endLine.lineNumber + 1 : 1,
            firstNonBlankLineIndex,
            debuggerStartLine,
            executionCount: expectedCount,
            startOffset,
            endOffset,
            deleted: false,
            code: hashedCode,
            trimmedRightCode: stripped.map((s) => s.replace(/[ \t\r]+\n$/g, '\n')).join(''),
            realCode,
            runtimeLine,
            runtimeFile,
            id: metadata.id,
            timestamp: Date.now(),
            lineOffsetRelativeToIndexOfFirstLineInCell,
            hasCellMarker
        };

        traceInfo(`Generated code for ${expectedCount} = ${runtimeFile} with ${stripped.length} lines`);
        this.storage.store(Uri.parse(metadata.interactive.uristring), hash);
        return hash;
    }

    private getRuntimeFile(hash: string, executionCount: number) {
        return `<ipython-input-${executionCount}-${hash}>`;
    }

    private onChangedDocument(e: TextDocumentChangeEvent) {
        // See if the document is in our list of docs to watch
        const perFile = this.storage.getFileGeneratedCode(e.document.uri);
        if (perFile) {
            // Apply the content changes to the file's cells.
            const docText = e.document.getText();
            e.contentChanges.forEach((c) => {
                this.handleContentChange(docText, c, perFile);
            });
        }
    }

    private extractStrippedLines(
        metadata: Pick<InteractiveCellMetadata, 'interactive' | 'id' | 'interactiveWindowCellMarker'>
    ): {
        stripped: string[];
        trueStartLine: number;
    } {
        const lines = splitMultilineString(metadata.interactive.originalSource);
        // Compute the code that will really be sent to jupyter (including the cell marker)
        const { lines: stripped } = this.extractExecutableLines(metadata);

        let trueStartLine = metadata.interactive.lineIndex + 1;
        if (!metadata.interactiveWindowCellMarker) {
            // Figure out our true 'start' line. This is what we need to tell the debugger is
            // actually the start of the code as that's what Jupyter will be getting.
            trueStartLine = metadata.interactive.lineIndex;
            for (let i = 0; i < stripped.length; i += 1) {
                if (stripped[i] !== lines[i]) {
                    trueStartLine += i + 1;
                    break;
                }
            }
        }
        // Find the first non blank line
        let firstNonBlankIndex = 0;
        while (firstNonBlankIndex < stripped.length && stripped[firstNonBlankIndex].trim().length === 0) {
            firstNonBlankIndex += 1;
        }

        // Jupyter also removes blank lines at the end. Make sure only one
        let lastLinePos = stripped.length - 1;
        let nextToLastLinePos = stripped.length - 2;
        while (nextToLastLinePos > 0) {
            const lastLine = stripped[lastLinePos];
            const nextToLastLine = stripped[nextToLastLinePos];
            if (
                (lastLine.length === 0 || lastLine === '\n') &&
                (nextToLastLine.length === 0 || nextToLastLine === '\n')
            ) {
                stripped.splice(lastLinePos, 1);
                lastLinePos -= 1;
                nextToLastLinePos -= 1;
            } else {
                break;
            }
        }
        // Make sure the last line with actual content ends with a linefeed
        if (!stripped[lastLinePos].endsWith('\n') && stripped[lastLinePos].length > 0) {
            stripped[lastLinePos] = `${stripped[lastLinePos]}\n`;
        }

        // We also don't send \r\n to jupyter. Remove from the stripped lines
        for (let i = 0; i < stripped.length; i++) {
            stripped[i] = stripped[i].replace(/\r\n/g, '\n');
        }
        return { stripped, trueStartLine };
    }

    private handleContentChange(docText: string, c: TextDocumentContentChangeEvent, generatedCodes: IGeneratedCode[]) {
        // First compute the number of lines that changed
        const lineDiff = c.range.start.line - c.range.end.line + c.text.split('\n').length - 1;
        const offsetDiff = c.text.length - c.rangeLength;

        // Compute the inclusive offset that is changed by the cell.
        const endChangedOffset = c.rangeLength <= 0 ? c.rangeOffset : c.rangeOffset + c.rangeLength - 1;

        generatedCodes.forEach((h) => {
            // See how this existing cell compares to the change
            if (h.endOffset < c.rangeOffset) {
                // No change. This cell is entirely before the change
            } else if (h.startOffset > endChangedOffset) {
                // This cell is after the text that got replaced. Adjust its start/end lines
                h.line += lineDiff;
                h.endLine += lineDiff;
                h.startOffset += offsetDiff;
                h.endOffset += offsetDiff;
            } else if (h.startOffset === endChangedOffset) {
                // Cell intersects but exactly, might be a replacement or an insertion
                if (h.deleted || c.rangeLength > 0 || lineDiff === 0) {
                    // Replacement
                    h.deleted = docText.substr(h.startOffset, h.endOffset - h.startOffset) !== h.realCode;
                } else {
                    // Insertion
                    h.line += lineDiff;
                    h.endLine += lineDiff;
                    h.startOffset += offsetDiff;
                    h.endOffset += offsetDiff;
                }
            } else {
                // Intersection, delete if necessary
                h.deleted = docText.substr(h.startOffset, h.endOffset - h.startOffset) !== h.realCode;
            }
        });
    }

    /* Calculate the runtimeLine that we need for mapping debugging as well as the real .py
    line that we need to start our mapping at.
    This start line calculation is needed as the breakpoint is inserted when debugging like so
    so the leading lines are not stripped sending to Jupyter.

    breakpoint()/n
    /n // <-- We need to start source mapping here
    /n
    first line of code

    But when not debugging, the leading spaces are stripped so you need to map to the first real line
    /n
    /n
    first line of code // <-- We need to start source mapping here

    Given that the hash still needs to map to the actual file contents calculating this mapping at this point
    where we are making debugging calculations for runtimeLine feels appropriate.
    */
    private addHiddenLines(
        debug: boolean,
        source: string[],
        trueStartLine: number,
        firstNonBlankLineIndex: number,
        hasCellMarker: boolean,
        usingJupyterDebugProtocol?: boolean
    ): { runtimeLine: number; debuggerStartLine: number } {
        const useNewDebugger =
            usingJupyterDebugProtocol || this.configService.getSettings(undefined).forceIPyKernelDebugger === true;
        if (debug && this.configService.getSettings(this.notebook.uri).stopOnFirstLineWhileDebugging) {
            if (useNewDebugger) {
                // Inject the breakpoint line
                source.splice(0, 0, 'breakpoint()\n');
                return { runtimeLine: 1, debuggerStartLine: trueStartLine + 1 };
            } else {
                // Inject the breakpoint line
                source.splice(0, 0, 'breakpoint()\n');

                // Start on the second line
                // Since a breakpoint was added map to the first line (even if blank)
                return { runtimeLine: 2, debuggerStartLine: trueStartLine };
            }
        }
        // No breakpoint necessary, start on the first line
        // Since no breakpoint was added map to the first non-blank line
        const debuggerStartLine = hasCellMarker ? firstNonBlankLineIndex : firstNonBlankLineIndex + 1;
        return { runtimeLine: 1, debuggerStartLine };
    }
}
