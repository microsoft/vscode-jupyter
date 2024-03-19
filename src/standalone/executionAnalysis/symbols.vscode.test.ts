// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as assert from 'assert';
import * as vscode from 'vscode';
import { anything, instance, mock, when } from 'ts-mockito';
import { CellAnalysis, ICellExecution, ILocationWithReferenceKind, NotebookDocumentSymbolTracker } from './symbols';
import { PylanceExtension } from './common';
import { activatePylance } from './pylance';

function withNotebookCells(data: [string, string][], fileName: string) {
    const cells: vscode.NotebookCell[] = data.map((cellDto) => {
        const cell = mock<vscode.NotebookCell>();
        const document = mock<vscode.TextDocument>();
        when(document.uri).thenReturn(vscode.Uri.parse(fileName).with({ fragment: cellDto[0] }));
        when(cell.document).thenReturn(instance(document));
        return instance(cell);
    });
    return cells;
}

suite('Analysis', () => {
    test('Basic type dependencies', () => {
        const cells: vscode.NotebookCell[] = withNotebookCells(
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

        const mockDocument = mock<vscode.NotebookDocument>();
        when(mockDocument.getCells()).thenReturn(cells);
        when(mockDocument.getCells(anything())).thenReturn(cells);
        const document = instance(mockDocument);

        {
            const analyzer = new CellAnalysis(document, cellExecutions, refsMap);
            const deps = analyzer.getPredecessorCells(cells[2]);
            assert.strictEqual(deps.length, 2);
            assert.strictEqual(deps[0].document.uri.fragment, 'W0sZmlsZQ==');
            assert.strictEqual(deps[1].document.uri.fragment, 'W2sZmlsZQ==');
            const deps2 = analyzer.getPredecessorCells(cells[3]);
            assert.strictEqual(deps2.length, 3);
            assert.strictEqual(deps2[0].document.uri.fragment, 'W0sZmlsZQ==');
            assert.strictEqual(deps2[1].document.uri.fragment, 'W1sZmlsZQ==');
            assert.strictEqual(deps2[2].document.uri.fragment, 'W3sZmlsZQ==');
        }

        {
            const analyzer = new CellAnalysis(document, cellExecutions, refsMap);
            const affectedCells = analyzer.getSuccessorCells(cells[0]);
            assert.strictEqual(affectedCells.length, 4);
            assert.strictEqual(affectedCells[1].document.uri.fragment, 'W1sZmlsZQ==');
            assert.strictEqual(affectedCells[2].document.uri.fragment, 'W2sZmlsZQ==');
            assert.strictEqual(affectedCells[3].document.uri.fragment, 'W3sZmlsZQ==');
        }

        {
            const analyzer = new CellAnalysis(document, cellExecutions, refsMap);
            const affectedCells = analyzer.getSuccessorCells(cells[1]);
            assert.strictEqual(affectedCells.length, 2);
            assert.strictEqual(affectedCells[1].document.uri.fragment, 'W3sZmlsZQ==');
        }

        {
            const analyzer = new CellAnalysis(document, [], refsMap);
            const deps = analyzer.getPredecessorCells(cells[2]);
            assert.strictEqual(deps.length, 2);
            assert.strictEqual(deps[0].document.uri.fragment, 'W0sZmlsZQ==');
            assert.strictEqual(deps[1].document.uri.fragment, 'W2sZmlsZQ==');
            const deps2 = analyzer.getPredecessorCells(cells[3]);
            assert.strictEqual(deps2.length, 3);
            assert.strictEqual(deps2[0].document.uri.fragment, 'W0sZmlsZQ==');
            assert.strictEqual(deps2[1].document.uri.fragment, 'W1sZmlsZQ==');
            assert.strictEqual(deps2[2].document.uri.fragment, 'W3sZmlsZQ==');
        }

        {
            const analyzer = new CellAnalysis(document, [], refsMap);
            const affectedCells = analyzer.getSuccessorCells(cells[0]);
            assert.strictEqual(affectedCells.length, 4);
            assert.strictEqual(affectedCells[1].document.uri.fragment, 'W1sZmlsZQ==');
            assert.strictEqual(affectedCells[2].document.uri.fragment, 'W2sZmlsZQ==');
            assert.strictEqual(affectedCells[3].document.uri.fragment, 'W3sZmlsZQ==');
        }

        {
            const analyzer = new CellAnalysis(document, [], refsMap);
            const affectedCells = analyzer.getSuccessorCells(cells[1]);
            assert.strictEqual(affectedCells.length, 2);
            assert.strictEqual(affectedCells[1].document.uri.fragment, 'W3sZmlsZQ==');
        }
    });

    test('Basic type dependencies 2', () => {
        const cells: vscode.NotebookCell[] = withNotebookCells(
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

        const mockDocument = mock<vscode.NotebookDocument>();
        when(mockDocument.getCells()).thenReturn(cells);
        when(mockDocument.getCells(anything())).thenReturn(cells);
        const document = instance(mockDocument);

        {
            const analyzer = new CellAnalysis(document, cellExecutions, refsMap);
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
        }

        {
            const analyzer = new CellAnalysis(document, [], refsMap);
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
        }
    });

    test('Basic type dependencies 3', () => {
        const cells: vscode.NotebookCell[] = withNotebookCells(
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
                'W0sZmlsZQ==',
                [
                    {
                        range: [
                            { line: 1, character: 17 },
                            { line: 1, character: 19 }
                        ],
                        uri: { fragment: 'W0sZmlsZQ==' },
                        kind: 'write'
                    },
                    {
                        range: [
                            { line: 1, character: 7 },
                            { line: 1, character: 9 }
                        ],
                        uri: { fragment: 'W1sZmlsZQ==' },
                        kind: 'read'
                    }
                ]
            ],
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

        const mockDocument = mock<vscode.NotebookDocument>();
        when(mockDocument.getCells()).thenReturn(cells);
        when(mockDocument.getCells(anything())).thenReturn(cells);
        const document = instance(mockDocument);

        const analyzer = new CellAnalysis(document, cellExecutions, refsMap);
        const deps = analyzer.getPredecessorCells(cells[4]);
        assert.strictEqual(deps.length, 3);
        assert.strictEqual(deps[0].document.uri.fragment, 'W0sZmlsZQ==');
        assert.strictEqual(deps[1].document.uri.fragment, 'W1sZmlsZQ==');
        assert.strictEqual(deps[2].document.uri.fragment, 'W4sZmlsZQ==');
    });
});

function closeAllEditors(): Thenable<any> {
    return vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

(vscode.extensions.getExtension(PylanceExtension) ? suite : suite.skip)('Cell Analysis - Pylance', () => {
    test('Advanced type dependencies', async () => {
        const document = await vscode.workspace.openNotebookDocument(
            'jupyter-notebook',
            new vscode.NotebookData([
                new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'import pandas as pd', 'python'),
                new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'df = pd.DataFrame()', 'python'),
                new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'mylist = [1, 2, 3, 4]', 'python'),
                new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'mylist2 = [2, 3, 4, 5]', 'python'),
                new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'print(mylist)', 'python')
            ])
        );

        const editor = await await vscode.window.showNotebookDocument(document);
        const referencesProvider = await activatePylance();
        if (!referencesProvider) {
            assert.fail('Pylance not found');
        }

        const documentSymbolTracker = new NotebookDocumentSymbolTracker(editor, referencesProvider);

        {
            const precedentCellRanges = await documentSymbolTracker.getPrecedentCells(document.cellAt(1));
            assert.equal(precedentCellRanges.length, 1);
            assert.equal(precedentCellRanges[0].start, 0);
            assert.equal(precedentCellRanges[0].end, 2);
        }

        {
            const precedentCellRanges = await documentSymbolTracker.getPrecedentCells(document.cellAt(4));
            assert.equal(precedentCellRanges.length, 2);
            assert.equal(precedentCellRanges[0].start, 2);
            assert.equal(precedentCellRanges[0].end, 3);
            assert.equal(precedentCellRanges[1].start, 4);
            assert.equal(precedentCellRanges[1].end, 5);
        }

        {
            const successorCellRanges = await documentSymbolTracker.getSuccessorCells(document.cellAt(0));
            assert.equal(successorCellRanges.length, 1);
            assert.equal(successorCellRanges[0].start, 0);
            assert.equal(successorCellRanges[0].end, 2);
        }

        await closeAllEditors();
    });

    test('Advanced type dependencies 2', async () => {
        const document = await vscode.workspace.openNotebookDocument(
            'jupyter-notebook',
            new vscode.NotebookData([
                new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'import numpy as np', 'python'),
                new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'arr = np.array([1, 2, 3, 4])', 'python'),
                new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'arr2 = np.array([2, 3, 4, 5])', 'python'),
                new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'print(arr)', 'python')
            ])
        );
        const editor = await vscode.window.showNotebookDocument(document);
        const referencesProvider = await activatePylance();
        if (!referencesProvider) {
            assert.fail('Pylance not found');
        }
        const documentSymbolTracker = new NotebookDocumentSymbolTracker(editor, referencesProvider);
        {
            const precedentCellRanges = await documentSymbolTracker.getPrecedentCells(document.cellAt(1));
            assert.equal(precedentCellRanges.length, 1);
            assert.equal(precedentCellRanges[0].start, 0);
            assert.equal(precedentCellRanges[0].end, 2);
        }

        {
            const precedentCellRanges = await documentSymbolTracker.getPrecedentCells(document.cellAt(3));
            assert.equal(precedentCellRanges.length, 2);

            // cell 3 depends on cell 1, cell 1 depends on cell 0
            assert.equal(precedentCellRanges[0].start, 0);
            assert.equal(precedentCellRanges[0].end, 2);
            assert.equal(precedentCellRanges[1].start, 3);
            assert.equal(precedentCellRanges[1].end, 4);
        }

        {
            const successorCellRanges = await documentSymbolTracker.getSuccessorCells(document.cellAt(0));
            assert.equal(successorCellRanges.length, 1);
            assert.equal(successorCellRanges[0].start, 0);
            assert.equal(successorCellRanges[0].end, 4);
        }

        await closeAllEditors();
    });

    test('Advanced type dependencies 3', async () => {
        const document = await vscode.workspace.openNotebookDocument(
            'jupyter-notebook',
            new vscode.NotebookData([
                new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'import matplotlib.pyplot as plt', 'python'),
                new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'x = [1, 2, 3, 4]', 'python'),
                new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'y = [2, 3, 4, 5]', 'python'),
                new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'plt.plot(x, y)', 'python')
            ])
        );
        const editor = await vscode.window.showNotebookDocument(document);
        const referencesProvider = await activatePylance();
        if (!referencesProvider) {
            assert.fail('Pylance not found');
        }
        const documentSymbolTracker = new NotebookDocumentSymbolTracker(editor, referencesProvider);
        {
            const precedentCellRanges = await documentSymbolTracker.getPrecedentCells(document.cellAt(1));
            assert.equal(precedentCellRanges.length, 1);
            assert.equal(precedentCellRanges[0].start, 1);
            assert.equal(precedentCellRanges[0].end, 2);
        }

        {
            const precedentCellRanges = await documentSymbolTracker.getPrecedentCells(document.cellAt(3));
            assert.equal(precedentCellRanges.length, 1);

            assert.equal(precedentCellRanges[0].start, 0);
            assert.equal(precedentCellRanges[0].end, 4);
        }

        {
            const successorCellRanges = await documentSymbolTracker.getSuccessorCells(document.cellAt(0));
            assert.equal(successorCellRanges.length, 2);
            assert.equal(successorCellRanges[0].start, 0);
            assert.equal(successorCellRanges[0].end, 1);

            assert.equal(successorCellRanges[1].start, 3);
            assert.equal(successorCellRanges[1].end, 4);
        }

        await closeAllEditors();
    });
});
