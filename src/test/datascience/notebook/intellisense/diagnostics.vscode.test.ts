// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as sinon from 'sinon';
import { IVSCodeNotebook } from '../../../../client/common/application/types';
import { traceInfo } from '../../../../client/common/logger';
import { IDisposable } from '../../../../client/common/types';
import { IExtensionTestApi } from '../../../common';
import { IS_REMOTE_NATIVE_TEST } from '../../../constants';
import { initialize } from '../../../initialize';
import {
    canRunNotebookTests,
    closeNotebooksAndCleanUpAfterTests,
    insertCodeCell,
    createEmptyPythonNotebook,
    waitForDiagnostics
} from '../helper';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataScience - VSCode Intellisense Notebook Diagnostics', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
    this.timeout(120_000);
    suiteSetup(async function () {
        traceInfo(`Start Suite Diagnostics`);
        this.timeout(120_000);
        api = await initialize();
        if (IS_REMOTE_NATIVE_TEST) {
            // https://github.com/microsoft/vscode-jupyter/issues/6331
            return this.skip();
        }
        if (!(await canRunNotebookTests())) {
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
        await createEmptyPythonNotebook(disposables);
        process.env.VSC_JUPYTER_IntellisenseTimeout = '30000';
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        delete process.env.VSC_JUPYTER_IntellisenseTimeout;
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));
    test('Add cells and make sure errors show up', async () => {
        await insertCodeCell('import system', { index: 0 });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;

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
