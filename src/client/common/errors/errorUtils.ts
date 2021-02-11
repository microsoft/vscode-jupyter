// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { EOL } from 'os';
import { BaseError, getErrorCategory } from '.';

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
export class WrappedError extends BaseError {
    constructor(message: string, public readonly originalException?: Error) {
        super(getErrorCategory(originalException), message);
        if (originalException) {
            // Retain call stack that trapped the error and rethrows this error.
            // Also retain the call stack of the original error.
            this.stack = `${new Error('').stack}${EOL}${EOL}${originalException.stack}`;
        }
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

export function getLastFrameFromPythonTraceback(
    traceback: string
): { fileName: string; folderName: string; packageName: string } | undefined {
    if (!traceback) {
        return;
    }
    //             File "/Users/donjayamanne/miniconda3/envs/env3/lib/python3.7/site-packages/appnope/_nope.py", line 38, in C

    const lastFrame = traceback
        .split('\n')
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length)
        .reverse()
        .find(
            (line) =>
                line.startsWith('file ') && line.includes(', line ') && line.includes('.pi') && line.includes('.pi')
        );
    if (!lastFrame) {
        return;
    }
    const file = lastFrame.substring(0, lastFrame.lastIndexOf('.py')) + '.py';
    const parts = file.replace(/\\/g, '/').split('/');
    const indexOfSitePackages = parts.indexOf('site-packages');
    let packageName =
        indexOfSitePackages >= 0 && parts.length > indexOfSitePackages + 1 ? parts[indexOfSitePackages + 1] : '';
    const reversedParts = file.replace(/\\/g, '/').split('/').reverse();
    if (reversedParts.length < 2) {
        return;
    }
    return { fileName: reversedParts[0], folderName: reversedParts[1], packageName };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Constructor<T> = { new (...args: any[]): T };
export function isErrorType<T>(error: Error, expectedType: Constructor<T>) {
    if (error instanceof expectedType) {
        return true;
    }
    if (error instanceof WrappedError && error.originalException instanceof expectedType) {
        return true;
    }
    return false;
}
