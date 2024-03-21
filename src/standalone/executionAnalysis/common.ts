// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';

export interface Range {
    /**
     * The range's start position
     */
    start: Position;
    /**
     * The range's end position.
     */
    end: Position;
}

export namespace Range {
    export function isEmpty(range: Range): boolean {
        return range.start.line === range.end.line && range.start.character === range.end.character;
    }

    export function intersects(range: Range, otherRange: Range): boolean {
        let resultStartLineNumber = range.start.line;
        let resultStartColumn = range.start.character;
        let resultEndLineNumber = range.end.line;
        let resultEndColumn = range.end.character;
        const otherStartLineNumber = otherRange.start.line;
        const otherStartColumn = otherRange.start.character;
        const otherEndLineNumber = otherRange.end.line;
        const otherEndColumn = otherRange.end.character;

        if (resultStartLineNumber < otherStartLineNumber) {
            resultStartLineNumber = otherStartLineNumber;
            resultStartColumn = otherStartColumn;
        } else if (resultStartLineNumber === otherStartLineNumber) {
            resultStartColumn = Math.max(resultStartColumn, otherStartColumn);
        }

        if (resultEndLineNumber > otherEndLineNumber) {
            resultEndLineNumber = otherEndLineNumber;
            resultEndColumn = otherEndColumn;
        } else if (resultEndLineNumber === otherEndLineNumber) {
            resultEndColumn = Math.min(resultEndColumn, otherEndColumn);
        }

        // Check if selection is now empty
        if (resultStartLineNumber > resultEndLineNumber) {
            return false;
        }
        if (resultStartLineNumber === resultEndLineNumber && resultStartColumn > resultEndColumn) {
            return false;
        }

        return true;
    }
}

export interface Position {
    /**
     * Line position in a document (zero-based).
     */
    line: number;
    /**
     * Character offset on a line in a document (zero-based). Assuming that the line is
     * represented as a string, the `character` value represents the gap between the
     * `character` and `character + 1`.
     *
     * If the character value is greater than the line length it defaults back to the
     * line length.
     */
    character: number;
}

export interface LocationWithReferenceKind extends vscode.Location {
    kind?: string;
}

export function cellIndexesToRanges(indexes: number[]): vscode.NotebookRange[] {
    indexes.sort((a, b) => a - b);
    const first = indexes.shift();

    if (first === undefined) {
        return [];
    }

    return indexes
        .reduce(
            function (ranges, num) {
                if (num <= ranges[0][1]) {
                    ranges[0][1] = num + 1;
                } else {
                    ranges.unshift([num, num + 1]);
                }
                return ranges;
            },
            [[first, first + 1]]
        )
        .reverse()
        .map((val) => new vscode.NotebookRange(val[0], val[1]));
}

export function cellRangesToIndexes(ranges: vscode.NotebookRange[]): number[] {
    const indexes = ranges.reduce((a, b) => {
        for (let i = b.start; i < b.end; i++) {
            a.push(i);
        }

        return a;
    }, [] as number[]);

    return indexes;
}

function findNotebook(document: vscode.TextDocument): vscode.NotebookDocument | undefined {
    return vscode.workspace.notebookDocuments.find(
        (doc) => doc.uri.authority === document.uri.authority && doc.uri.path === document.uri.path
    );
}

export function findNotebookAndCell(
    cell: vscode.NotebookCell | undefined
): { notebook: vscode.NotebookDocument; cell: vscode.NotebookCell } | undefined {
    const doc =
        vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === cell?.document.uri.toString()) ??
        vscode.window.activeTextEditor?.document;
    if (!doc) {
        return;
    }

    const notebook = findNotebook(doc);
    if (!notebook) {
        return;
    }
    const cells = notebook.getCells();
    const currentCell = cells.find((cell) => cell.document.uri.toString() === doc.uri.toString());
    if (!currentCell) {
        return;
    }

    return { notebook, cell: currentCell };
}

export function areRangesEqual(a: Range | vscode.Range, b: Range | vscode.Range) {
    return (
        a.start.line === b.start.line &&
        a.start.character === b.start.character &&
        a.end.line === b.end.line &&
        a.end.character === b.end.character
    );
}

// eslint-disable-next-line no-empty,@typescript-eslint/no-empty-function
export function noop() {}

export const PylanceExtension = 'ms-python.vscode-pylance';
