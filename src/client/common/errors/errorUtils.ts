// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { EOL } from 'os';

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class ErrorUtils {
    public static outputHasModuleNotInstalledError(moduleName: string, content?: string): boolean {
        return content &&
            (content!.indexOf(`No module named ${moduleName}`) > 0 ||
                content!.indexOf(`No module named '${moduleName}'`) > 0)
            ? true
            : false;
    }
}

/**
 * Wraps an error with a custom error message, retaining the call stack information.
 */
export class WrappedError extends Error {
    constructor(message: string, public readonly originalException: Error) {
        super(message);
        // Retain call stack that trapped the error and rethrows this error.
        // Also retain the call stack of the original error.
        this.stack = `${new Error('').stack}${EOL}${EOL}${originalException.stack}`;
    }
}

/**
 * Given a python traceback, attempt to get the Python error message.
 * Generally Python error messages are at the bottom of the traceback.
 */
export function getErrorMessageFromPythonTraceback(traceback: string) {
    if (!traceback) {
        return;
    }
    // Look for something like `NameError: name 'XYZ' is not defined` in the last line.
    const pythonErrorMessageRegExp = /\S+Error: /g;
    const reversedLines = traceback
        .split('\n')
        .filter((item) => item.trim().length)
        .reverse();
    if (reversedLines.length === 0) {
        return;
    }
    const lastLine = reversedLines[0];
    return lastLine.match(pythonErrorMessageRegExp) ? lastLine : undefined;
}
