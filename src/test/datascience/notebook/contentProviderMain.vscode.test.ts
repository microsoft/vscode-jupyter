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
    NotebookDocument,
    NotebookCellMetadata,
    CancellationTokenSource,
    NotebookCellData
} from 'vscode';
import { IVSCodeNotebook } from '../../../client/common/application/types';
import { MARKDOWN_LANGUAGE, PYTHON_LANGUAGE } from '../../../client/common/constants';
import { disposeAllDisposables } from '../../../client/common/helpers';
import { NotebookCellLanguageService } from '../../../client/datascience/notebook/cellLanguageService';
import { nbformat } from '@jupyterlab/coreutils';
import { NotebookSerializer } from '../../../client/datascience/notebook/notebookSerliazer';
/* eslint-disable @typescript-eslint/no-explicit-any */
suite('DataScience - VSCode Notebook ContentProvider', () => {
    let contentProvider: NotebookSerializer;
    const disposables: IDisposable[] = [];
    let languageService: NotebookCellLanguageService;
    setup(async () => {
        const vscNotebooks = mock<IVSCodeNotebook>();
        when(vscNotebooks.onDidSaveNotebookDocument).thenReturn(new EventEmitter<NotebookDocument>().event);
        const memento = mock<Memento>();
        when(memento.get(anything())).thenReturn();
        languageService = mock<NotebookCellLanguageService>();
        contentProvider = new NotebookSerializer(instance(languageService));
    });
    teardown(() => disposeAllDisposables(disposables));
    test('Return notebook with 2 cells', async () => {
        when(languageService.getPreferredLanguage(anything())).thenReturn(PYTHON_LANGUAGE);
        const json: nbformat.INotebookContent = {
            metadata: {
                orig_nbformat: 4
            },
            nbformat: 4,
            nbformat_minor: 2,
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
        };

        const notebook = contentProvider.deserializeNotebook(
            Buffer.from(JSON.stringify(json), 'utf-8'),
            new CancellationTokenSource().token
        );

        assert.isOk(notebook);
    });

    test('Return notebook with csharp language', async () => {
        when(languageService.getPreferredLanguage(anything())).thenReturn('csharp');
        const json: nbformat.INotebookContent = {
            nbformat: 4,
            nbformat_minor: 2,
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
        };

        const notebook = contentProvider.deserializeNotebook(
            Buffer.from(JSON.stringify(json), 'utf-8'),
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
