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

export interface Location {
    uri: string;
    range: Range;
}

export interface LocationWithReferenceKind extends Location {
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

export function findNotebook(document: vscode.TextDocument): vscode.NotebookDocument | undefined {
    return vscode.workspace.notebookDocuments.find(
        (doc) => doc.uri.authority === document.uri.authority && doc.uri.path === document.uri.path
    );
}

// eslint-disable-next-line no-empty,@typescript-eslint/no-empty-function
export function noop() {}

export const PylanceExtension = 'ms-python.vscode-pylance';
