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
import { logger } from '../../../platform/logging';
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
import { isWeb } from '../../../platform/common/utils/misc';

suiteMandatory('Remote Tests', function () {
    const disposables: IDisposable[] = [];
    this.timeout(120_000);
    // Retry at least once, because ipywidgets can be flaky (network, comms, etc).
    this.retries(1);
    let editor: NotebookEditor;
    suiteSetup(async function () {
        if (!isWeb()) {
            return this.skip();
        }
        logger.info('Suite Setup Remote Tests');
        this.timeout(120_000);
        await initialize();
        logger.info('Suite Setup Remote Tests, Step 2');
        await startJupyterServer();
        logger.info('Suite Setup Remote Tests, Step 4');
        await prewarmNotebooks();
        logger.info('Suite Setup Remote Tests, Step 5');
        editor = (await createEmptyPythonNotebook(disposables, undefined, true)).editor;
        await selectDefaultController(editor);
        logger.info('Suite Setup (completed)');
    });
    // Use same notebook without starting kernel in every single test (use one for whole suite).
    setup(async function () {
        logger.info(`Start Test ${this.currentTest?.title}`);
        await startJupyterServer();
        logger.info(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        logger.info(`Ended Test ${this.currentTest?.title}`);
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this);
        }
        // await closeNotebooksAndCleanUpAfterTests(disposables);
        logger.info(`Ended Test (completed) ${this.currentTest?.title}`);
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
