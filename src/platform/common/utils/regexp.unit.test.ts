// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable no-multi-str */

import { expect } from 'chai';

import { buildDataViewerFilterRegex, verboseRegExp } from '../../../platform/common/utils/regexp';

suite('Utils for regular expressions - verboseRegExp()', () => {
    test('whitespace removed in multiline pattern (example of typical usage)', () => {
        const regex = verboseRegExp(`
            ^
            (?:
                spam \\b .*
            ) |
            (?:
                eggs \\b .*
            )
            $
        `);

        expect(regex.source).to.equal('^(?:spam\\b.*)|(?:eggs\\b.*)$', 'mismatch');
    });

    const whitespaceTests = [
        ['spam eggs', 'spameggs'],
        [
            `spam
          eggs`,
            'spameggs'
        ],
        // empty
        ['  ', '(?:)'],
        [
            `
         `,
            '(?:)'
        ]
    ];
    for (const [pat, expected] of whitespaceTests) {
        test(`whitespace removed ("${pat}")`, () => {
            const regex = verboseRegExp(pat);

            expect(regex.source).to.equal(expected, 'mismatch');
        });
    }

    const noopPatterns = ['^(?:spam\\b.*)$', 'spam', '^spam$', 'spam$', '^spam'];
    for (const pat of noopPatterns) {
        test(`pattern not changed ("${pat}")`, () => {
            const regex = verboseRegExp(pat);

            expect(regex.source).to.equal(pat, 'mismatch');
        });
    }

    const emptyPatterns = [
        '',
        `
        `,
        '  '
    ];
    for (const pat of emptyPatterns) {
        test(`no pattern ("${pat}")`, () => {
            const regex = verboseRegExp(pat);

            expect(regex.source).to.equal('(?:)', 'mismatch');
        });
    }

    test('Test filter patterns for data viewer', () => {
        const r1 = buildDataViewerFilterRegex('Africa');
        expect(r1.test('South Africa')).to.be.true;
        expect(r1.test('south africa')).to.be.true;
        expect(r1.test('Central African Republic')).to.be.true;
        expect(r1.test('Afric')).to.be.false;
        const r2 = buildDataViewerFilterRegex('Africa.*');
        expect(r2.test('South Africa')).to.be.true;
        expect(r2.test('South African')).to.be.true;
        expect(r2.test('African')).to.be.true;
        expect(r2.test('african')).to.be.false;
        const r3 = buildDataViewerFilterRegex('= Africa');
        expect(r3.test('Africa')).to.be.true;
        expect(r3.test('    Africa')).to.be.false;
        expect(r3.test('African')).to.be.false;
        expect(r3.test('african')).to.be.false;
        const r4 = buildDataViewerFilterRegex('(Both sexes)|(Male)');
        expect(r4.test('Both sexes')).to.be.true;
        expect(r4.test('Male')).to.be.true;
        expect(r4.test('Female')).to.be.false;
        expect(r4.test('Male sex')).to.be.true;
    });
});
