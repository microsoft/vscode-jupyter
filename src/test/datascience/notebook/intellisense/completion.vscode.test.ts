// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as sinon from 'sinon';
import { commands, CompletionList, Position } from 'vscode';
import { IVSCodeNotebook } from '../../../../platform/common/application/types';
import { traceInfo } from '../../../../platform/logging';
import { IDisposable } from '../../../../platform/common/types';
import { InteractiveWindowProvider } from '../../../../interactive-window/interactiveWindowProvider';
import { captureScreenShot, IExtensionTestApi } from '../../../common.node';
import { IS_REMOTE_NATIVE_TEST } from '../../../constants.node';
import { initialize } from '../../../initialize.node';
import {
    closeNotebooksAndCleanUpAfterTests,
    runCell,
    insertCodeCell,
    startJupyterServer,
    waitForExecutionCompletedSuccessfully,
    prewarmNotebooks,
    createEmptyPythonNotebook
} from '../helper.node';
import { setIntellisenseTimeout } from '../../../../standalone/intellisense/pythonKernelCompletionProvider';
import { Settings } from '../../../../platform/common/constants';
import { getTextOutputValue } from '../../../../kernels/execution/helpers';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('VSCode Intellisense Notebook and Interactive Code Completion @lsp', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
    this.timeout(120_000);
    suiteSetup(async function () {
        traceInfo(`Start Suite Code Completion via Jupyter`);
        if (IS_REMOTE_NATIVE_TEST()) {
            // https://github.com/microsoft/vscode-jupyter/issues/6331
            return this.skip();
        }
        this.timeout(120_000);
        api = await initialize();
        await startJupyterServer();
        await prewarmNotebooks();
        sinon.restore();
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        traceInfo(`Start Suite (Completed) Code Completion via Jupyter`);
    });
    // Use same notebook without starting kernel in every single test (use one for whole suite).
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        sinon.restore();
        await startJupyterServer();
        await createEmptyPythonNotebook(disposables);
        setIntellisenseTimeout(30000);
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        setIntellisenseTimeout(Settings.IntellisenseTimeout);
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this);
        }
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));
    test('Execute cell and get completions for variable', async () => {
        await insertCodeCell('import sys\nprint(sys.executable)\na = 1', { index: 0 });
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;

        await runCell(cell);

        // Wait till execution count changes and status is success.
        await waitForExecutionCompletedSuccessfully(cell);
        const outputText = getTextOutputValue(cell.outputs[0]).trim();
        traceInfo(`Cell Output ${outputText}`);
        await insertCodeCell('a.', { index: 1 });
        const cell2 = vscodeNotebook.activeNotebookEditor!.notebook.cellAt(1);

        const position = new Position(0, 2);
        traceInfo('Get completions in test');
        // Executing the command `vscode.executeCompletionItemProvider` to simulate triggering completion
        const completions = (await commands.executeCommand(
            'vscode.executeCompletionItemProvider',
            cell2.document.uri,
            position
        )) as CompletionList;
        const items = completions.items.map((item) => item.label);
        assert.isOk(items.length);
        assert.ok(
            items.find((item) =>
                typeof item === 'string' ? item.includes('bit_length') : item.label.includes('bit_length')
            )
        );
        assert.ok(
            items.find((item) =>
                typeof item === 'string' ? item.includes('to_bytes') : item.label.includes('to_bytes')
            )
        );
    });
});
