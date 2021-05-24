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
    Uri,
    NotebookDocument,
    NotebookCellMetadata,
    CancellationTokenSource,
    NotebookCellData
} from 'vscode';
import * as fs from 'fs-extra';
import { IVSCodeNotebook } from '../../../client/common/application/types';
import { MARKDOWN_LANGUAGE, PYTHON_LANGUAGE } from '../../../client/common/constants';
import { disposeAllDisposables } from '../../../client/common/helpers';
import { ICryptoUtils } from '../../../client/common/types';
import { NotebookCellLanguageService } from '../../../client/datascience/notebook/cellLanguageService';
import { NotebookSerializer } from '../../../client/datascience/notebook/contentProvider';
import { NotebookEditorCompatibilitySupport } from '../../../client/datascience/notebook/notebookEditorCompatibilitySupport';
import { INotebookStorageProvider } from '../../../client/datascience/notebookStorage/notebookStorageProvider';
import { createNotebookModel } from './helper';
/* eslint-disable @typescript-eslint/no-explicit-any */
suite('DataScience - VSCode Notebook ContentProvider', () => {
    let storageProvider: INotebookStorageProvider;
    let contentProvider: NotebookSerializer;
    const fileUri = Uri.file('a.ipynb');
    const disposables: IDisposable[] = [];
    setup(async () => {
        storageProvider = mock<INotebookStorageProvider>();
        const compatSupport = mock(NotebookEditorCompatibilitySupport);
        when(compatSupport.canOpenWithOurNotebookEditor(anything())).thenReturn(true);
        const vscNotebooks = mock<IVSCodeNotebook>();
        when(vscNotebooks.onDidSaveNotebookDocument).thenReturn(new EventEmitter<NotebookDocument>().event);
        const memento = mock<Memento>();
        when(memento.get(anything())).thenReturn();
        const languageService = mock<NotebookCellLanguageService>();
        when(languageService.getPreferredLanguage(anything())).thenReturn(PYTHON_LANGUAGE);
        contentProvider = new NotebookSerializer(instance(vscNotebooks), instance(languageService));
    });
    teardown(() => disposeAllDisposables(disposables));
    test('Return notebook with 2 cells', async () => {
        const model = createNotebookModel(Uri.file('any'), instance(mock<Memento>()), instance(mock<ICryptoUtils>()), {
            cells: [
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
            ]
        });
        when(storageProvider.getOrCreateModel(anything())).thenResolve(model);

        const notebook = await contentProvider.deserializeNotebook(
            fs.readFileSync(fileUri.fsPath),
            new CancellationTokenSource().token
        );
        assert.isOk(notebook);

        assert.deepEqual(notebook.cells, [
            new NotebookCellData(
                NotebookCellKind.Code,
                'print(1)',
                PYTHON_LANGUAGE,
                [],
                new NotebookCellMetadata().with({
                    custom: {
                        metadata: {}
                    }
                }),
                {
                    executionOrder: 10
                }
            ),
            new NotebookCellData(
                NotebookCellKind.Markup,
                '# HEAD',
                MARKDOWN_LANGUAGE,
                [],
                new NotebookCellMetadata().with({
                    custom: {
                        metadata: {}
                    }
                })
            )
        ]);
    });

    test('Return notebook with csharp language', async () => {
        const model = createNotebookModel(Uri.file('any'), instance(mock<Memento>()), instance(mock<ICryptoUtils>()), {
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
                    outputs: [],
                    source: 'Console.WriteLine("1")',
                    metadata: {}
                },
                {
                    cell_type: 'markdown',
                    source: '# HEAD',
                    metadata: {}
                }
            ]
        });
        when(storageProvider.getOrCreateModel(anything())).thenResolve(model);
        const notebook = await contentProvider.deserializeNotebook(
            fs.readFileSync(fileUri.fsPath),
            new CancellationTokenSource().token
        );

        assert.isOk(notebook);

        assert.deepEqual(notebook.cells, [
            new NotebookCellData(
                NotebookCellKind.Code,
                'Console.WriteLine("1")',
                'csharp',
                [],
                new NotebookCellMetadata().with({
                    custom: {
                        metadata: {}
                    }
                }),
                {
                    executionOrder: 10
                }
            ),
            new NotebookCellData(
                NotebookCellKind.Markup,
                '# HEAD',
                MARKDOWN_LANGUAGE,
                [],
                new NotebookCellMetadata().with({
                    custom: {
                        metadata: {}
                    }
                })
            )
        ]);
    });
    test('Verify mime types and order', () => {
        // https://github.com/microsoft/vscode-python/issues/11880
    });
});
