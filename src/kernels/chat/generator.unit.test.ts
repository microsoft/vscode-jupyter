// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { escapeStringToEmbedInPythonCode } from './generator';

suite('Chat Code Generator', () => {
    test('Escaping`', () => {
        const values = [
            ['Hello World Foo Bar', 'Hello World Foo Bar'],
            ["Hello World's Foo Bar", `Hello World\'s Foo Bar`],
            ["Hello \\ World's Foo Bar", `Hello \\\\ World\'s Foo Bar`],
            ["Hello \n World's \r\n Foo \r\n \n Bar", `Hello \\n World\'s \\r\\n Foo \\r\\n \\n Bar`],
            ["Hello \f World's Foo Bar", `Hello \\f World\'s Foo Bar`],
            ["Hello\t\tWorld's Foo\t\n\t\t\n\nBar", `Hello\\t\\tWorld\'s Foo\\t\\n\\t\\t\\n\\nBar`],
            ['Hello World Foo \bBar', 'Hello World Foo \\bBar']
        ];
        for (const [text, expected] of values) {
            const escaped = escapeStringToEmbedInPythonCode(text);
            assert.strictEqual(escaped, expected);
        }
    });
});
