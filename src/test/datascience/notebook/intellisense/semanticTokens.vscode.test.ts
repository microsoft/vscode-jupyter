// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as sinon from 'sinon';
import { commands } from 'vscode';
import { IVSCodeNotebook } from '../../../../client/common/application/types';
import { traceInfo } from '../../../../client/common/logger';
import { IDisposable } from '../../../../client/common/types';
import { captureScreenShot, IExtensionTestApi, waitForCondition } from '../../../common';
import { IS_REMOTE_NATIVE_TEST } from '../../../constants';
import { initialize } from '../../../initialize';
import {
    canRunNotebookTests,
    closeNotebooksAndCleanUpAfterTests,
    insertCodeCell,
    startJupyterServer,
    prewarmNotebooks,
    createEmptyPythonNotebook,
    defaultNotebookTestTimeout
} from '../helper';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataScience - VSCode semantic token tests', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
    this.timeout(120_000);
    suiteSetup(async function () {
        traceInfo(`Start Suite semantic token tests`);
        this.timeout(120_000);
        api = await initialize();
        if (IS_REMOTE_NATIVE_TEST) {
            // https://github.com/microsoft/vscode-jupyter/issues/6331
            return this.skip();
        }
        if (!(await canRunNotebookTests())) {
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
        await createEmptyPythonNotebook(disposables);
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this.currentTest?.title);
        }
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));
    test('Open a notebook and add a bunch of cells', async function () {
        // Skip for now. Need to wait for changes to VS code
        this.skip();
        await insertCodeCell('import sys\nprint(sys.executable)\na = 1');
        await insertCodeCell('\ndef test():\n  print("test")\ntest()');
        const cell1 = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;
        const cell2 = vscodeNotebook.activeNotebookEditor?.document.cellAt(1)!;

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
});
