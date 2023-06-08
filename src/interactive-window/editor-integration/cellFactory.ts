// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type * as nbformat from '@jupyterlab/nbformat';
import { NotebookCellKind, NotebookDocument, Range, TextDocument, Uri } from 'vscode';
import { CellMatcher } from './cellMatcher';
import { ICell, ICellRange, IJupyterSettings } from '../../platform/common/types';
import { noop } from '../../platform/common/utils/misc';
import { createJupyterCellFromVSCNotebookCell } from '../../kernels/execution/helpers';
import { appendLineFeed, parseForComments, generateMarkdownFromCodeLines } from '../../platform/common/utils';
import { splitLines } from '../../platform/common/helpers';

export function createCodeCell(): nbformat.ICodeCell;
// eslint-disable-next-line @typescript-eslint/unified-signatures
export function createCodeCell(code: string): nbformat.ICodeCell;
export function createCodeCell(code: string[], outputs: nbformat.IOutput[]): nbformat.ICodeCell;
// eslint-disable-next-line @typescript-eslint/unified-signatures
export function createCodeCell(code: string[], magicCommandsAsComments: boolean): nbformat.ICodeCell;
export function createCodeCell(code?: string | string[], options?: boolean | nbformat.IOutput[]): nbformat.ICodeCell {
    const magicCommandsAsComments = typeof options === 'boolean' ? options : false;
    const outputs = typeof options === 'boolean' ? [] : options || [];
    code = code || '';
    // If we get a string, then no need to append line feeds. Leave as is (to preserve existing functionality).
    // If we get an array, the append a linefeed.
    const source = Array.isArray(code)
        ? appendLineFeed(code, '\n', magicCommandsAsComments ? uncommentMagicCommands : undefined)
        : code;
    return {
        cell_type: 'code',
        execution_count: null,
        metadata: {},
        outputs,
        source
    };
}

export function createMarkdownCell(code: string | string[], useSourceAsIs: boolean = false): nbformat.IMarkdownCell {
    code = Array.isArray(code) ? code : [code];
    return {
        cell_type: 'markdown',
        metadata: {},
        source: useSourceAsIs ? code : generateMarkdownFromCodeLines(code)
    };
}

export function uncommentMagicCommands(line: string): string {
    // Uncomment lines that are shell assignments (starting with #!),
    // line magic (starting with #!%) or cell magic (starting with #!%%).
    if (/^#\s*!/.test(line)) {
        // If the regex test passes, it's either line or cell magic.
        // Hence, remove the leading # and ! including possible white space.
        if (/^#\s*!\s*%%?/.test(line)) {
            return line.replace(/^#\s*!\s*/, '');
        }
        // If the test didn't pass, it's a shell assignment. In this case, only
        // remove leading # including possible white space.
        return line.replace(/^#\s*/, '');
    } else {
        // If it's regular Python code, just return it.
        return line;
    }
}

function generateCodeCell(code: string[], uri: Uri | undefined, magicCommandsAsComments: boolean): ICell {
    // Code cells start out with just source and no outputs.
    return {
        data: createCodeCell(code, magicCommandsAsComments),
        uri
    };
}

function generateMarkdownCell(code: string[], uri: Uri | undefined, useSourceAsIs = false): ICell {
    return {
        uri,
        data: createMarkdownCell(code, useSourceAsIs)
    };
}

export function generateCells(
    settings: IJupyterSettings | undefined,
    code: string,
    uri: Uri | undefined,
    splitMarkdown: boolean
): ICell[] {
    // Determine if we have a markdown cell/ markdown and code cell combined/ or just a code cell
    const split = splitLines(code, { trim: false });
    const firstLine = split[0];
    const matcher = new CellMatcher(settings);
    const { magicCommandsAsComments = false } = settings || {};
    if (matcher.isMarkdown(firstLine)) {
        // We have at least one markdown. We might have to split it if there any lines that don't begin
        // with # or are inside a multiline comment
        let firstNonMarkdown = -1;
        parseForComments(
            split,
            (_s, _i) => noop(),
            (s, i) => {
                // Make sure there's actually some code.
                if (s && s.length > 0 && firstNonMarkdown === -1) {
                    firstNonMarkdown = splitMarkdown ? i : -1;
                }
            }
        );
        if (firstNonMarkdown >= 0) {
            // Make sure if we split, the second cell has a new id. It's a new submission.
            return [
                generateMarkdownCell(split.slice(0, firstNonMarkdown), uri),
                generateCodeCell(split.slice(firstNonMarkdown), uri, magicCommandsAsComments)
            ];
        } else {
            // Just a single markdown cell
            return [generateMarkdownCell(split, uri)];
        }
    } else {
        // Just code
        return [generateCodeCell(split, uri, magicCommandsAsComments)];
    }
}

export function hasCells(document: TextDocument, settings?: IJupyterSettings): boolean {
    const matcher = new CellMatcher(settings);
    for (let index = 0; index < document.lineCount; index += 1) {
        const line = document.lineAt(index);
        if (matcher.isCell(line.text)) {
            return true;
        }
    }

    return false;
}

export function generateCellRangesFromDocument(document: TextDocument, settings?: IJupyterSettings): ICellRange[] {
    // Implmentation of getCells here based on Don's Jupyter extension work
    const matcher = new CellMatcher(settings);
    const cells: ICellRange[] = [];
    for (let index = 0; index < document.lineCount; index += 1) {
        const line = document.lineAt(index);
        if (matcher.isCell(line.text)) {
            if (cells.length > 0) {
                const previousCell = cells[cells.length - 1];
                previousCell.range = new Range(previousCell.range.start, document.lineAt(index - 1).range.end);
            }

            cells.push({
                range: line.range,
                cell_type: matcher.getCellType(line.text)
            });
        }
    }

    if (cells.length >= 1) {
        const line = document.lineAt(document.lineCount - 1);
        const previousCell = cells[cells.length - 1];
        previousCell.range = new Range(previousCell.range.start, line.range.end);
    }

    return cells;
}

export function generateCellsFromDocument(document: TextDocument, settings?: IJupyterSettings): ICell[] {
    const ranges = generateCellRangesFromDocument(document, settings);

    // For each one, get its text and turn it into a cell
    return Array.prototype.concat(
        ...ranges.map((cr) => {
            const code = document.getText(cr.range);
            return generateCells(settings, code, document.uri, false);
        })
    );
}

export function generateCellsFromNotebookDocument(
    notebookDocument: NotebookDocument,
    magicCommandsAsComments: boolean
): ICell[] {
    return notebookDocument
        .getCells()
        .filter((cell) => !cell.metadata.isInteractiveWindowMessageCell)
        .map((cell) => {
            // Reinstate cell structure + comments from cell metadata
            let code = splitLines(cell.document.getText(), { trim: false, removeEmptyEntries: false });
            if (cell.metadata.interactiveWindowCellMarker !== undefined) {
                code.unshift(cell.metadata.interactiveWindowCellMarker + '\n');
            }
            const data = createJupyterCellFromVSCNotebookCell(cell);
            data.source =
                cell.kind === NotebookCellKind.Code
                    ? appendLineFeed(code, '\n', magicCommandsAsComments ? uncommentMagicCommands : undefined)
                    : appendLineFeed(code);
            return {
                data,
                file: ''
            };
        });
}
