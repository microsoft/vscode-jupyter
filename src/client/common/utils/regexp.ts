// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

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
