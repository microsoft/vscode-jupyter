// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import {
    NotebookCellData,
    NotebookCellKind,
    NotebookEdit,
    NotebookEditor,
    NotebookRange,
    workspace,
    WorkspaceEdit
} from 'vscode';
import { traceInfo } from '../../../platform/logging';
import { IDisposable } from '../../../platform/common/types';
import { captureScreenShot, startJupyterServer, suiteMandatory, testMandatory, waitForCondition } from '../../common';
import { initialize } from '../../initialize';
import {
    closeNotebooksAndCleanUpAfterTests,
    createEmptyPythonNotebook,
    defaultNotebookTestTimeout,
    prewarmNotebooks,
    runCell,
    selectDefaultController,
    waitForExecutionCompletedSuccessfully,
    waitForTextOutput
} from '../notebook/helper';
import { IS_REMOTE_NATIVE_TEST } from '../../constants';
import { isWeb } from '../../../platform/common/utils/misc';

suiteMandatory('Remote Tests', function () {
    const disposables: IDisposable[] = [];
    this.timeout(120_000);
    // Retry at least once, because ipywidgets can be flaky (network, comms, etc).
    this.retries(1);
    let editor: NotebookEditor;
    suiteSetup(async function () {
        if (!IS_REMOTE_NATIVE_TEST() && !isWeb()) {
            return this.skip();
        }
        traceInfo('Suite Setup Remote Tests');
        this.timeout(120_000);
        await initialize();
        traceInfo('Suite Setup Remote Tests, Step 2');
        await startJupyterServer();
        traceInfo('Suite Setup Remote Tests, Step 4');
        await prewarmNotebooks();
        traceInfo('Suite Setup Remote Tests, Step 5');
        editor = (await createEmptyPythonNotebook(disposables, undefined, true)).editor;
        await selectDefaultController(editor);
        traceInfo('Suite Setup (completed)');
    });
    // Use same notebook without starting kernel in every single test (use one for whole suite).
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        await startJupyterServer();
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this);
        }
        // await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(async () => closeNotebooksAndCleanUpAfterTests(disposables));
    testMandatory('Execute cell and print Hello World', async function () {
        const nbEdit = NotebookEdit.replaceCells(new NotebookRange(0, editor.notebook.cellCount), [
            new NotebookCellData(NotebookCellKind.Code, 'print("Hello World")', 'python')
        ]);
        const edit = new WorkspaceEdit();
        edit.set(editor.notebook.uri, [nbEdit]);
        await workspace.applyEdit(edit);

        const cell = editor.notebook.cellAt(0)!;
        await Promise.all([
            runCell(cell),
            waitForExecutionCompletedSuccessfully(cell),
            waitForCondition(async () => cell.outputs.length > 0, defaultNotebookTestTimeout, 'Cell output is empty'),
            waitForTextOutput(cell, 'Hello World', 0, false)
        ]);
    });
});
