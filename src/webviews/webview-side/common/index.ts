// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

const SingleQuoteMultiline = "'''";
const DoubleQuoteMultiline = '"""';

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
        (_s) => {
            // Do nothing
        },
        (s) => (result = result.concat(`${s}\n`))
    );
    return result;
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
        (_s) => {
            // Do nothing
        }
    );
    return result;
}
