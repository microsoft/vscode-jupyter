// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* Generate a RegExp from a "verbose" pattern.
 *
 * All whitespace in the pattern is removed, including newlines.  This
 * allows the pattern to be much more readable by allowing it to span
 * multiple lines and to separate tokens with insignificant whitespace.
 * The functionality is similar to the VERBOSE ("x") flag in Python's
 * regular expressions.
 *
 * Note that significant whitespace in the pattern must be explicitly
 * indicated by "\s".  Also, unlike with regular expression literals,
 * backslashes must be escaped.  Conversely, forward slashes do not
 * need to be escaped.
 *
 * Line comments are also removed.  A comment is two spaces followed
 * by `#` followed by a space and then the rest of the text to the
 * end of the line.
 */
export function verboseRegExp(pattern: string, flags?: string): RegExp {
    pattern = pattern.replace(/(^| {2})# .*$/gm, '');
    pattern = pattern.replace(/\s+?/g, '');
    return RegExp(pattern, flags);
}

const SpecialCharsRegEx = /[\.\+\?\^\$\{\}\(\)\|\[\]\\]/;

export function buildDataViewerFilterRegex(filter: string): RegExp {
    let flags = '';

    // Allow an = operator. It's exact match. Anchor at start and end
    if (filter.startsWith('=')) {
        filter = `^${filter.substr(1).trim()}$`;
    } else if (!SpecialCharsRegEx.test(filter)) {
        // If no special chars, then match everything that has
        // this text in the middle. Default option
        filter = `^.*${filter}.*$`;

        // This option is also case insensitive
        flags = 'i';
    }

    // Otherwise let the user type a normal regex
    return new RegExp(filter, flags);
}

/**
 * This code was copied from strip-ansi (https://github.com/chalk/strip-ansi/blob/main/index.js)
 * because it wasn't loading in mocha. Since it was so simple, we just moved it here.
 * @param str
 * @returns
 */
export function stripAnsi(str: string) {
    if (typeof str !== 'string') {
        throw new TypeError(`Expected a \`string\`, got \`${typeof str}\``);
    }

    var ansiRegex = require('ansi-regex');

    // Special case ansiregex for running on test machines. Seems to not have a 'default'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ansiRegexFunc = ansiRegex as any;
    if (ansiRegexFunc.default) {
        ansiRegexFunc = ansiRegexFunc.default;
    }

    return str.replace(ansiRegexFunc(), '');
}
