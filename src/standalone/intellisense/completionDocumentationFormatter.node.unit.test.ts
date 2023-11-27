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
    test('Python DocString', async () => {
        await convertAndCompare('python', 'python.df.A');
        await convertAndCompare('python', 'python.df.align');
        await convertAndCompare('python', 'python.df.axes');
        await convertAndCompare('python', 'python.matplotlib_inline');
        await convertAndCompare('python', 'python.magic.timeit');
        await convertAndCompare('python', 'python.property');
        await convertAndCompare('python', 'python.ArithmeticError');
    });
    test('Julia DocString', async () => {
        await convertAndCompare('julia', 'julia.abs');
        await convertAndCompare('julia', 'julia.axes');
        await convertAndCompare('julia', 'julia.zip');
    });
    test('R DocString', async () => {
        await convertAndCompare('r', 'r.sort');
        await convertAndCompare('r', 'r.sortedXyData');
        await convertAndCompare('r', 'r.library');
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
