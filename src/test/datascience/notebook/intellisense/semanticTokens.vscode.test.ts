// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as sinon from 'sinon';
import { commands, Position, window } from 'vscode';
import { IVSCodeNotebook } from '../../../../platform/common/application/types';
import { traceInfo } from '../../../../platform/logging';
import { IDisposable } from '../../../../platform/common/types';
import { captureScreenShot, IExtensionTestApi, waitForCondition } from '../../../common.node';
import { IS_REMOTE_NATIVE_TEST } from '../../../constants.node';
import { initialize } from '../../../initialize.node';
import {
    closeNotebooksAndCleanUpAfterTests,
    insertCodeCell,
    startJupyterServer,
    prewarmNotebooks,
    createEmptyPythonNotebook,
    defaultNotebookTestTimeout
} from '../helper.node';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('VSCode semantic token tests @lsp', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
    this.timeout(120_000);
    suiteSetup(async function () {
        traceInfo(`Start Suite semantic token tests`);
        this.timeout(120_000);
        api = await initialize();
        if (IS_REMOTE_NATIVE_TEST()) {
            // https://github.com/microsoft/vscode-jupyter/issues/6331
            return this.skip();
        }
        await startJupyterServer();
        await prewarmNotebooks();
        sinon.restore();
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        traceInfo(`Start Suite (Completed) semantic token tests`);
    });
    // Use same notebook without starting kernel in every single test (use one for whole suite).
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        sinon.restore();
        await startJupyterServer();
        await createEmptyPythonNotebook(disposables, undefined, undefined, true);
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this);
        }
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));
    test('Open a notebook and add a bunch of cells', async function () {
        await insertCodeCell('import sys\nprint(sys.executable)\na = 1');
        await insertCodeCell('\ndef test():\n  print("test")\ntest()');
        const cell1 = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;
        const cell2 = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(1)!;

        // Wait for tokens on the first cell (it works with just plain pylance)
        await waitForCondition(
            async () => {
                const promise = commands.executeCommand('vscode.provideDocumentSemanticTokens', cell1.document.uri);
                const result = (await promise) as any;
                return result && result.data.length > 0;
            },
            defaultNotebookTestTimeout,
            `Tokens never appear for first cell`,
            100,
            true
        );

        // Then get tokens on second cell. They should start on line 1. If not this
        // means there's a bug
        const tokens = (await commands.executeCommand(
            'vscode.provideDocumentSemanticTokens',
            cell2.document.uri
        )) as any;
        assert.ok(tokens, 'No tokens found on second cell');
        assert.equal(tokens.data[0], 1, 'Tokens not correctly offset');
    });

    test.skip('Edit cells in a notebook', async function () {
        await insertCodeCell('import sys\nprint(sys.executable)\na = 1');
        await insertCodeCell('\ndef test():\n  print("test")\ntest()');
        const cell1 = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;
        const cell2 = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(1)!;

        const editor = window.visibleTextEditors.find((e) => e.document.uri === cell1.document.uri);
        await editor?.edit((b) => {
            b.insert(new Position(2, 0), 'up');
        });

        // Wait for tokens on the first cell (it works with just plain pylance)
        await waitForCondition(
            async () => {
                const promise = commands.executeCommand('vscode.provideDocumentSemanticTokens', cell1.document.uri);
                const result = (await promise) as any;
                return result && result.data.length > 0;
            },
            defaultNotebookTestTimeout,
            `Tokens never appear for first cell`,
            100,
            true
        );

        // Then get tokens on second cell. They should start on line 1. If not this
        // means there's a bug
        const tokens = (await commands.executeCommand(
            'vscode.provideDocumentSemanticTokens',
            cell2.document.uri
        )) as any;
        assert.ok(tokens, 'No tokens found on second cell');
        const expectedTokens = [1, 4, 4, 11, 1, 1, 2, 5, 11, 512, 1, 0, 4, 11, 0];
        const actualTokens = [...tokens.data];
        assert.deepStrictEqual(actualTokens, expectedTokens, 'Tokens not correct after edit');
    });

    test.skip('Special token check', async function () {
        await insertCodeCell(
            'import sqllite3 as sql\n\nconn = sql.connect("test.db")\ncur = conn.cursor()\n# BLAH BLAH'
        );
        await insertCodeCell(
            '\ndata = [\n   ("name", "John", "age", 30)\n   ("name", "John", "age", 30)\n   ("name", "John", "age", 30)\n   ("name", "John", "age", 30)\n   ("name", "John", "age", 30)\n]',
            { index: 1 }
        );
        const cell1 = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;
        const cell2 = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(1)!;

        // Wait for tokens on the first cell (it works with just plain pylance)
        await waitForCondition(
            async () => {
                const promise = commands.executeCommand('vscode.provideDocumentSemanticTokens', cell1.document.uri);
                const result = (await promise) as any;
                return result && result.data.length > 0;
            },
            defaultNotebookTestTimeout,
            `Tokens never appear for first cell`,
            100,
            true
        );

        // Then get tokens on second cell.
        const tokens = (await commands.executeCommand(
            'vscode.provideDocumentSemanticTokens',
            cell2.document.uri
        )) as any;
        assert.ok(tokens, 'No tokens found on second cell');
        const expectedTokens: number[] = [1, 0, 4, 14, 1];
        const actualTokens: number[] = [...tokens.data];
        assert.deepStrictEqual(actualTokens, expectedTokens, 'Expected tokens not returned');
    });
});
