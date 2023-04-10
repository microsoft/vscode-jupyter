// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { getNotebookUriFromInputBoxUri } from '../../../../standalone/intellisense/notebookPythonPathService.node';
import { Uri } from 'vscode';

suite(`DataScience - VSCode Intellisense Notebook - PythonPath service @lsp`, function () {
    test('Not an input box', async () => {
        const notebookUri = getNotebookUriFromInputBoxUri(Uri.file('/foo/bar.py'));
        assert.notOk(notebookUri);
    });
    test('Input box', async () => {
        const notebookUri = getNotebookUriFromInputBoxUri(Uri.parse('vscode-interactive-input:/InteractiveInput-3'));
        assert.ok(notebookUri);
        assert.strictEqual(
            notebookUri!.toString(),
            Uri.from({ scheme: 'vscode-interactive', path: 'Interactive-3.interactive' }).toString()
        );
    });
});
