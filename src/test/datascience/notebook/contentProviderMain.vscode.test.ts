// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import { IDisposable } from 'monaco-editor';
import { anything, instance, mock, when } from 'ts-mockito';
import {
    EventEmitter,
    Memento,
    NotebookCellKind,
    NotebookCellRunState,
    Uri,
    NotebookContentProvider as VSCodeNotebookContentProvider,
    NotebookDocument,
    NotebookCellMetadata
} from 'vscode';
import { IVSCodeNotebook } from '../../../client/common/application/types';
import { MARKDOWN_LANGUAGE, PYTHON_LANGUAGE } from '../../../client/common/constants';
import { disposeAllDisposables } from '../../../client/common/helpers';
import { ICryptoUtils } from '../../../client/common/types';
import { NotebookContentProvider } from '../../../client/datascience/notebook/contentProvider';
import { NotebookEditorCompatibilitySupport } from '../../../client/datascience/notebook/notebookEditorCompatibilitySupport';
import { INotebookStorageProvider } from '../../../client/datascience/notebookStorage/notebookStorageProvider';
import { createNotebookModel } from './helper';
/* eslint-disable @typescript-eslint/no-explicit-any */
suite('DataScience - NativeNotebook ContentProvider', () => {
    let storageProvider: INotebookStorageProvider;
    let contentProvider: VSCodeNotebookContentProvider;
    const fileUri = Uri.file('a.ipynb');
    const disposables: IDisposable[] = [];
    setup(async () => {
        storageProvider = mock<INotebookStorageProvider>();
        const compatSupport = mock(NotebookEditorCompatibilitySupport);
        when(compatSupport.canOpenWithOurNotebookEditor(anything())).thenReturn(true);
        when(compatSupport.canOpenWithVSCodeNotebookEditor(anything())).thenReturn(true);
        const vscNotebooks = mock<IVSCodeNotebook>();
        when(vscNotebooks.onDidSaveNotebookDocument).thenReturn(new EventEmitter<NotebookDocument>().event);
        const memento = mock<Memento>();
        when(memento.get(anything())).thenReturn();
        contentProvider = new NotebookContentProvider(
            instance(storageProvider),
            instance(compatSupport),
            instance(vscNotebooks)
        );
    });
    teardown(() => disposeAllDisposables(disposables));
    [true, false].forEach((isNotebookTrusted) => {
        suite(isNotebookTrusted ? 'Trusted Notebook' : 'Un-trusted notebook', () => {
            test('Return notebook with 2 cells', async () => {
                const model = createNotebookModel(
                    isNotebookTrusted,
                    Uri.file('any'),
                    instance(mock<Memento>()),
                    instance(mock<ICryptoUtils>()),
                    {
                        cells: [
                            {
                                cell_type: 'code',
                                execution_count: 10,
                                hasExecutionOrder: true,
                                outputs: [],
                                source: 'print(1)',
                                metadata: {}
                            },
                            {
                                cell_type: 'markdown',
                                hasExecutionOrder: false,
                                source: '# HEAD',
                                metadata: {}
                            }
                        ]
                    }
                );
                when(storageProvider.getOrCreateModel(anything())).thenResolve(model);

                const notebook = await contentProvider.openNotebook(fileUri, {});

                assert.isOk(notebook);
                assert.equal(notebook.metadata.cellEditable, isNotebookTrusted);
                assert.equal(notebook.metadata.cellRunnable, isNotebookTrusted);
                assert.equal(notebook.metadata.editable, isNotebookTrusted);
                assert.equal(notebook.metadata.runnable, isNotebookTrusted);

                // With Native Notebooks, the editable and runnable properties in cells don't matter
                // as long as the metadata is correct (checked above) there is no way to run untrusted notebooks
                assert.deepEqual(notebook.cells, [
                    {
                        cellKind: NotebookCellKind.Code,
                        language: PYTHON_LANGUAGE,
                        outputs: [],
                        source: 'print(1)',
                        metadata: new NotebookCellMetadata().with({
                            custom: {
                                metadata: {}
                            },
                            editable: true,
                            executionOrder: 10,
                            hasExecutionOrder: true,
                            runState: NotebookCellRunState.Idle,
                            runnable: true,
                            statusMessage: undefined
                        })
                    },
                    {
                        cellKind: NotebookCellKind.Markdown,
                        language: MARKDOWN_LANGUAGE,
                        outputs: [],
                        source: '# HEAD',
                        metadata: new NotebookCellMetadata().with({
                            custom: {
                                metadata: {}
                            },
                            editable: true,
                            executionOrder: undefined,
                            hasExecutionOrder: false,
                            runnable: false
                        })
                    }
                ]);
            });

            test('Return notebook with csharp language', async () => {
                const model = createNotebookModel(
                    isNotebookTrusted,
                    Uri.file('any'),
                    instance(mock<Memento>()),
                    instance(mock<ICryptoUtils>()),
                    {
                        metadata: {
                            language_info: {
                                name: 'csharp'
                            },
                            orig_nbformat: 5
                        },
                        cells: [
                            {
                                cell_type: 'code',
                                execution_count: 10,
                                hasExecutionOrder: true,
                                outputs: [],
                                source: 'Console.WriteLine("1")',
                                metadata: {}
                            },
                            {
                                cell_type: 'markdown',
                                hasExecutionOrder: false,
                                source: '# HEAD',
                                metadata: {}
                            }
                        ]
                    }
                );
                when(storageProvider.getOrCreateModel(anything())).thenResolve(model);

                const notebook = await contentProvider.openNotebook(fileUri, {});

                assert.isOk(notebook);

                assert.equal(notebook.metadata.cellEditable, isNotebookTrusted);
                assert.equal(notebook.metadata.cellRunnable, isNotebookTrusted);
                assert.equal(notebook.metadata.editable, isNotebookTrusted);
                assert.equal(notebook.metadata.runnable, isNotebookTrusted);

                // With Native Notebooks, the editable and runnable properties in cells don't matter
                // as long as the metadata is correct (checked above) there is no way to run untrusted notebooks
                assert.deepEqual(notebook.cells, [
                    {
                        cellKind: NotebookCellKind.Code,
                        language: 'csharp',
                        outputs: [],
                        source: 'Console.WriteLine("1")',
                        metadata: new NotebookCellMetadata().with({
                            custom: {
                                metadata: {}
                            },
                            editable: true,
                            executionOrder: 10,
                            hasExecutionOrder: true,
                            runState: NotebookCellRunState.Idle,
                            runnable: true,
                            statusMessage: undefined
                        })
                    },
                    {
                        cellKind: NotebookCellKind.Markdown,
                        language: MARKDOWN_LANGUAGE,
                        outputs: [],
                        source: '# HEAD',
                        metadata: new NotebookCellMetadata().with({
                            custom: {
                                metadata: {}
                            },
                            editable: true,
                            executionOrder: undefined,
                            hasExecutionOrder: false,
                            runnable: false
                        })
                    }
                ]);
            });
            test('Verify mime types and order', () => {
                // https://github.com/microsoft/vscode-python/issues/11880
            });
        });
    });
});
