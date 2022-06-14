// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { parseForComments } from '../../../platform/common/utils';

export function removeLinesFromFrontAndBackNoConcat(lines: string[]): string[] {
    let lastNonEmptyLine = lines.length;
    let firstNonEmptyLine = -1;
    lines.forEach((l, i) => {
        if (l.trim()) {
            lastNonEmptyLine = i;
            if (firstNonEmptyLine < 0) {
                firstNonEmptyLine = i;
            }
        }
    });
    return firstNonEmptyLine >= 0 ? lines.slice(firstNonEmptyLine, lastNonEmptyLine + 1) : [];
}

export function removeLinesFromFrontAndBack(code: string | string[]): string {
    const lines = Array.isArray(code) ? code : code.splitLines({ trim: false, removeEmptyEntries: false });
    return removeLinesFromFrontAndBackNoConcat(lines).join('\n');
}

export function appendLineFeed(arr: string[], eol: string = '\n', modifier?: (s: string) => string) {
    return arr.map((s: string, i: number) => {
        const out = modifier ? modifier(s) : s;
        return i === arr.length - 1 ? `${out}` : `${out}${eol}`;
    });
}

export function generateMarkdownFromCodeLines(lines: string[]) {
    // Generate markdown by stripping out the comments and markdown header
    return appendLineFeed(extractComments(lines.slice(lines.length > 1 ? 1 : 0)));
}

function extractComments(lines: string[]): string[] {
    const result: string[] = [];
    parseForComments(
        lines,
        (s) => result.push(s),
        (_s) => {
            // Do nothing
        }
    );
    return result;
}
