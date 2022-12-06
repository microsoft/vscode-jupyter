// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable  */

import { expect } from 'chai';
import * as vscode from 'vscode';
import { isFileNotFoundError } from '../../../platform/common/platform/errors';
import { SystemError } from './utils';

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
