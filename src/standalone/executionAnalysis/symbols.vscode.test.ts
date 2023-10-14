// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { CellAnalysis, ICellExecution, ILocationWithReferenceKind, INotebookCell } from './symbols';

function withNotebookCells(data: [string, string][], fileName: string) {
    const cells: INotebookCell[] = data.map((cell) => ({
        document: {
            uri: vscode.Uri.parse(fileName).with({ fragment: cell[0] })
        }
    }));
    return cells;
}

suite('Analysis', () => {
    test('Basic type dependencies', () => {
        const cells: INotebookCell[] = withNotebookCells(
            [
                ['W0sZmlsZQ==', 'def foo():\n    print(123)'],
                ['W1sZmlsZQ==', 'def bar():\n    foo()'],
                ['W2sZmlsZQ==', 'foo()'],
                ['W3sZmlsZQ==', 'bar()']
            ],
            'df.ipynb'
        );

        const refsArr = [
            [
                'W0sZmlsZQ==',
                [
                    {
                        uri: { fragment: 'W0sZmlsZQ==' },
                        range: [
                            { line: 0, character: 4 },
                            { line: 0, character: 7 }
                        ],
                        kind: 'read'
                    },
                    {
                        uri: { fragment: 'W1sZmlsZQ==' },
                        range: [
                            { line: 1, character: 4 },
                            { line: 1, character: 7 }
                        ],
                        kind: 'read'
                    },
                    {
                        uri: { fragment: 'W2sZmlsZQ==' },
                        range: [
                            { line: 0, character: 0 },
                            { line: 0, character: 3 }
                        ],
                        kind: 'read'
                    }
                ]
            ],
            [
                'W1sZmlsZQ==',
                [
                    {
                        uri: { fragment: 'W1sZmlsZQ==' },
                        range: [
                            { line: 0, character: 4 },
                            { line: 0, character: 7 }
                        ],
                        kind: 'read'
                    },
                    {
                        uri: { fragment: 'W3sZmlsZQ==' },
                        range: [
                            { line: 0, character: 0 },
                            { line: 0, character: 3 }
                        ],
                        kind: 'read'
                    }
                ]
            ]
        ];

        const refsMap = new Map<string, ILocationWithReferenceKind[]>();
        for (let i = 0; i < refsArr.length; i++) {
            const refs: ILocationWithReferenceKind[] = (refsArr[i][1] as unknown[]).map((ref: any) => ({
                uri: vscode.Uri.parse('df.ipynb').with({ fragment: ref.uri.fragment }),
                range: {
                    start: { line: ref.range[0].line, character: ref.range[0].character },
                    end: { line: ref.range[1].line, character: ref.range[1].character }
                }
            }));
            const fragment = refsArr[i][0] as string;
            refsMap.set(fragment, refs);
        }

        const cellExecutions: ICellExecution[] = [
            {
                cell: cells[0],
                executionCount: 1
            },
            {
                cell: cells[1],
                executionCount: 2
            },
            {
                cell: cells[2],
                executionCount: 3
            },
            {
                cell: cells[3],
                executionCount: 4
            }
        ];

        const analyzer = new CellAnalysis(cellExecutions, refsMap);
        const deps = analyzer.getPredecessorCells(cells[2]);
        assert.strictEqual(deps.length, 2);
        assert.strictEqual(deps[0].document.uri.fragment, 'W0sZmlsZQ==');
        assert.strictEqual(deps[1].document.uri.fragment, 'W2sZmlsZQ==');
        const deps2 = analyzer.getPredecessorCells(cells[3]);
        assert.strictEqual(deps2.length, 3);
        assert.strictEqual(deps2[0].document.uri.fragment, 'W0sZmlsZQ==');
        assert.strictEqual(deps2[1].document.uri.fragment, 'W1sZmlsZQ==');
        assert.strictEqual(deps2[2].document.uri.fragment, 'W3sZmlsZQ==');

        const affectedCells = analyzer.getSuccessorCells(cells[0]);
        assert.strictEqual(affectedCells.length, 4);
        assert.strictEqual(affectedCells[1].document.uri.fragment, 'W1sZmlsZQ==');
        assert.strictEqual(affectedCells[2].document.uri.fragment, 'W2sZmlsZQ==');
        assert.strictEqual(affectedCells[3].document.uri.fragment, 'W3sZmlsZQ==');

        const affectedCells2 = analyzer.getSuccessorCells(cells[1]);
        assert.strictEqual(affectedCells2.length, 2);
        assert.strictEqual(affectedCells2[1].document.uri.fragment, 'W3sZmlsZQ==');
    });

    test('Basic type dependencies 2', () => {
        const cells: INotebookCell[] = withNotebookCells(
            [
                ['W0sZmlsZQ==', 'x=5'],
                ['W1sZmlsZQ==', 'y=6'],
                ['W2sZmlsZQ==', 'print(x+y)']
            ],
            'df.ipynb'
        );

        const refsArr = [
            [
                'W0sZmlsZQ==',
                [
                    {
                        range: [
                            {
                                line: 0,
                                character: 0
                            },
                            {
                                line: 0,
                                character: 1
                            }
                        ],
                        uri: { fragment: 'W0sZmlsZQ==' },
                        kind: 'write'
                    },
                    {
                        range: [
                            {
                                line: 0,
                                character: 6
                            },
                            {
                                line: 0,
                                character: 7
                            }
                        ],
                        uri: { fragment: 'W2sZmlsZQ==' },
                        kind: 'read'
                    }
                ]
            ],
            [
                'W1sZmlsZQ==',
                [
                    {
                        range: [
                            {
                                line: 0,
                                character: 0
                            },
                            {
                                line: 0,
                                character: 1
                            }
                        ],
                        uri: { fragment: 'W1sZmlsZQ==' },
                        kind: 'write'
                    },
                    {
                        range: [
                            {
                                line: 0,
                                character: 8
                            },
                            {
                                line: 0,
                                character: 9
                            }
                        ],
                        uri: { fragment: 'W2sZmlsZQ==' },
                        kind: 'read'
                    }
                ]
            ]
        ];

        const refsMap = new Map<string, ILocationWithReferenceKind[]>();
        for (let i = 0; i < refsArr.length; i++) {
            const refs: ILocationWithReferenceKind[] = (refsArr[i][1] as unknown[]).map((ref: any) => ({
                uri: vscode.Uri.parse('df.ipynb').with({ fragment: ref.uri.fragment }),
                range: {
                    start: { line: ref.range[0].line, character: ref.range[0].character },
                    end: { line: ref.range[1].line, character: ref.range[1].character }
                }
            }));
            const fragment = refsArr[i][0] as string;
            refsMap.set(fragment, refs);
        }

        const cellExecutions: ICellExecution[] = [
            {
                cell: cells[0],
                executionCount: 1
            },
            {
                cell: cells[1],
                executionCount: 2
            },
            {
                cell: cells[2],
                executionCount: 3
            }
        ];

        const analyzer = new CellAnalysis(cellExecutions, refsMap);
        const deps = analyzer.getPredecessorCells(cells[2]);
        assert.strictEqual(deps.length, 3);
        assert.strictEqual(deps[0].document.uri.fragment, 'W0sZmlsZQ==');
        assert.strictEqual(deps[1].document.uri.fragment, 'W1sZmlsZQ==');
        assert.strictEqual(deps[2].document.uri.fragment, 'W2sZmlsZQ==');

        const affectedCells = analyzer.getSuccessorCells(cells[0]);
        assert.strictEqual(affectedCells.length, 2);
        assert.strictEqual(affectedCells[1].document.uri.fragment, 'W2sZmlsZQ==');

        const affectedCells2 = analyzer.getSuccessorCells(cells[1]);
        assert.strictEqual(affectedCells2.length, 2);
        assert.strictEqual(affectedCells2[1].document.uri.fragment, 'W2sZmlsZQ==');
    });

    test.skip('Basic type dependencies 3', () => {
        const cells: INotebookCell[] = withNotebookCells(
            [
                ['W0sZmlsZQ==', 'import pandas as pd'],
                [
                    'W1sZmlsZQ==',
                    "Cars = {'Brand': ['Honda Civic','Toyota Corolla','Ford Focus','Audi A4'], 'Price': [22000,25000,27000,35000]}\n" +
                        "df = pd.DataFrame(Cars,columns= ['Brand', 'Price'])"
                ],
                ['W2sZmlsZQ==', 'def check(df, size=11):\n' + '    print(df)'],
                ['W3sZmlsZQ==', 'print(df)'],
                ['W4sZmlsZQ==', "x = df['Brand'].values"]
            ],
            'df.ipynb'
        );

        const refsArr = [
            [
                'W1sZmlsZQ==',
                [
                    {
                        range: [
                            { line: 0, character: 0 },
                            { line: 0, character: 4 }
                        ],
                        uri: { fragment: 'W1sZmlsZQ==' },
                        kind: 'write'
                    },
                    {
                        range: [
                            { line: 1, character: 18 },
                            { line: 1, character: 22 }
                        ],
                        uri: { fragment: 'W1sZmlsZQ==' },
                        kind: 'read'
                    },
                    {
                        range: [
                            { line: 1, character: 0 },
                            { line: 1, character: 2 }
                        ],
                        uri: { fragment: 'W1sZmlsZQ==' },
                        kind: 'write'
                    },
                    {
                        range: [
                            { line: 0, character: 6 },
                            { line: 0, character: 8 }
                        ],
                        uri: { fragment: 'W3sZmlsZQ==' },
                        kind: 'read'
                    },
                    {
                        range: [
                            { line: 0, character: 4 },
                            { line: 0, character: 6 }
                        ],
                        uri: { fragment: 'W4sZmlsZQ==' },
                        kind: 'read'
                    }
                ]
            ],
            [
                'W2sZmlsZQ==',
                [
                    {
                        range: [
                            { line: 0, character: 4 },
                            { line: 0, character: 9 }
                        ],
                        uri: { fragment: 'W2sZmlsZQ==' },
                        kind: 'read'
                    }
                ]
            ],
            [
                'W4sZmlsZQ==',
                [
                    {
                        range: [
                            { line: 0, character: 0 },
                            { line: 0, character: 1 }
                        ],
                        uri: { fragment: 'W4sZmlsZQ==' },
                        kind: 'write'
                    }
                ]
            ]
        ];

        const refsMap = new Map<string, ILocationWithReferenceKind[]>();
        for (let i = 0; i < refsArr.length; i++) {
            const refs: ILocationWithReferenceKind[] = (refsArr[i][1] as unknown[]).map((ref: any) => ({
                uri: vscode.Uri.parse('df.ipynb').with({ fragment: ref.uri.fragment }),
                range: {
                    start: { line: ref.range[0].line, character: ref.range[0].character },
                    end: { line: ref.range[1].line, character: ref.range[1].character }
                }
            }));
            const fragment = refsArr[i][0] as string;
            refsMap.set(fragment, refs);
        }

        const cellExecutions: ICellExecution[] = [
            {
                cell: cells[0],
                executionCount: 1
            },
            {
                cell: cells[1],
                executionCount: 2
            },
            {
                cell: cells[2],
                executionCount: 3
            },
            {
                cell: cells[3],
                executionCount: 4
            },
            {
                cell: cells[4],
                executionCount: 5
            }
        ];

        const analyzer = new CellAnalysis(cellExecutions, refsMap);
        const deps = analyzer.getPredecessorCells(cells[4]);
        assert.strictEqual(deps.length, 3);
        assert.strictEqual(deps[0].document.uri.fragment, 'W0sZmlsZQ==');
        assert.strictEqual(deps[1].document.uri.fragment, 'W1sZmlsZQ==');
        assert.strictEqual(deps[2].document.uri.fragment, 'W4sZmlsZQ==');
    });
});
