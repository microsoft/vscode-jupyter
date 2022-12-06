// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

/* eslint-disable , @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

import { expect } from 'chai';
import { Position } from 'vscode';
import { parsePosition } from '../../../platform/common/utils/text.node';

suite('parsePosition()', () => {
    test('valid strings', async () => {
        const tests: [string, Position][] = [
            ['1:5', new Position(1, 5)],
            ['1', new Position(1, 0)],
            ['', new Position(0, 0)]
        ];
        for (const [raw, expected] of tests) {
            const result = parsePosition(raw);

            expect(result).to.deep.equal(expected);
        }
    });
    test('valid numbers', async () => {
        const tests: [number, Position][] = [[1, new Position(1, 0)]];
        for (const [raw, expected] of tests) {
            const result = parsePosition(raw);

            expect(result).to.deep.equal(expected);
        }
    });
    test('bad strings', async () => {
        const tests: string[] = ['1:2:3', '1:a', 'a'];
        for (const raw of tests) {
            expect(() => parsePosition(raw)).to.throw();
        }
    });
});
