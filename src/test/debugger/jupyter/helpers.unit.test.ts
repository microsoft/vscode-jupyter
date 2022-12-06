// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from 'chai';
import { isShortNamePath } from '../../../notebooks/debugger/helper';

suite('Debugging - Helpers', () => {
    suite('isShortNamePath', async () => {
        test('detects short name paths', () => {
            expect(isShortNamePath('c:\\foo~1\\bar')).to.be.true;
            expect(isShortNamePath('c:\\foo~15\\bar')).to.be.true;
            expect(isShortNamePath('c:\\foo\\bar~1\\tmp.txt')).to.be.true;
        });

        test('detects non-short name paths', () => {
            expect(isShortNamePath('/foo/bar')).to.be.false;
            expect(isShortNamePath('/foo~/bar')).to.be.false;
            expect(isShortNamePath('~/bar')).to.be.false;
            expect(isShortNamePath('/foo1~/bar')).to.be.false;
        });
    });
});
