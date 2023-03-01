// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable  */

import { expect } from 'chai';
import * as vscode from 'vscode';
import { isFileNotFoundError } from './errors';

class SystemError extends Error {
    public code: string;
    public errno: number;
    public syscall: string;
    public info?: string;
    public path?: string;
    public address?: string;
    public dest?: string;
    public port?: string;
    constructor(code: string, syscall: string, message: string) {
        super(`${code}: ${message} ${syscall} '...'`);
        this.code = code;
        this.errno = 0; // Don't bother until we actually need it.
        this.syscall = syscall;
    }
}

suite('FileSystem - errors', () => {
    const filename = 'spam';

    suite('isFileNotFoundError', () => {
        const tests: [Error, boolean | undefined][] = [
            [vscode.FileSystemError.FileNotFound(filename), true],
            [vscode.FileSystemError.FileExists(filename), false],
            [new SystemError('ENOENT', 'stat', '<msg>'), true],
            [new SystemError('EEXIST', '???', '<msg>'), false],
            [new Error(filename), undefined]
        ];
        tests.map(([err, expected]) => {
            test(`${err} -> ${expected}`, () => {
                const matches = isFileNotFoundError(err);

                expect(matches).to.equal(expected);
            });
        });
    });
});
