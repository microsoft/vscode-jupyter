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
import { canRunNotebookTests, closeNotebooksAndCleanUpAfterTests } from './helper';
import { window } from 'vscode';
import { initialize } from '../../initialize';
import { nbformat } from '@jupyterlab/coreutils';
import { cellOutputToVSCCellOutput } from '../../../client/datascience/notebook/helpers/helpers';

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
    suiteSetup(async function () {
        if (!(await canRunNotebookTests())) {
            return this.skip();
        }
        api = await initialize();
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
        const cells = window.activeNotebookEditor?.document?.getCells()!;

        const expectedOutputItemMimeTypes = [
            [['text/html', 'text/plain']],
            [['application/javascript', 'text/plain']],
            [['image/svg+xml', 'text/plain']],
            [['text/latex', 'text/plain']],
            [['text/plain'], ['image/png', 'text/plain']],
            [['application/vnd.jupyter.widget-view+json', 'text/plain'], ['text/plain']],
            [['image/png', 'text/plain']],
            [['text/html', 'text/plain']],
            [['text/plain']],
            [['application/vnd.vegalite.v4+json', 'text/plain']]
        ];

        expectedOutputItemMimeTypes.forEach((outputs, index) => {
            const cell = cells[index];
            assert.equal(cell.outputs.length, outputs.length, `Cell ${index} must have an output`);
            outputs.forEach((outputItems, outputIndex) => {
                assert.equal(
                    cell.outputs[outputIndex].items.length,
                    outputItems.length,
                    `Cell ${index} output must have ${outputItems.length} output items`
                );
                outputItems.forEach((outputItemMimeType, outputItemIndex) => {
                    assert.equal(
                        cell.outputs[outputIndex].items[outputItemIndex].mime,
                        outputItemMimeType,
                        `Cell ${index} output item ${outputItemIndex} not ${outputItemMimeType}`
                    );
                });
            });
        });
    });
    test('Verify order of outputs', async () => {
        const dataAndExpectedOrder: { output: nbformat.IDisplayData; expectedMimeTypesOrder: string[] }[] = [
            {
                output: {
                    data: {
                        'application/vnd.vegalite.v4+json': 'some json',
                        'text/html': '<a>Hello</a>'
                    },
                    metadata: {},
                    output_type: 'display_data'
                },
                expectedMimeTypesOrder: ['application/vnd.vegalite.v4+json', 'text/html']
            },
            {
                output: {
                    data: {
                        'application/vnd.vegalite.v4+json': 'some json',
                        'application/javascript': 'some js',
                        'text/plain': 'some text',
                        'text/html': '<a>Hello</a>'
                    },
                    metadata: {},
                    output_type: 'display_data'
                },
                expectedMimeTypesOrder: [
                    'application/vnd.vegalite.v4+json',
                    'text/html',
                    'application/javascript',
                    'text/plain'
                ]
            },
            {
                output: {
                    data: {
                        'application/vnd.vegalite.v4+json': '', // Empty, should give preference to other mimetypes.
                        'application/javascript': 'some js',
                        'text/plain': 'some text',
                        'text/html': '<a>Hello</a>'
                    },
                    metadata: {},
                    output_type: 'display_data'
                },
                expectedMimeTypesOrder: [
                    'text/html',
                    'application/javascript',
                    'text/plain',
                    'application/vnd.vegalite.v4+json'
                ]
            },
            {
                output: {
                    data: {
                        'text/plain': 'some text',
                        'text/html': '<a>Hello</a>'
                    },
                    metadata: {},
                    output_type: 'display_data'
                },
                expectedMimeTypesOrder: ['text/html', 'text/plain']
            },
            {
                output: {
                    data: {
                        'application/javascript': 'some js',
                        'text/plain': 'some text'
                    },
                    metadata: {},
                    output_type: 'display_data'
                },
                expectedMimeTypesOrder: ['application/javascript', 'text/plain']
            },
            {
                output: {
                    data: {
                        'image/svg+xml': 'some svg',
                        'text/plain': 'some text'
                    },
                    metadata: {},
                    output_type: 'display_data'
                },
                expectedMimeTypesOrder: ['image/svg+xml', 'text/plain']
            },
            {
                output: {
                    data: {
                        'text/latex': 'some latex',
                        'text/plain': 'some text'
                    },
                    metadata: {},
                    output_type: 'display_data'
                },
                expectedMimeTypesOrder: ['text/latex', 'text/plain']
            },
            {
                output: {
                    data: {
                        'application/vnd.jupyter.widget-view+json': 'some widget',
                        'text/plain': 'some text'
                    },
                    metadata: {},
                    output_type: 'display_data'
                },
                expectedMimeTypesOrder: ['application/vnd.jupyter.widget-view+json', 'text/plain']
            },
            {
                output: {
                    data: {
                        'text/plain': 'some text',
                        'image/svg+xml': 'some svg',
                        'image/png': 'some png'
                    },
                    metadata: {},
                    output_type: 'display_data'
                },
                expectedMimeTypesOrder: ['image/svg+xml', 'image/png', 'text/plain']
            }
        ];

        dataAndExpectedOrder.forEach(({ output, expectedMimeTypesOrder }) => {
            const sortedOutputs = cellOutputToVSCCellOutput(output);
            const mimeTypes = sortedOutputs.items.map((item) => item.mime).join(',');
            assert.equal(mimeTypes, expectedMimeTypesOrder.join(','));
        });
    });
});
