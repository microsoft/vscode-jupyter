// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SemVer, parse } from 'semver';
import type * as nbformat from '@jupyterlab/nbformat';
import * as uriPath from '../../platform/vscode-path/resources';
import { NotebookData, NotebookDocument, TextDocument, Uri, workspace } from 'vscode';
import {
    InteractiveWindowView,
    jupyterLanguageToMonacoLanguageMapping,
    JupyterNotebookView,
    WIDGET_STATE_MIMETYPE
} from './constants';
import { splitLines } from './helpers';

// Can't figure out a better way to do this. Enumerate
// the allowed keys of different output formats.
const dummyStreamObj: nbformat.IStream = {
    output_type: 'stream',
    name: 'stdout',
    text: ''
};
const dummyErrorObj: nbformat.IError = {
    output_type: 'error',
    ename: '',
    evalue: '',
    traceback: ['']
};
const dummyDisplayObj: nbformat.IDisplayData = {
    output_type: 'display_data',
    data: {},
    metadata: {}
};
const dummyExecuteResultObj: nbformat.IExecuteResult = {
    output_type: 'execute_result',
    execution_count: 0,
    data: {},
    metadata: {}
};
export const AllowedCellOutputKeys = {
    ['stream']: new Set(Object.keys(dummyStreamObj)),
    ['error']: new Set(Object.keys(dummyErrorObj)),
    ['display_data']: new Set(Object.keys(dummyDisplayObj)),
    ['execute_result']: new Set(Object.keys(dummyExecuteResultObj))
};

export function getResourceType(uri?: Uri): 'notebook' | 'interactive' {
    if (!uri) {
        return 'interactive';
    }
    // this returns `interactive` for any resource that isn't *.ipynb - that seems wrong
    return uriPath.extname(uri).toLowerCase().endsWith('ipynb') ? 'notebook' : 'interactive';
}

function fixupOutput(output: nbformat.IOutput): nbformat.IOutput {
    let allowedKeys: Set<string>;
    switch (output.output_type) {
        case 'stream':
        case 'error':
        case 'execute_result':
        case 'display_data':
            allowedKeys = AllowedCellOutputKeys[output.output_type];
            break;
        default:
            return output;
    }
    const result = { ...output };
    for (const k of Object.keys(output)) {
        if (!allowedKeys.has(k)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            delete (result as any)[k];
        }
    }
    return result;
}

export function pruneCell(cell: nbformat.ICell): nbformat.ICell {
    // Source is usually a single string on input. Convert back to an array
    const result = {
        ...cell,
        source: splitMultilineString(cell.source)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any as nbformat.ICell; // nyc (code coverage) barfs on this so just trick it.

    // Remove outputs and execution_count from non code cells
    if (result.cell_type !== 'code') {
        // Map to any so nyc will build.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (<any>result).outputs;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (<any>result).execution_count;
    } else if (result.cell_type) {
        // Clean outputs from code cells
        const cellResult = result as nbformat.ICodeCell;
        cellResult.outputs = cellResult.outputs ? (cellResult.outputs as nbformat.IOutput[]).map(fixupOutput) : [];
    }

    return result;
}

export function translateKernelLanguageToMonaco(language: string): string {
    language = language.toLowerCase();
    if (language.length === 2 && language.endsWith('#')) {
        return `${language.substring(0, 1)}sharp`;
    }
    return jupyterLanguageToMonacoLanguageMapping.get(language) || language;
}

/**
 * Whether this is a Notebook we created/manage/use.
 * Remember, there could be other notebooks such as GitHub Issues nb by VS Code.
 */
export function isJupyterNotebook(document: NotebookDocument): boolean;
// eslint-disable-next-line @typescript-eslint/unified-signatures
export function isJupyterNotebook(viewType: string): boolean;
export function isJupyterNotebook(option: NotebookDocument | string) {
    if (typeof option === 'string') {
        return option === JupyterNotebookView || option === InteractiveWindowView;
    } else {
        return option.notebookType === JupyterNotebookView || option.notebookType === InteractiveWindowView;
    }
}
export type NotebookMetadata = nbformat.INotebookMetadata & {
    /**
     * We used to store interpreter at this level.
     * @deprecated
     */
    interpreter?: { hash?: string };
    /**
     * As per docs in Jupyter, custom metadata should go into a separate namespace.
     */
    vscode?: {
        /**
         * If we've selected a Python env for this notebook, then this is the hash of the interpreter.
         */
        interpreter?: {
            /**
             * Hash of the interpreter executable path.
             */
            hash?: string;
        };
    };
    widgets?: {
        [WIDGET_STATE_MIMETYPE]?: {
            state: Record<
                string,
                {
                    model_module: '@jupyter-widgets/base' | '@jupyter-widgets/controls' | string;
                    model_module_version: string;
                    model_name: string;
                    state: {};
                }
            >;
            version_major: number;
            version_minor: number;
        };
    };
};

export function getNotebookMetadata(document: NotebookDocument | NotebookData): NotebookMetadata | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const notebookContent: undefined | Partial<nbformat.INotebookContent> = document.metadata?.custom as any;
    // Create a clone.
    return JSON.parse(JSON.stringify(notebookContent?.metadata || {}));
}

export function getNotebookFormat(document: NotebookDocument): {
    nbformat: number | undefined;
    nbformat_minor: number | undefined;
} {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const notebookContent: undefined | Partial<nbformat.INotebookContent> = document.metadata?.custom as any;
    // Create a clone.
    return {
        nbformat: notebookContent?.nbformat,
        nbformat_minor: notebookContent?.nbformat_minor
    };
}

export function getAssociatedJupyterNotebook(document: TextDocument): NotebookDocument | undefined {
    return workspace.notebookDocuments.find(
        (notebook) => isJupyterNotebook(notebook) && notebook.getCells().some((cell) => cell.document === document)
    );
}

export function concatMultilineString(str: nbformat.MultilineString): string {
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
        return result;
    }
    return str.toString();
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

const SingleQuoteMultiline = "'''";
const DoubleQuoteMultiline = '"""';

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

// Strip out comment lines from code
export function stripComments(str: string): string {
    let result: string = '';
    parseForComments(
        splitLines(str, { trim: false, removeEmptyEntries: false }),
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

export function generateMarkdownFromCodeLines(lines: string[]) {
    // Generate markdown by stripping out the comments and markdown header
    return appendLineFeed(extractComments(lines.slice(lines.length > 1 ? 1 : 0)));
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
    const lines = Array.isArray(code) ? code : splitLines(code, { trim: false, removeEmptyEntries: false });
    return removeLinesFromFrontAndBackNoConcat(lines).join('\n');
}

// For the given string parse it out to a SemVer or return undefined
export function parseSemVer(versionString: string): SemVer | undefined {
    const versionMatch = /^\s*(\d+)\.(\d+)\.(.+)\s*$/.exec(versionString);
    if (versionMatch && versionMatch.length > 2) {
        const major = parseInt(versionMatch[1], 10);
        const minor = parseInt(versionMatch[2], 10);
        const build = parseInt(versionMatch[3], 10);
        return parse(`${major}.${minor}.${build}`, true) ?? undefined;
    }
}
