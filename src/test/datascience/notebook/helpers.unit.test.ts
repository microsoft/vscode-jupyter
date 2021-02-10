// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { nbformat } from '@jupyterlab/coreutils';
import { assert } from 'chai';
import { cloneDeep } from 'lodash';
import { Uri } from 'vscode';
import { NotebookCellOutput, NotebookCellData, NotebookCellOutputItem } from '../../../../types/vscode-proposed';
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const vscodeNotebookEnums = require('vscode') as typeof import('vscode-proposed');
import { MARKDOWN_LANGUAGE, PYTHON_LANGUAGE } from '../../../client/common/constants';
import { ReadWrite } from '../../../client/common/types';
import { notebookModelToVSCNotebookData } from '../../../client/datascience/notebook/helpers/helpers';

suite('DataScience - NativeNotebook helpers', () => {
    test('Convert NotebookModel to VSCode NotebookData', async () => {
        const cells = [
            {
                cell_type: 'code',
                execution_count: 10,
                outputs: [],
                source: 'print(1)',
                metadata: {}
            },
            {
                cell_type: 'markdown',
                source: '# HEAD',
                metadata: {}
            }
        ];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const notebook = notebookModelToVSCNotebookData(true, {}, Uri.file(''), cells as any, PYTHON_LANGUAGE, {});

        assert.isOk(notebook);
        assert.deepEqual(notebook.languages, ['*']);
        // ignore metadata we add.
        const cellsWithoutCustomMetadata = notebook.cells.map((cell) => {
            const cellToCompareWith: ReadWrite<NotebookCellData> = cloneDeep(cell);
            delete cellToCompareWith.metadata?.custom;
            return cellToCompareWith;
        });
        assert.deepEqual(cellsWithoutCustomMetadata, [
            {
                cellKind: vscodeNotebookEnums.CellKind.Code,
                language: PYTHON_LANGUAGE,
                outputs: [],
                source: 'print(1)',
                metadata: {
                    editable: true,
                    executionOrder: 10,
                    hasExecutionOrder: true,
                    runState: vscodeNotebookEnums.NotebookCellRunState.Idle,
                    runnable: true,
                    statusMessage: undefined
                }
            },
            {
                cellKind: vscodeNotebookEnums.CellKind.Markdown,
                language: MARKDOWN_LANGUAGE,
                outputs: [],
                source: '# HEAD',
                metadata: {
                    editable: true,
                    executionOrder: undefined,
                    hasExecutionOrder: false,
                    runnable: false
                }
            }
        ]);
    });
    suite('Outputs', () => {
        function validateCellOutputTranslation(outputs: nbformat.IOutput[], expectedOutputs: NotebookCellOutput[]) {
            const cells = [
                {
                    cell_type: 'code',
                    execution_count: 10,
                    outputs,
                    source: 'print(1)',
                    metadata: {}
                }
            ];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const notebook = notebookModelToVSCNotebookData(true, {}, Uri.file(''), cells, PYTHON_LANGUAGE, {});

            assert.deepEqual(notebook.cells[0].outputs, expectedOutputs);
        }
        test('Empty output', () => {
            validateCellOutputTranslation([], []);
        });
        test('Stream output', () => {
            validateCellOutputTranslation(
                [
                    {
                        output_type: 'stream',
                        name: 'stderr',
                        text: 'Error'
                    },
                    {
                        output_type: 'stream',
                        name: 'stdout',
                        text: 'NoError'
                    }
                ],
                [
                    new NotebookCellOutput([
                        new NotebookCellOutputItem('text/plain', 'Error', {
                            custom: {
                                vscode: {
                                    name: 'stderr',
                                    outputType: 'stream'
                                }
                            }
                        }
                        )]
                    ),
                    new NotebookCellOutput([
                        new NotebookCellOutputItem('text/plain', 'NoError', {
                            custom: {
                                vscode: {
                                    name: 'stdout',
                                    outputType: 'stream'
                                }
                            }
                        }
                        )]
                    ),
                ]
            );
        });
        test('Streamed text with Ansi characters', async () => {
            validateCellOutputTranslation(
                [
                    {
                        name: 'stderr',
                        text: '\u001b[K\u001b[33m✅ \u001b[0m Loading\n',
                        output_type: 'stream'
                    }
                ],
                [
                    new NotebookCellOutput([
                        new NotebookCellOutputItem('text/plain', '\u001b[K\u001b[33m✅ \u001b[0m Loading\n', {
                            custom: {
                                vscode: {
                                    name: 'stderr',
                                    outputType: 'stream'
                                }
                            }
                        }
                        )]
                    )
                ]
            );
        });
        test('Streamed text with angle bracket characters', async () => {
            validateCellOutputTranslation(
                [
                    {
                        name: 'stderr',
                        text: '1 is < 2',
                        output_type: 'stream'
                    }
                ],
                [
                    new NotebookCellOutput([
                        new NotebookCellOutputItem('text/plain', '1 is < 2', {
                            custom: {
                                vscode: {
                                    name: 'stderr',
                                    outputType: 'stream'
                                }
                            }
                        }
                        )]
                    )
                ]
            );
        });
        test('Streamed text with angle bracket characters and ansi chars', async () => {
            validateCellOutputTranslation(
                [
                    {
                        name: 'stderr',
                        text: '1 is < 2\u001b[K\u001b[33m✅ \u001b[0m Loading\n',
                        output_type: 'stream'
                    }
                ],
                [
                    new NotebookCellOutput([
                        new NotebookCellOutputItem('text/plain', '1 is < 2\u001b[K\u001b[33m✅ \u001b[0m Loading\n', {
                            custom: {
                                vscode: {
                                    name: 'stderr',
                                    outputType: 'stream'
                                }
                            }
                        }
                        )]
                    )
                ]
            );
        });
        test('Error', async () => {
            validateCellOutputTranslation(
                [
                    {
                        ename: 'Error Name',
                        evalue: 'Error Value',
                        traceback: ['stack1', 'stack2', 'stack3'],
                        output_type: 'error'
                    }
                ],
                [
                    new NotebookCellOutput([
                        new NotebookCellOutputItem('application/x.notebook.error-traceback', {
                            ename: 'Error Name',
                            evalue: 'Error Value',
                            traceback: ['stack1', 'stack2', 'stack3']
                        })
                    ])
                ]
            );
        });

        ['display_data', 'execute_result'].forEach((output_type) => {
            suite(`Rich output for output_type = ${output_type}`, () => {
                test('Text mimeType output', async () => {
                    validateCellOutputTranslation(
                        [
                            {
                                data: {
                                    'text/plain': 'Hello World!'
                                },
                                output_type
                            }
                        ],
                        [
                            new NotebookCellOutput([
                                new NotebookCellOutputItem('text/plain', 'Hello World!', {
                                    custom: {
                                        vscode: {
                                            outputType: output_type
                                        }
                                    }
                                })
                            ])
                        ]
                    );
                });

                test('png,jpeg images', async () => {
                    validateCellOutputTranslation(
                        [
                            {
                                data: {
                                    'image/png': 'base64PNG',
                                    'image/jpeg': 'base64JPEG'
                                },
                                output_type
                            }
                        ],
                        [
                            new NotebookCellOutput([
                                new NotebookCellOutputItem('image/png', 'base64PNG', {
                                    custom: {
                                        vscode: {
                                            outputType: output_type
                                        }
                                    }
                                }),
                                new NotebookCellOutputItem('image/jpeg', 'base64JPEG')

                            ])
                        ]
                    );
                });
                test('png image with a light background', async () => {
                    validateCellOutputTranslation(
                        [
                            {
                                data: {
                                    'image/png': 'base64PNG'
                                },
                                metadata: {
                                    needs_background: 'light'
                                },
                                output_type
                            }
                        ],
                        [
                            new NotebookCellOutput([
                                new NotebookCellOutputItem('image/png', 'base64PNG', {
                                    custom: {
                                        needs_background: 'light',
                                        vscode: {
                                            outputType: output_type
                                        }
                                    }
                                })
                            ])
                        ]
                    );
                });
                test('png image with a dark background', async () => {
                    validateCellOutputTranslation(
                        [
                            {
                                data: {
                                    'image/png': 'base64PNG'
                                },
                                metadata: {
                                    needs_background: 'dark'
                                },
                                output_type
                            }
                        ],
                        [
                            new NotebookCellOutput([
                                new NotebookCellOutputItem('image/png', 'base64PNG', {
                                    custom: {
                                        needs_background: 'dark',
                                        vscode: {
                                            outputType: output_type
                                        }
                                    }
                                })
                            ])
                        ]
                    );
                });
                test('png image with custom dimensions', async () => {
                    validateCellOutputTranslation(
                        [
                            {
                                data: {
                                    'image/png': 'base64PNG'
                                },
                                metadata: {
                                    'image/png': { height: '111px', width: '999px' }
                                },
                                output_type
                            }
                        ],
                        [
                            new NotebookCellOutput([
                                new NotebookCellOutputItem('image/png', 'base64PNG', {
                                    custom: {
                                        'image/png': { height: '111px', width: '999px' },
                                        vscode: {
                                            outputType: output_type
                                        }
                                    }
                                }),
                            ])
                        ]
                    );
                });
                test('png allowed to scroll', async () => {
                    validateCellOutputTranslation(
                        [
                            {
                                data: {
                                    'image/png': 'base64PNG'
                                },
                                metadata: {
                                    unconfined: true,
                                    'image/png': { width: '999px' }
                                },
                                output_type
                            }
                        ],
                        [
                            new NotebookCellOutput([
                                new NotebookCellOutputItem('image/png', 'base64PNG', {
                                    custom: {
                                        unconfined: true,
                                        'image/png': { width: '999px' },
                                        vscode: {
                                            outputType: output_type
                                        }
                                    }
                                }),
                            ])
                        ]
                    );
                });
            });
        });
    });
});
