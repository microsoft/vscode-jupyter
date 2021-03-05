// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import * as path from 'path';
import { assert } from 'chai';
import { traceInfo } from '../../../client/common/logger';
import { IExtensionTestApi } from '../../common';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../constants';
import { openNotebook } from '../helpers';
import { canRunNotebookTests, closeNotebooksAndCleanUpAfterTests, trustAllNotebooks } from './helper';
import { window } from 'vscode';
import { initialize } from '../../initialize';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataScience - VSCode Notebook - (Validate Output order)', function () {
    let api: IExtensionTestApi;
    const templateIPynb = path.join(
        EXTENSION_ROOT_DIR_FOR_TESTS,
        'src',
        'test',
        'datascience',
        'notebook',
        'withMixedMimeTypeOutput.ipynb'
    );
    this.timeout(120_000);
    suiteSetup(async function () {
        if (!(await canRunNotebookTests())) {
            return this.skip();
        }
        api = await initialize();
        await trustAllNotebooks();
    });
    setup(async function () {
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        await closeNotebooksAndCleanUpAfterTests();
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests());
    test('Verify order of outputs in existing ipynb file', async () => {
        await openNotebook(api.serviceContainer, templateIPynb);
        const cells = window.activeNotebookEditor?.document?.cells!;

        // Cell 1 has html and text
        const expectedOutputItemMimeTypes = [
            [['text/html', 'text/plain']],
            [['application/javascript', 'text/plain']],
            [['image/svg+xml', 'text/plain']],
            [['text/latex', 'text/plain']],
            [['text/plain'], ['image/png', 'text/plain']],
            [['application/vnd.jupyter.widget-view+json', 'text/plain'], ['text/plain']],
            [['image/png', 'text/plain']],
            [['text/html', 'text/plain']],
            [['application/vnd.vegalite.v4+json', 'text/plain']]
        ];

        expectedOutputItemMimeTypes.forEach((outputs, index) => {
            const cell = cells[index];
            assert.equal(cell.outputs.length, outputs.length, `Cell ${index} must have an output`);
            outputs.forEach((outputItems, index) => {
                assert.equal(
                    cell.outputs[0].outputs.length,
                    outputItems.length,
                    `Cell ${index} output must have ${outputItems.length} output items`
                );
                outputItems.forEach((outputItemMimeType, outputItemIndex) => {
                    assert.equal(
                        cell.outputs[0].outputs[outputItemIndex].mime,
                        outputItemMimeType,
                        `Cell ${index} output item ${outputItemIndex} not ${outputItemMimeType}`
                    );
                });
            });
        });
    });
});
