// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as sinon from 'sinon';
import { Position } from 'vscode';
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
    waitForHover
} from '../helper.node';
import { setIntellisenseTimeout } from '../../../../standalone/intellisense/pythonKernelCompletionProvider';
import { Settings } from '../../../../platform/common/constants';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('VSCode Intellisense Notebook Hover @lsp', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
    this.timeout(120_000);
    suiteSetup(async function () {
        traceInfo(`Start Suite Hover`);
        this.timeout(120_000);
        api = await initialize();
        if (IS_REMOTE_NATIVE_TEST()) {
            // https://github.com/microsoft/vscode-jupyter/issues/6331
            return this.skip();
        }
        sinon.restore();
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        traceInfo(`Start Suite (Completed) Hover`);
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
    test.skip('Insert cell and get hover text', async () => {
        // https://github.com/microsoft/vscode-jupyter/issues/12503
        await insertCodeCell('import sys\nprint(sys.executable)\na = 1', { index: 0 });
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;
        const position = new Position(1, 2);
        traceInfo('Get hover in test');
        const hovers = await waitForHover(cell.document.uri, position);
        assert.isOk(hovers.length);
        assert.ok(
            hovers.find((hover) =>
                hover.contents.find((item) =>
                    typeof item == 'string' ? item.includes('print') : item.value.includes('print')
                )
            )
        );
    });

    test('Get hovers in interactive window', async () => {
        // Waiting for Joyce's work for creating IW
        // gist of test
    });
});
