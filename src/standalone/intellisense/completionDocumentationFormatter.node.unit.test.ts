// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { EOL } from 'os';
// eslint-disable-next-line local-rules/node-imports
import * as path from 'path';
import * as fs from 'fs-extra';
import { convertDocumentationToMarkdown } from './completionDocumentationFormatter';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../test/constants.node';

suite('Jupyter Completion Documentation Formatter', () => {
    suite('Python DocString', () => {
        [
            'python.df.A',
            'python.df.align',
            'python.df.axes',
            'python.matplotlib_inline',
            'python.magic.timeit',
            'python.property',
            'python.ArithmeticError'
        ].forEach((inputFile) => {
            test(inputFile, async () => {
                await convertAndCompare('python', inputFile);
            });
        });
    });
    suite('Julia DocString', async () => {
        ['julia.abs', 'julia.axes', 'julia.zip'].forEach((inputFile) => {
            test(inputFile, async () => {
                await convertAndCompare('julia', inputFile);
            });
        });
    });
    suite('R DocString', async () => {
        ['r.sort', 'r.sortedXyData', 'r.library'].forEach((inputFile) => {
            test(inputFile, async () => {
                await convertAndCompare('r', inputFile);
            });
        });
    });

    async function convertAndCompare(language: string, inputFile: string) {
        const root = path.join(
            EXTENSION_ROOT_DIR_FOR_TESTS,
            'src',
            'standalone',
            'intellisense',
            'completionDocumentationFormatter'
        );
        const expectedOutputFile = path.join(root, `${inputFile}.md`);
        inputFile = path.join(root, `${inputFile}.txt`);
        const [documentation, expected] = await Promise.all([
            fs.readFile(inputFile, { encoding: 'utf8' }),
            fs.readFile(expectedOutputFile, { encoding: 'utf8' })
        ]);
        const converted = convertDocumentationToMarkdown(documentation, language);
        // fs.writeFileSync(expectedOutputFile, typeof converted === 'string' ? converted : converted.value);
        if (typeof converted === 'string') {
            compareIgnoreLineBreaks(converted, expected);
        } else {
            compareIgnoreLineBreaks(converted.value, expected);
        }
    }
    function compareIgnoreLineBreaks(a: string, b: string) {
        assert.strictEqual(a.replace(/\r?\n/g, EOL), b.replace(/\r?\n/g, EOL));
    }
});
