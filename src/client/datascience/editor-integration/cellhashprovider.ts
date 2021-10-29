// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import * as hashjs from 'hash.js';
import { inject, injectable, multiInject, optional } from 'inversify';
import stripAnsi from 'strip-ansi';
import {
    Disposable,
    Event,
    EventEmitter,
    NotebookCell,
    NotebookCellKind,
    Position,
    Range,
    TextDocumentChangeEvent,
    TextDocumentContentChangeEvent
} from 'vscode';

import { splitMultilineString } from '../../../datascience-ui/common';
import { uncommentMagicCommands } from '../../../datascience-ui/common/cellFactory';
import { IDebugService, IDocumentManager } from '../../common/application/types';
import { traceInfo } from '../../common/logger';
import { IFileSystem } from '../../common/platform/types';

import { IConfigurationService } from '../../common/types';
import { getCellResource } from '../cellFactory';
import { CellMatcher } from '../cellMatcher';
import { getInteractiveCellMetadata } from '../interactive-window/interactiveWindow';
import { IKernel } from '../jupyter/kernels/types';
import { ICellHash, ICellHashListener, ICellHashProvider, IFileHashes } from '../types';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const _escapeRegExp = require('lodash/escapeRegExp') as typeof import('lodash/escapeRegExp'); // NOSONAR
const LineNumberMatchRegex = /(;32m[ ->]*?)(\d+)(.*)/g;

interface IRangedCellHash extends ICellHash {
    code: string;
    startOffset: number;
    endOffset: number;
    deleted: boolean;
    realCode: string;
    trimmedRightCode: string;
    firstNonBlankLineIndex: number; // zero based. First non blank line of the real code.
}

// This class provides hashes for debugging jupyter cells. Call getHashes just before starting debugging to compute all of the
// hashes for cells.
@injectable()
export class CellHashProvider implements ICellHashProvider {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private postEmitter: EventEmitter<{ message: string; payload: any }> = new EventEmitter<{
        message: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payload: any;
    }>();
    // Map of file to Map of start line to actual hash
    private executionCount: number = 0;
    private hashes: Map<string, IRangedCellHash[]> = new Map<string, IRangedCellHash[]>();
    private updateEventEmitter: EventEmitter<void> = new EventEmitter<void>();
    private traceBackRegexes = new Map<string, RegExp[]>();
    private disposables: Disposable[] = [];

    constructor(
        @inject(IDocumentManager) private documentManager: IDocumentManager,
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(IDebugService) private debugService: IDebugService,
        @inject(IFileSystem) private fs: IFileSystem,
        @multiInject(ICellHashListener) @optional() private listeners: ICellHashListener[] | undefined,
        kernel: IKernel
    ) {
        // Watch document changes so we can update our hashes
        this.documentManager.onDidChangeTextDocument(this.onChangedDocument.bind(this));
        this.disposables.push(kernel.onRestarted(() => this.onKernelRestarted()));
    }

    public dispose() {
        this.hashes.clear();
        this.traceBackRegexes.clear();
        this.disposables.forEach((d) => d.dispose());
    }

    public get updated(): Event<void> {
        return this.updateEventEmitter.event;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public get postMessage(): Event<{ message: string; payload: any }> {
        return this.postEmitter.event;
    }

    public getHashes(): IFileHashes[] {
        return [...this.hashes.entries()]
            .map((e) => {
                return {
                    file: e[0],
                    hashes: e[1].filter((h) => !h.deleted)
                };
            })
            .filter((e) => e.hashes.length > 0);
    }

    public onKernelRestarted() {
        this.hashes.clear();
        this.traceBackRegexes.clear();
        this.executionCount = 0;
        this.updateEventEmitter.fire();
    }

    public async addCellHash(cell: NotebookCell) {
        // Skip non-code cells as they are never actually executed
        if (cell.kind !== NotebookCellKind.Code) {
            return undefined;
        }
        // Don't log empty cells
        const executableLines = this.extractExecutableLines(cell);
        if (executableLines.length > 0 && executableLines.find((s) => s.trim().length > 0)) {
            // When the user adds new code, we know the execution count is increasing
            this.executionCount += 1;

            // Skip hash on unknown file though
            if (getInteractiveCellMetadata(cell)?.interactive?.file) {
                return this.generateHash(cell, this.executionCount);
            }
        }
    }

    public extractExecutableLines(cell: NotebookCell): string[] {
        const settings = this.configService.getSettings(getCellResource(cell));
        const cellMatcher = new CellMatcher(settings);
        const lines = splitMultilineString(cell.metadata.interactive?.originalSource ?? cell.document.getText());

        if (settings.magicCommandsAsComments) {
            lines.forEach((line, index) => (lines[index] = uncommentMagicCommands(line)));
        }

        // Only strip this off the first line. Otherwise we want the markers in the code.
        if (lines.length > 0 && (cellMatcher.isCode(lines[0]) || cellMatcher.isMarkdown(lines[0]))) {
            return lines.slice(1);
        }
        return lines;
    }

    private async generateHash(cell: NotebookCell, expectedCount: number) {
        if (cell.metadata.interactive === undefined) {
            return;
        }
        // Find the text document that matches. We need more information than
        // the add code gives us
        const { line: cellLine, file } = cell.metadata.interactive;
        const id = getInteractiveCellMetadata(cell)?.id;
        const doc = this.documentManager.textDocuments.find((d) => this.fs.areLocalPathsSame(d.fileName, file));
        if (doc && id) {
            // Compute the code that will really be sent to jupyter
            const { stripped, trueStartLine } = this.extractStrippedLines(cell);

            const line = doc.lineAt(trueStartLine);
            const endLine = doc.lineAt(Math.min(trueStartLine + stripped.length - 1, doc.lineCount - 1));

            // Find the first non blank line
            let firstNonBlankIndex = 0;
            while (firstNonBlankIndex < stripped.length && stripped[firstNonBlankIndex].trim().length === 0) {
                firstNonBlankIndex += 1;
            }

            // Use the original values however to track edits. This is what we need
            // to move around
            const startOffset = doc.offsetAt(new Position(cellLine, 0));
            const endOffset = doc.offsetAt(endLine.rangeIncludingLineBreak.end);

            // Compute the runtime line and adjust our cell/stripped source for debugging
            const runtimeLine = this.adjustRuntimeForDebugging(cell, stripped);
            const hashedCode = stripped.join('');
            const realCode = doc.getText(new Range(new Position(cellLine, 0), endLine.rangeIncludingLineBreak.end));
            const hashValue = hashjs.sha1().update(hashedCode).digest('hex').substr(0, 12);

            const hash: IRangedCellHash = {
                hash: hashValue,
                line: line ? line.lineNumber + 1 : 1,
                endLine: endLine ? endLine.lineNumber + 1 : 1,
                firstNonBlankLineIndex: firstNonBlankIndex + trueStartLine,
                executionCount: expectedCount,
                startOffset,
                endOffset,
                deleted: false,
                code: hashedCode,
                trimmedRightCode: stripped.map((s) => s.replace(/[ \t\r]+\n$/g, '\n')).join(''),
                realCode,
                runtimeLine,
                runtimeFile: this.getRuntimeFile(hashValue, expectedCount),
                id: id,
                timestamp: Date.now()
            };

            traceInfo(`Adding hash for ${expectedCount} = ${hash.hash} with ${stripped.length} lines`);

            let list = this.hashes.get(file);
            if (!list) {
                list = [];
            }

            // Figure out where to put the item in the list
            let inserted = false;
            for (let i = 0; i < list.length && !inserted; i += 1) {
                const pos = list[i];
                if (hash.line >= pos.line && hash.line <= pos.endLine) {
                    // Stick right here. This is either the same cell or a cell that overwrote where
                    // we were.
                    list.splice(i, 1, hash);
                    inserted = true;
                } else if (pos.line > hash.line) {
                    // This item comes just after the cell we're inserting.
                    list.splice(i, 0, hash);
                    inserted = true;
                }
            }
            if (!inserted) {
                list.push(hash);
            }
            this.hashes.set(file, list);

            // Save a regex to find this file later when looking for
            // exceptions in output
            if (!this.traceBackRegexes.has(file)) {
                const fileMatchRegex = new RegExp(`\\[.*?;32m${_escapeRegExp(file)}`);
                const fileDisplayNameMatchRegex = new RegExp(
                    `\\[.*?;32m${_escapeRegExp(this.fs.getDisplayName(file))}`
                );
                this.traceBackRegexes.set(file, [fileMatchRegex, fileDisplayNameMatchRegex]);
            }

            // Tell listeners we have new hashes.
            if (this.listeners) {
                const hashes = this.getHashes();
                await Promise.all(this.listeners.map((l) => l.hashesUpdated(hashes)));

                // Then fire our event
                this.updateEventEmitter.fire();
            }

            return hash;
        }
    }

    public getExecutionCount(): number {
        return this.executionCount;
    }

    public incExecutionCount(): void {
        this.executionCount += 1;
    }

    private getRuntimeFile(hash: string, executionCount: number) {
        return `<ipython-input-${executionCount}-${hash}>`;
    }

    private onChangedDocument(e: TextDocumentChangeEvent) {
        // See if the document is in our list of docs to watch
        const perFile = this.hashes.get(e.document.fileName);
        if (perFile) {
            // Apply the content changes to the file's cells.
            const docText = e.document.getText();
            e.contentChanges.forEach((c) => {
                this.handleContentChange(docText, c, perFile);
            });
        }
    }

    private extractStrippedLines(cell: NotebookCell): { stripped: string[]; trueStartLine: number } {
        const lines = splitMultilineString(cell.metadata.interactive?.originalSource);
        // Compute the code that will really be sent to jupyter
        const stripped = this.extractExecutableLines(cell);

        // Figure out our true 'start' line. This is what we need to tell the debugger is
        // actually the start of the code as that's what Jupyter will be getting.
        let trueStartLine = cell.metadata.interactive?.line;
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

    private handleContentChange(docText: string, c: TextDocumentContentChangeEvent, hashes: IRangedCellHash[]) {
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

    private adjustRuntimeForDebugging(cell: NotebookCell, source: string[]): number {
        if (
            this.debugService.activeDebugSession &&
            this.configService.getSettings(getCellResource(cell)).stopOnFirstLineWhileDebugging
        ) {
            // Inject the breakpoint line
            source.splice(0, 0, 'breakpoint()\n');

            // Start on the second line
            return 2;
        }
        // No breakpoint necessary, start on the first line
        return 1;
    }

    /**
     * This function will modify a traceback from an error message.
     * Tracebacks take a form like so:
     * "[1;31m---------------------------------------------------------------------------[0m"
     * "[1;31mZeroDivisionError[0m                         Traceback (most recent call last)"
     * "[1;32md:\Training\SnakePython\foo.py[0m in [0;36m<module>[1;34m[0m\n[0;32m      1[0m [0mprint[0m[1;33m([0m[1;34m'some more'[0m[1;33m)[0m[1;33m[0m[1;33m[0m[0m\n    [1;32m----> 2[1;33m [0mcause_error[0m[1;33m([0m[1;33m)[0m[1;33m[0m[1;33m[0m[0m\n    [0m"
     * "[1;32md:\Training\SnakePython\foo.py[0m in [0;36mcause_error[1;34m()[0m\n[0;32m      3[0m     [0mprint[0m[1;33m([0m[1;34m'error'[0m[1;33m)[0m[1;33m[0m[1;33m[0m[0m\n    [0;32m      4[0m     [0mprint[0m[1;33m([0m[1;34m'now'[0m[1;33m)[0m[1;33m[0m[1;33m[0m[0m\n    [1;32m----> 5[1;33m     [0mprint[0m[1;33m([0m [1;36m1[0m [1;33m/[0m [1;36m0[0m[1;33m)[0m[1;33m[0m[1;33m[0m[0m\n    [0m"
     * "[1;31mZeroDivisionError[0m: division by zero"
     * Each item in the array being a stack frame.
     */
    public modifyTraceback(traceback: string[]): string[] {
        // Do one frame at a time.
        return Array.isArray(traceback) ? traceback.map(this.modifyTracebackFrame.bind(this)) : [];
    }

    private findCellOffset(hashes: IRangedCellHash[] | undefined, codeLines: string): number | undefined {
        if (hashes) {
            // Go through all cell code looking for these code lines exactly
            // (although with right side trimmed as that's what a stack trace does)
            for (const hash of hashes) {
                const index = hash.trimmedRightCode.indexOf(codeLines);
                if (index >= 0) {
                    // Jupyter isn't counting blank lines at the top so use our
                    // first non blank line
                    return hash.firstNonBlankLineIndex;
                }
            }
        }
        // No hash found
        return undefined;
    }

    private modifyTracebackFrame(traceFrame: string): string {
        // See if this item matches any of our cell files
        const regexes = [...this.traceBackRegexes.entries()];
        const match = regexes.find((e) => {
            return e[1].some((regExp) => regExp.test(traceFrame));
        });
        if (match) {
            // We have a match, pull out the source lines
            let sourceLines = '';
            const regex = /(;32m[ ->]*?)(\d+)(.*)/g;
            for (let l = regex.exec(traceFrame); l && l.length > 3; l = regex.exec(traceFrame)) {
                const newLine = stripAnsi(l[3]).substr(1); // Seem to have a space on the front
                sourceLines = `${sourceLines}${newLine}\n`;
            }

            // Now attempt to find a cell that matches these source lines
            const offset = this.findCellOffset(this.hashes.get(match[0]), sourceLines);
            if (offset !== undefined) {
                return traceFrame.replace(LineNumberMatchRegex, (_s, prefix, num, suffix) => {
                    const n = parseInt(num, 10);
                    const newLine = offset + n - 1;
                    return `${prefix}<a href='file://${match[0]}?line=${newLine}'>${newLine + 1}</a>${suffix}`;
                });
            }
        } else {
            const matchingFile = regexes.find((e) => traceFrame.includes(e[0]));
            if (matchingFile) {
                const offset = this.findCellOffset(this.hashes.get(matchingFile[0]), traceFrame);
                if (offset) {
                    return traceFrame.replace(LineNumberMatchRegex, (_s, prefix, num, suffix) => {
                        const n = parseInt(num, 10);
                        const newLine = offset + n - 1;
                        return `${prefix}<a href='file://${matchingFile[0]}?line=${newLine}'>${
                            newLine + 1
                        }</a>${suffix}`;
                    });
                }
            }
        }
        return traceFrame;
    }
}
