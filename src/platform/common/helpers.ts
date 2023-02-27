// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { IDisposable } from './types';

/**
 * Split a string using the cr and lf characters and return them as an array.
 * By default lines are trimmed and empty lines are removed.
 * @param {SplitLinesOptions=} splitOptions - Options used for splitting the string.
 */
export function splitLines(
    value: string,
    splitOptions: { trim: boolean; removeEmptyEntries?: boolean } = { removeEmptyEntries: true, trim: true }
): string[] {
    value = value || '';
    let lines = value.split(/\r?\n/g);
    if (splitOptions && splitOptions.trim) {
        lines = lines.map((line) => line.trim());
    }
    if (splitOptions && splitOptions.removeEmptyEntries) {
        lines = lines.filter((line) => line.length > 0);
    }
    return lines;
}

export function disposeAllDisposables(disposables: IDisposable[] = []) {
    while (disposables.length) {
        const disposable = disposables.shift();
        if (disposable) {
            try {
                disposable.dispose();
            } catch {
                // Don't care.
            }
        }
    }
}

/**
 * String.format() implementation.
 * Tokens such as {0}, {1} will be replaced with corresponding positional arguments.
 */
export function format(value: string, ...args: string[]) {
    return value.replace(/{(\d+)}/g, (match, number) => (args[number] === undefined ? match : args[number]));
}
