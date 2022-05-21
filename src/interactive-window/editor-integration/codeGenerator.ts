// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import * as hashjs from 'hash.js';
import {
    Disposable,
    NotebookDocument,
    Position,
    Range,
    TextDocumentChangeEvent,
    TextDocumentContentChangeEvent,
    Uri
} from 'vscode';

import { splitMultilineString } from '../../webviews/webview-side/common';
import { IDocumentManager } from '../../platform/common/application/types';
import { traceInfo } from '../../platform/logging';
import { IConfigurationService } from '../../platform/common/types';
import { uncommentMagicCommands } from './cellFactory';
import { CellMatcher } from './cellMatcher';
import { IGeneratedCode, IInteractiveWindowCodeGenerator, IGeneratedCodeStore, InteractiveCellMetadata } from './types';

// This class provides hashes for debugging jupyter cells. Call getHashes just before starting debugging to compute all of the
// hashes for cells.
export class CodeGenerator implements IInteractiveWindowCodeGenerator {
    // Map of file to Map of start line to actual hash
    private executionCount: number = 0;
    private disposables: Disposable[] = [];
    constructor(
        private documentManager: IDocumentManager,
        private configService: IConfigurationService,
        private readonly storage: IGeneratedCodeStore,
        private readonly notebook: NotebookDocument
    ) {
        // Watch document changes so we can update our hashes
        this.documentManager.onDidChangeTextDocument(this.onChangedDocument.bind(this));
    }

    public dispose() {
        this.storage.clear();
        this.disposables.forEach((d) => d.dispose());
    }

    public reset() {
        this.storage.clear();
        this.executionCount = 0;
    }

    public generateCode(metadata: Pick<InteractiveCellMetadata, 'interactive' | 'id'>, debug: boolean) {
        // Don't log empty cells
        const executableLines = this.extractExecutableLines(metadata.interactive.originalSource);
        if (executableLines.length > 0 && executableLines.find((s) => s.trim().length > 0)) {
            // When the user adds new code, we know the execution count is increasing
            this.executionCount += 1;
            return this.generateHash(metadata, this.executionCount, debug);
        }
    }

    public extractExecutableLines(code: string): string[] {
        const settings = this.configService.getSettings(this.notebook.uri);
        const cellMatcher = new CellMatcher(settings);
        const lines = splitMultilineString(code);

        if (settings.magicCommandsAsComments) {
            lines.forEach((line, index) => (lines[index] = uncommentMagicCommands(line)));
        }

        // Only strip this off the first line. Otherwise we want the markers in the code.
        if (lines.length > 0 && (cellMatcher.isCode(lines[0]) || cellMatcher.isMarkdown(lines[0]))) {
            return lines.slice(1);
        }
        return lines;
    }

    private generateHash(
        metadata: Pick<InteractiveCellMetadata, 'interactive' | 'id'>,
        expectedCount: number,
        debug: boolean
    ) {
        // Find the text document that matches. We need more information than
        // the add code gives us
        const { line: cellLine, uristring } = metadata.interactive;
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

        // Compute the runtime line and adjust our cell/stripped source for debugging
        const { runtimeLine, debuggerStartLine } = this.addHiddenLines(
            debug,
            stripped,
            trueStartLine,
            firstNonBlankLineIndex
        );

        const hashedCode = stripped.join('');
        const realCode = doc.getText(new Range(new Position(cellLine, 0), endLine.rangeIncludingLineBreak.end));
        const hashValue = hashjs.sha1().update(hashedCode).digest('hex').substr(0, 12);
        const runtimeFile = this.getRuntimeFile(hashValue, expectedCount);

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
            timestamp: Date.now()
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
        const perFile = this.storage.getFileHashes(e.document.uri);
        if (perFile) {
            // Apply the content changes to the file's cells.
            const docText = e.document.getText();
            e.contentChanges.forEach((c) => {
                this.handleContentChange(docText, c, perFile);
            });
        }
    }

    private extractStrippedLines(metadata: Pick<InteractiveCellMetadata, 'interactive' | 'id'>): {
        stripped: string[];
        trueStartLine: number;
    } {
        const lines = splitMultilineString(metadata.interactive.originalSource);
        // Compute the code that will really be sent to jupyter
        const stripped = this.extractExecutableLines(metadata.interactive.originalSource);

        // Figure out our true 'start' line. This is what we need to tell the debugger is
        // actually the start of the code as that's what Jupyter will be getting.
        let trueStartLine = metadata.interactive.line;
        for (let i = 0; i < stripped.length; i += 1) {
            if (stripped[i] !== lines[i]) {
                trueStartLine += i + 1;
                break;
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

    private handleContentChange(docText: string, c: TextDocumentContentChangeEvent, hashes: IGeneratedCode[]) {
        // First compute the number of lines that changed
        const lineDiff = c.range.start.line - c.range.end.line + c.text.split('\n').length - 1;
        const offsetDiff = c.text.length - c.rangeLength;

        // Compute the inclusive offset that is changed by the cell.
        const endChangedOffset = c.rangeLength <= 0 ? c.rangeOffset : c.rangeOffset + c.rangeLength - 1;

        hashes.forEach((h) => {
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
        firstNonBlankLineIndex: number
    ): { runtimeLine: number; debuggerStartLine: number } {
        if (debug && this.configService.getSettings(this.notebook.uri).stopOnFirstLineWhileDebugging) {
            // Inject the breakpoint line
            source.splice(0, 0, 'breakpoint()\n');

            // Start on the second line
            // Since a breakpoint was added map to the first line (even if blank)
            return { runtimeLine: 2, debuggerStartLine: trueStartLine + 1 };
        }
        // No breakpoint necessary, start on the first line
        // Since no breakpoint was added map to the first non-blank line
        return { runtimeLine: 1, debuggerStartLine: firstNonBlankLineIndex + 1 };
    }
}
