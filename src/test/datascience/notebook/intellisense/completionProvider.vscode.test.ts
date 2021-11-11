// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as sinon from 'sinon';
import { CancellationTokenSource, CompletionContext, CompletionTriggerKind, Position } from 'vscode';
import { IVSCodeNotebook } from '../../../../client/common/application/types';
import { traceInfo } from '../../../../client/common/logger';
import { IDisposable } from '../../../../client/common/types';
import { PythonKernelCompletionProvider } from '../../../../client/datascience/notebook/intellisense/pythonKernelCompletionProvider';
import { IExtensionTestApi, sleep } from '../../../common';
import { IS_REMOTE_NATIVE_TEST } from '../../../constants';
import { initialize } from '../../../initialize';
import {
    canRunNotebookTests,
    closeNotebooksAndCleanUpAfterTests,
    runCell,
    insertCodeCell,
    startJupyterServer,
    waitForExecutionCompletedSuccessfully,
    prewarmNotebooks,
    createEmptyPythonNotebook,
    getCellOutputs
} from '../helper';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataScience - VSCode Intellisense Notebook - (Code Completion via Jupyter) (slow)', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
    let completionProvider: PythonKernelCompletionProvider;
    this.timeout(120_000);
    suiteSetup(async function () {
        traceInfo(`Start Suite Code Completion via Jupyter`);
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
        completionProvider = api.serviceContainer.get<PythonKernelCompletionProvider>(PythonKernelCompletionProvider);
        traceInfo(`Start Suite (Completed) Code Completion via Jupyter`);
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
    test('Execute cell and get completions that require jupyter', async () => {
        await insertCodeCell('%pip install pandas', {
            index: 0
        });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;

        await runCell(cell);

        // Wait till execution count changes and status is success.
        await waitForExecutionCompletedSuccessfully(cell);
        await insertCodeCell(
            `import pandas as pd\ndf = pd.read_csv("../src/test/datascience/notebook/intellisense/names.csv")\n`,
            {
                index: 1
            }
        );
        const cell2 = vscodeNotebook.activeNotebookEditor?.document.cellAt(1)!;

        await runCell(cell2);

        // Wait till execution count changes and status is success.
        await waitForExecutionCompletedSuccessfully(cell2);
        const cell3 = await insertCodeCell('import os\nprint(os.getcwd())\n');
        await runCell(cell3);

        // Wait till execution count changes and status is success.
        await waitForExecutionCompletedSuccessfully(cell3);
        traceInfo(`last cell output: ${getCellOutputs(cell3)}`);

        // Now add the cell to check intellisense.
        await insertCodeCell('df.');
        const cell4 = vscodeNotebook.activeNotebookEditor!.document.cellAt(3);

        const token = new CancellationTokenSource().token;
        const position = new Position(0, 3);
        const context: CompletionContext = {
            triggerKind: CompletionTriggerKind.TriggerCharacter,
            triggerCharacter: '.'
        };
        traceInfo('Get completions in test');
        let completions = await completionProvider.provideCompletionItems(cell4.document, position, token, context);
        await sleep(500);
        // Ask a second time as Jupyter can sometimes not be ready
        traceInfo('Get completions second time in test');
        completions = await completionProvider.provideCompletionItems(cell4.document, position, token, context);
        const items = completions.map((item) => item.label);
        assert.isOk(items.length);
        assert.ok(items.find((item) => (typeof item === 'string' ? item.includes('Age') : item.label.includes('Age'))));

        // Make sure it is skipping items that are already provided by pylance (no dupes)
        assert.notOk(
            items.find((item) => (typeof item === 'string' ? item.includes('Name') : item.label.includes('Name')))
        );
    });
});
