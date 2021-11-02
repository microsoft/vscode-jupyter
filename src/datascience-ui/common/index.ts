// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import type * as nbformat from '@jupyterlab/nbformat';
import { noop } from '../../client/common/utils/misc';

const SingleQuoteMultiline = "'''";
const DoubleQuoteMultiline = '"""';

export function concatMultilineString(str: nbformat.MultilineString, trim?: boolean): string {
    const nonLineFeedWhiteSpaceTrim = /(^[\t\f\v\r ]+|[\t\f\v\r ]+$)/g; // Local var so don't have to reset the lastIndex.
    if (Array.isArray(str)) {
        let result = '';
        for (let i = 0; i < str.length; i += 1) {
            const s = str[i];
            if (i < str.length - 1 && !s.endsWith('\n')) {
                result = result.concat(`${s}\n`);
            } else {
                result = result.concat(s);
            }
        }

        // Just trim whitespace. Leave \n in place
        return trim ? result.replace(nonLineFeedWhiteSpaceTrim, '') : result;
    }
    return trim ? str.toString().replace(nonLineFeedWhiteSpaceTrim, '') : str.toString();
}

export function splitMultilineString(source: nbformat.MultilineString): string[] {
    // Make sure a multiline string is back the way Jupyter expects it
    if (Array.isArray(source)) {
        return source as string[];
    }
    const str = source.toString();
    if (str.length > 0) {
        // Each line should be a separate entry, but end with a \n if not last entry
        const arr = str.split('\n');
        return arr
            .map((s, i) => {
                if (i < arr.length - 1) {
                    return `${s}\n`;
                }
                return s;
            })
            .filter((s) => s.length > 0); // Skip last one if empty (it's the only one that could be length 0)
    }
    return [];
}

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

// Strip out comment lines from code
export function stripComments(str: string): string {
    let result: string = '';
    parseForComments(
        str.splitLines({ trim: false, removeEmptyEntries: false }),
        (_s) => noop,
        (s) => (result = result.concat(`${s}\n`))
    );
    return result;
}

// Took this from jupyter/notebook
// https://github.com/jupyter/notebook/blob/b8b66332e2023e83d2ee04f83d8814f567e01a4e/notebook/static/base/js/utils.js
// Remove characters that are overridden by backspace characters
function fixBackspace(txt: string) {
    let tmp = txt;
    do {
        txt = tmp;
        // Cancel out anything-but-newline followed by backspace
        tmp = txt.replace(/[^\n]\x08/gm, '');
    } while (tmp.length < txt.length);
    return txt;
}

// Remove chunks that should be overridden by the effect of
// carriage return characters
// From https://github.com/jupyter/notebook/blob/master/notebook/static/base/js/utils.js
function fixCarriageReturn(txt: string) {
    txt = txt.replace(/\r+\n/gm, '\n'); // \r followed by \n --> newline
    while (txt.search(/\r[^$]/g) > -1) {
        var base = txt.match(/^(.*)\r+/m)![1];
        var insert = txt.match(/\r+(.*)$/m)![1];
        insert = insert + base.slice(insert.length, base.length);
        txt = txt.replace(/\r+.*$/m, '\r').replace(/^.*\r/m, insert);
    }
    return txt;
}
export function formatStreamText(str: string): string {
    // Do the same thing jupyter is doing
    return fixCarriageReturn(fixBackspace(str));
}

export function appendLineFeed(arr: string[], modifier?: (s: string) => string) {
    return arr.map((s: string, i: number) => {
        const out = modifier ? modifier(s) : s;
        return i === arr.length - 1 ? `${out}` : `${out}\n`;
    });
}

export function generateMarkdownFromCodeLines(lines: string[]) {
    // Generate markdown by stripping out the comments and markdown header
    return appendLineFeed(extractComments(lines.slice(lines.length > 1 ? 1 : 0)));
}

// eslint-disable-next-line complexity
export function parseForComments(
    lines: string[],
    foundCommentLine: (s: string, i: number) => void,
    foundNonCommentLine: (s: string, i: number) => void
) {
    // Check for either multiline or single line comments
    let insideMultilineComment: string | undefined;
    let insideMultilineQuote: string | undefined;
    let pos = 0;
    for (const l of lines) {
        const trim = l.trim();
        // Multiline is triple quotes of either kind
        const isMultilineComment = trim.startsWith(SingleQuoteMultiline)
            ? SingleQuoteMultiline
            : trim.startsWith(DoubleQuoteMultiline)
            ? DoubleQuoteMultiline
            : undefined;
        const isMultilineQuote = trim.includes(SingleQuoteMultiline)
            ? SingleQuoteMultiline
            : trim.includes(DoubleQuoteMultiline)
            ? DoubleQuoteMultiline
            : undefined;

        // Check for ending quotes of multiline string
        if (insideMultilineQuote) {
            if (insideMultilineQuote === isMultilineQuote) {
                insideMultilineQuote = undefined;
            }
            foundNonCommentLine(l, pos);
            // Not inside quote, see if inside a comment
        } else if (insideMultilineComment) {
            if (insideMultilineComment === isMultilineComment) {
                insideMultilineComment = undefined;
            }
            if (insideMultilineComment) {
                foundCommentLine(l, pos);
            }
            // Not inside either, see if starting a quote
        } else if (isMultilineQuote && !isMultilineComment) {
            // Make sure doesn't begin and end on the same line.
            const beginQuote = trim.indexOf(isMultilineQuote);
            const endQuote = trim.lastIndexOf(isMultilineQuote);
            insideMultilineQuote = endQuote !== beginQuote ? undefined : isMultilineQuote;
            foundNonCommentLine(l, pos);
            // Not starting a quote, might be starting a comment
        } else if (isMultilineComment) {
            // See if this line ends the comment too or not
            const endIndex = trim.indexOf(isMultilineComment, 3);
            insideMultilineComment = endIndex >= 0 ? undefined : isMultilineComment;

            // Might end with text too
            if (trim.length > 3) {
                foundCommentLine(trim.slice(3, endIndex >= 0 ? endIndex : undefined), pos);
            }
        } else {
            // Normal line
            if (trim.startsWith('#')) {
                foundCommentLine(trim.slice(1), pos);
            } else {
                foundNonCommentLine(l, pos);
            }
        }
        pos += 1;
    }
}

function extractComments(lines: string[]): string[] {
    const result: string[] = [];
    parseForComments(
        lines,
        (s) => result.push(s),
        (_s) => noop()
    );
    return result;
}
