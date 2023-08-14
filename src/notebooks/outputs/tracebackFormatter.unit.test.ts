// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { instance, mock, when } from 'ts-mockito';
import { NotebookCell, NotebookDocument, TextDocument, Uri } from 'vscode';
import { JupyterNotebookView } from '../../platform/common/constants';
import { NotebookTracebackFormatter } from './tracebackFormatter';

suite(`Notebook trace formatter`, function () {
    let notebook: NotebookDocument;
    let cell: NotebookCell;
    let document: TextDocument;

    setup(() => {
        notebook = mock<NotebookDocument>();
        when(notebook.notebookType).thenReturn(JupyterNotebookView);
        cell = mock<NotebookCell>();
        when(cell.index).thenReturn(0);
        when(cell.notebook).thenReturn(instance(notebook));
        document = mock<TextDocument>();
        const uri = Uri.parse('vscode-notebook-cell:error.ipynb#W0sZmlsZQ==');
        when(document.uri).thenReturn(uri);
        when(cell.document).thenReturn(instance(document));
    });

    test('ipython: 8.3.0, ipykernel: 6.13.0', function () {
        const formatter = new NotebookTracebackFormatter();
        /**
         * To generate the traceback, install a specific version of ipykernel and ipython.
         * Then run following code in a cell:
         * ```
         * 1
         * x
         * ```
         * This will generate the traceback below.
         */
        const traceback = [
            '[0;31m---------------------------------------------------------------------------[0m',
            '[0;31mNameError[0m                                 Traceback (most recent call last)',
            'Input [0;32mIn [2][0m, in [0;36m<cell line: 2>[0;34m()[0m\n[1;32m      1[0m [38;5;241m1[39m\n[0;32m----> 2[0m [43mx[49m\n',
            "[0;31mNameError[0m: name 'x' is not defined"
        ];

        const formated = formatter.format(instance(cell), traceback);
        const expected = [
            '[0;31m---------------------------------------------------------------------------[0m',
            '[0;31mNameError[0m                                 Traceback (most recent call last)',
            "[1;32merror.ipynb Cell 1[0m line [0;36m<cell line: 2>[0;34m()[0m\n[1;32m      <a href='vscode-notebook-cell:error.ipynb#W0sZmlsZQ%3D%3D?line=0'>1</a>[0m [39m1[39m\n[0;32m----> <a href='vscode-notebook-cell:error.ipynb#W0sZmlsZQ%3D%3D?line=1'>2</a>[0m x\n",
            "[0;31mNameError[0m: name 'x' is not defined"
        ];

        assert.deepEqual(formated, expected);
    });

    test('ipython 8.5.0, ipykernel 6.16.0', function () {
        const formatter = new NotebookTracebackFormatter();
        const traceback = [
            '[0;31m---------------------------------------------------------------------------[0m',
            '[0;31mNameError[0m                                 Traceback (most recent call last)',
            'Cell [0;32mIn [1], line 2[0m\n[1;32m      1[0m [38;5;241m1[39m\n[0;32m----> 2[0m x\n',
            "[0;31mNameError[0m: name 'x' is not defined"
        ];

        const formated = formatter.format(instance(cell), traceback);
        const expected = [
            '[0;31m---------------------------------------------------------------------------[0m',
            '[0;31mNameError[0m                                 Traceback (most recent call last)',
            "[1;32merror.ipynb Cell 1[0m line [0;36m2\n[1;32m      <a href='vscode-notebook-cell:error.ipynb#W0sZmlsZQ%3D%3D?line=0'>1</a>[0m [39m1[39m\n[0;32m----> <a href='vscode-notebook-cell:error.ipynb#W0sZmlsZQ%3D%3D?line=1'>2</a>[0m x\n",
            "[0;31mNameError[0m: name 'x' is not defined"
        ];

        assert.deepEqual(formated, expected);
    });
});
