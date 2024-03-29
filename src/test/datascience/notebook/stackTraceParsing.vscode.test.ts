// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { findErrorLocation } from '../../../kernels/execution/helpers';
import { closeNotebooksAndCleanUpAfterTests, createEmptyPythonNotebook, insertCodeCell } from './helper';
import { traceInfo } from '../../../platform/logging';
import { window } from 'vscode';
import sinon from 'sinon';
import { IDisposable } from '../../../platform/common/types';
import { captureScreenShot } from '../../common';

suite('StackTraceParsing', () => {
    const disposables: IDisposable[] = [];

    setup(async function () {
        this.timeout(120_000);
        traceInfo(`Start Test ${this.currentTest?.title}`);
        sinon.restore();
        await createEmptyPythonNotebook(disposables, undefined, true);
        assert.isOk(window.activeNotebookEditor, 'No active notebook');
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });

    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this);
        }
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });

    test('Correct range is identified for raw stack strace', async () => {
        const cell = await insertCodeCell(`import myLib
myLib.throwEx()`);

        const stack = [
            '\u001b[1;31m---------------------------------------------------------------------------\u001b[0m',
            '\u001b[1;31mException\u001b[0m                                 Traceback (most recent call last)',
            'Cell \u001b[1;32mIn[3], line 2\u001b[0m',
            '\u001b[0;32m      1\u001b[0m \u001b[38;5;28;01mimport\u001b[39;00m \u001b[38;5;21;01mmyLib\u001b[39;00m',
            '\u001b[1;32m----> 2\u001b[0m \u001b[43mmyLib\u001b[49m\u001b[38;5;241;43m.\u001b[39;49m\u001b[43mthrowEx\u001b[49m\u001b[43m(\u001b[49m\u001b[43m)\u001b[49m',
            '',
            'File \u001b[1;32mC:\\venvs\\myLib.py:5\u001b[0m, in \u001b[0;36mthrowEx\u001b[1;34m()\u001b[0m',
            '\u001b[0;32m      4\u001b[0m \u001b[38;5;28;01mdef\u001b[39;00m \u001b[38;5;21mthrowEx\u001b[39m():',
            '\u001b[1;32m----> 5\u001b[0m     \u001b[38;5;28;01mraise\u001b[39;00m \u001b[38;5;167;01mException\u001b[39;00m',
            '\u001b[1;31mException\u001b[0m:'
        ];

        const range = findErrorLocation(stack, cell);

        assert(range, 'should have found a range');
        assert.equal(range.start.line, 1, 'wrong start line');
        assert.equal(range.start.character, 0, 'wrong start character');
        assert.equal(range.end.line, 1, 'wrong end line');
        assert.equal(range.end.character, 'myLib.throwEx()'.length, 'wrong end character');
    });

    test('Correct range is identified for clean stack strace', async () => {
        const cell = await insertCodeCell(`print(1/0)`);

        const stack = [
            '---------------------------------------------------------------------------',
            'ZeroDivisionError                         Traceback (most recent call last)',
            'Cell In[3], line 1',
            '----> 1 print(1/0)',
            '',
            'ZeroDivisionError: division by zero'
        ];

        const range = findErrorLocation(stack, cell);

        assert(range, 'should have found a range');
        assert.equal(range.start.line, 0, 'wrong start line');
        assert.equal(range.start.character, 0, 'wrong start character');
        assert.equal(range.end.line, 0, 'wrong end line');
        assert.equal(range.end.character, 'print(1/0)'.length, 'wrong end character');
    });

    test('indents and comments are not included in identified error range', async () => {
        const cell = await insertCodeCell(`if True:
    print(1/0)  #comment`);

        const stack = [
            '---------------------------------------------------------------------------',
            'ZeroDivisionError                         Traceback (most recent call last)',
            'Cell In[6], line 2',
            '      1 if True:',
            '----> 2     print(1/0)  #comment',
            '',
            'ZeroDivisionError: division by zero'
        ];

        const range = findErrorLocation(stack, cell);

        assert(range, 'should have found a range');
        assert.equal(range.start.line, 1, 'wrong start line');
        assert.equal(range.start.character, '    '.length, 'wrong start character');
        assert.equal(range.end.line, 1, 'wrong end line');
        assert.equal(range.end.character, '    print(1/0)'.length, 'wrong end character');
    });

    test('Correctly finds range for old IPython stack format', async () => {
        const cell = await insertCodeCell(`print(1/0)`);

        const stack = [
            '---------------------------------------------------------------------------',
            'ZeroDivisionError                         Traceback (most recent call last)',
            'Input In [2], in <cell line: 1>()',
            '----> 1 print(1/0)',
            '',
            'ZeroDivisionError: division by zero'
        ];

        const range = findErrorLocation(stack, cell);

        assert(range, 'should have found a range');
        assert.equal(range.start.line, 0, 'wrong start line');
        assert.equal(range.start.character, 0, 'wrong start character');
        assert.equal(range.end.line, 0), 'wrong end line';
        assert.equal(range.end.character, 'print(1/0)'.length, 'wrong end character');
    });

    test('Invalid line will not return a range', async () => {
        const cell = await insertCodeCell(`print(1/0)`);

        const stack = [
            '---------------------------------------------------------------------------',
            'ZeroDivisionError                         Traceback (most recent call last)',
            'Cell In[3], line 10',
            '----> 1 print(1/0)',
            '',
            'ZeroDivisionError: division by zero'
        ];

        const range = findErrorLocation(stack, cell);

        assert.equal(range, undefined, 'should not have found a range');
    });

    test('Stack without specified line will not return range', async () => {
        const cell = await insertCodeCell(`if True
    print("This is True")`);

        const stack = ['  Input In [3]', '    if True', '           ^', "SyntaxError: expected ':'"];

        const range = findErrorLocation(stack, cell);

        assert.equal(range, undefined, 'should not have found a range');
    });
});
