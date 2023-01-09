// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as sinon from 'sinon';
import { IVSCodeNotebook } from '../../../../platform/common/application/types';
import { traceInfo } from '../../../../platform/logging';
import { IDisposable } from '../../../../platform/common/types';
import { IExtensionTestApi } from '../../../common.node';
import { IS_REMOTE_NATIVE_TEST } from '../../../constants.node';
import { initialize } from '../../../initialize.node';
import {
    closeNotebooksAndCleanUpAfterTests,
    insertCodeCell,
    createEmptyPythonNotebook,
    waitForDiagnostics
} from '../helper.node';
import { Settings } from '../../../../platform/common/constants';
import { setIntellisenseTimeout } from '../../../../standalone/intellisense/pythonKernelCompletionProvider';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('VSCode Intellisense Notebook Diagnostics @lsp', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
    this.timeout(120_000);
    suiteSetup(async function () {
        traceInfo(`Start Suite Diagnostics`);
        this.timeout(120_000);
        api = await initialize();
        if (IS_REMOTE_NATIVE_TEST()) {
            // https://github.com/microsoft/vscode-jupyter/issues/6331
            return this.skip();
        }
        sinon.restore();
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        traceInfo(`Start Suite (Completed) Diagnostics`);
    });
    // Use same notebook without starting kernel in every single test (use one for whole suite).
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        sinon.restore();
        await createEmptyPythonNotebook(disposables, undefined, undefined, true);
        setIntellisenseTimeout(30000);
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        setIntellisenseTimeout(Settings.IntellisenseTimeout);
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));
    test.skip('Add cells and make sure errors show up', async () => {
        // https://github.com/microsoft/vscode-jupyter/issues/12503
        await insertCodeCell('import system', { index: 0 });
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;

        traceInfo('Get diagnostics in test');
        // Ask for the list of diagnostics
        const diagnostics = await waitForDiagnostics(cell.document.uri);
        assert.isOk(diagnostics.length);
        assert.ok(diagnostics.find((item) => item.message.includes('system')));
    });
    test('Markdown cells dont get errors', async () => {
        // Create two cells, one markdown, make sure not diagnostics in markdown
    });
    test('Javascript cells dont get errors', async () => {
        // Create two cells, one javascript, make sure not diagnostics in javascript
    });
    test('Markdown deleted, errors dont move', async () => {
        // Create three cells, one markdown, delete markdown, make sure errors stay place
    });
});
