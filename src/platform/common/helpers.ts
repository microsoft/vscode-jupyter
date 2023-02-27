// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IDisposable } from './types';

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
