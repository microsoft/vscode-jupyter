// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { formatStreamText, generateMarkdownFromCodeLines } from './utils';

suite('Common Tests', () => {
    test('formatting stream text', async () => {
        assert.equal(formatStreamText('\rExecute\rExecute 1'), 'Execute 1');
        assert.equal(formatStreamText('\rExecute\r\nExecute 2'), 'Execute\nExecute 2');
        assert.equal(formatStreamText('\rExecute\rExecute\r\nExecute 3'), 'Execute\nExecute 3');
        assert.equal(formatStreamText('\rExecute\rExecute\nExecute 4'), 'Execute\nExecute 4');
        assert.equal(formatStreamText('\rExecute\r\r \r\rExecute\nExecute 5'), 'Execute\nExecute 5');
        assert.equal(formatStreamText('\rExecute\rExecute\nExecute 6\rExecute 7'), 'Execute\nExecute 7');
        assert.equal(formatStreamText('\rExecute\rExecute\nExecute 8\rExecute 9\r\r'), 'Execute\nExecute 9');
        assert.equal(formatStreamText('\rExecute\rExecute\nExecute 10\rExecute 11\r\n'), 'Execute\nExecute 11\n');
    });

    test('generateMarkdownFromCodeLines preserves line breaks correctly', () => {
        // Test multi-line markdown with empty lines
        const lines1 = [
            '#%% [markdown]',
            '',
            '"""',
            '# H1 Title',
            '',
            'description 1',
            '',
            '- item 1',
            '    - item 2',
            '- item 3',    
            '"""'
        ];
        
        const result1 = generateMarkdownFromCodeLines(lines1);
        const markdown1 = result1.join('\n');
        const expected1 = '# H1 Title\n\ndescription 1\n\n- item 1\n    - item 2\n- item 3';
        assert.equal(markdown1, expected1, 'Multi-line markdown with empty lines should preserve line breaks');

        // Test code block in markdown
        const lines2 = [
            '#%% [markdown]',
            '',
            '"""',
            'Writing code blocks in markdown:',
            '',
            '```shell',
            '# Comment 1',
            '$ ls ',
            '',
            '# Comment 2',
            '$ ls -lh',
            '```',
            '"""'
        ];
        
        const result2 = generateMarkdownFromCodeLines(lines2);
        const markdown2 = result2.join('\n');
        const expected2 = 'Writing code blocks in markdown:\n\n```shell\n# Comment 1\n$ ls \n\n# Comment 2\n$ ls -lh\n```';
        assert.equal(markdown2, expected2, 'Code blocks in markdown should preserve line breaks');

        // Test single line markdown
        const lines3 = [
            '#%% [markdown]',
            '"""Single line markdown"""'
        ];
        
        const result3 = generateMarkdownFromCodeLines(lines3);
        const markdown3 = result3.join('\n');
        const expected3 = 'Single line markdown';
        assert.equal(markdown3, expected3, 'Single line markdown should work correctly');
    });
});
