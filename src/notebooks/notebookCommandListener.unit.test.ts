// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { parseCellNumber } from './notebookCommandListener';

suite('Notebook Go to Cell', () => {
    test('Converts a 1-based cell number to a 0-based index', () => {
        assert.strictEqual(parseCellNumber('1', 10), 0);
        assert.strictEqual(parseCellNumber('10', 10), 9);
    });
    test('Accepts the "cell N" format used in diagnostics', () => {
        assert.strictEqual(parseCellNumber('cell 38', 50), 37);
        assert.strictEqual(parseCellNumber('Cell38', 50), 37);
        assert.strictEqual(parseCellNumber('  cell 38  ', 50), 37);
    });
    test('Rejects numbers outside the notebook', () => {
        assert.isUndefined(parseCellNumber('0', 10));
        assert.isUndefined(parseCellNumber('11', 10));
        assert.isUndefined(parseCellNumber('1', 0));
    });
    test('Rejects input that is not a cell number', () => {
        assert.isUndefined(parseCellNumber('', 10));
        assert.isUndefined(parseCellNumber('abc', 10));
        assert.isUndefined(parseCellNumber('-1', 10));
        assert.isUndefined(parseCellNumber('2.5', 10));
        assert.isUndefined(parseCellNumber('cell', 10));
    });
});
