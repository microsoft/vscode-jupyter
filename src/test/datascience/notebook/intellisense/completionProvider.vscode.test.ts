// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as sinon from 'sinon';
import { CancellationTokenSource, CompletionContext, CompletionTriggerKind, Position } from 'vscode';
import { IVSCodeNotebook } from '../../../../client/common/application/types';
import { traceInfo } from '../../../../client/common/logger';
import { IDisposable } from '../../../../client/common/types';
import { NotebookCompletionProvider } from '../../../../client/datascience/notebook/intellisense/completionProvider';
import { IExtensionTestApi } from '../../../common';
import { initialize } from '../../../initialize';
import {
    canRunNotebookTests,
    closeNotebooksAndCleanUpAfterTests,
    runCell,
    insertCodeCell,
    trustAllNotebooks,
    startJupyterServer,
    waitForExecutionCompletedSuccessfully,
    prewarmNotebooks,
    createEmptyPythonNotebook
} from '../helper';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataScience - VSCode Notebook - (Code Completion via Jupyter) (slow)', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
    let completionProvider: NotebookCompletionProvider;
    this.timeout(120_000);
    suiteSetup(async function () {
        this.timeout(120_000);
        api = await initialize();
        if (!(await canRunNotebookTests())) {
            return this.skip();
        }
        await trustAllNotebooks();
        await startJupyterServer();
        await prewarmNotebooks();
        sinon.restore();
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        completionProvider = api.serviceContainer.get<NotebookCompletionProvider>(NotebookCompletionProvider);
    });
    // Use same notebook without starting kernel in every single test (use one for whole suite).
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        sinon.restore();
        await startJupyterServer();
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
    test('Execute cell and get completions for variable', async () => {
        await insertCodeCell('import sys\nprint(sys.executable)\na = 1', { index: 0 });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cells![0]!;

        await runCell(cell);

        // Wait till execution count changes and status is success.
        await waitForExecutionCompletedSuccessfully(cell);
        const outputText: string = (cell.outputs[0].outputs.find(opit => opit.mime === 'text/plain')?.value as string).trim() || '';
        traceInfo(`Cell Output ${outputText}`);
        await insertCodeCell('a.', { index: 1 });
        const cell2 = vscodeNotebook.activeNotebookEditor!.document.cells[1];

        const token = new CancellationTokenSource().token;
        const position = new Position(0, 2);
        const context: CompletionContext = {
            triggerKind: CompletionTriggerKind.TriggerCharacter,
            triggerCharacter: '.'
        };
        traceInfo('Get completions in test');
        const completions = await completionProvider.provideCompletionItems(cell2.document, position, token, context);
        console.log(JSON.stringify(completions));
        const items = completions.map((item) => item.label);
        assert.isOk(items.length);
        assert.include(items, 'bit_length');
        assert.include(items, 'to_bytes');
    });
});
