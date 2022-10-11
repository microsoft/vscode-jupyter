// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { createOutputWithErrorMessageForDisplay } from './errorUtils';

suite('Error Utils', () => {
    suite('Markdown links to Hrefs', () => {
        function getHtmlMessage(markdown: string) {
            const output = createOutputWithErrorMessageForDisplay(markdown);
            const { stack } = JSON.parse(Buffer.from(output!.items[0].data).toString()) as { stack: string };
            return stack.replace('\u001b[1;31m', '');
        }
        test('Markdown links to Hrefs', () => {
            const markdown = 'This is a [link](https://www.microsoft.com)';
            const expected = "This is a <a href='https://www.microsoft.com'>link</a>";

            const html = getHtmlMessage(markdown);

            assert.strictEqual(html, expected);
        });
        test('Multiple Markdown links to Hrefs', () => {
            const markdown =
                'This is a [link](https://www.microsoft.com) and [this](https://www.google.com) is also a link.';
            const expected =
                "This is a <a href='https://www.microsoft.com'>link</a> and <a href='https://www.google.com'>this</a> is also a link.";

            const html = getHtmlMessage(markdown);

            assert.strictEqual(html, expected);
        });
        test('VS Code command links in markdown to Hrefs', () => {
            const markdown =
                'This is a command [jupyter.kernels.trusted](command:workbench.action.openSettings?["jupyter.kernels.trusted"]) link.';
            const expected =
                'This is a command <a href=\'command:workbench.action.openSettings?["jupyter.kernels.trusted"]\'>jupyter.kernels.trusted</a> link.';

            const html = getHtmlMessage(markdown);

            assert.strictEqual(html, expected);
        });
    });
});
