// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import * as vscode from 'vscode';

/*
See:
  + https://nodejs.org/api/errors.html
  + https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error
  + node_modules/@types/node/globals.d.ts
 */

interface IError {
    name: string;
    message: string;

    toString(): string;
}

interface INodeJSError extends IError {
    code: string;
    stack?: string;
    stackTraceLimit: number;

    captureStackTrace(): void;
}

//================================
// "system" errors

namespace vscErrors {
    const FILE_NOT_FOUND = vscode.FileSystemError.FileNotFound().name;
    const FILE_EXISTS = vscode.FileSystemError.FileExists().name;
    const IS_DIR = vscode.FileSystemError.FileIsADirectory().name;
    const NOT_DIR = vscode.FileSystemError.FileNotADirectory().name;
    const NO_PERM = vscode.FileSystemError.NoPermissions().name;
    const known = [
        // (order does not matter)
        FILE_NOT_FOUND,
        FILE_EXISTS,
        IS_DIR,
        NOT_DIR,
        NO_PERM
    ];
    function errorMatches(err: Error, expectedName: string): boolean | undefined {
        if (!known.includes(err.name)) {
            return undefined;
        }
        return err.name === expectedName;
    }

    export function isFileNotFound(err: Error): boolean | undefined {
        return errorMatches(err, FILE_NOT_FOUND);
    }
}

interface ISystemError extends INodeJSError {
    errno: number;
    syscall: string;
    info?: string;
    path?: string;
    address?: string;
    dest?: string;
    port?: string;
}

function isSystemError(err: Error, expectedCode: string): boolean | undefined {
    const code = (err as ISystemError).code;
    if (!code) {
        return undefined;
    }
    return code === expectedCode;
}

// Return true if the given error is ENOENT.
export function isFileNotFoundError(err: Error): boolean | undefined {
    const matched = vscErrors.isFileNotFound(err);
    if (matched !== undefined) {
        return matched;
    }
    return isSystemError(err, 'ENOENT');
}
