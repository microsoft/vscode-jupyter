// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import {
    NotebookCellData,
    NotebookCellKind,
    NotebookEdit,
    NotebookEditor,
    NotebookRange,
    Uri,
    window,
    workspace,
    WorkspaceEdit
} from 'vscode';
import { traceInfo } from '../../../platform/logging';
import { IDisposable } from '../../../platform/common/types';
import { captureScreenShot, startJupyterServer, suiteMandatory, testMandatory, waitForCondition } from '../../common';
import { closeActiveWindows, initialize } from '../../initialize';
import {
    closeNotebooks,
    closeNotebooksAndCleanUpAfterTests,
    createEmptyPythonNotebook,
    defaultNotebookTestTimeout,
    prewarmNotebooks,
    runCell,
    saveActiveNotebook,
    selectDefaultController,
    waitForExecutionCompletedSuccessfully,
    waitForTextOutput
} from '../notebook/helper';
import { IS_REMOTE_NATIVE_TEST } from '../../constants';
import { noop } from '../../../platform/common/utils/misc';
import { sleep } from '../../core';

suiteMandatory('Remote Tests', function () {
    const disposables: IDisposable[] = [];
    this.timeout(120_000);
    // Retry at least once, because ipywidgets can be flaky (network, comms, etc).
    this.retries(1);
    let editor: NotebookEditor;
    suiteSetup(async function () {
        if (!IS_REMOTE_NATIVE_TEST()) {
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
    // eslint-disable-next-line no-only-tests/no-only-tests
    test.only('Resume Cell Execution', async function () {
        console.error('Step1');
        await closeNotebooks([]);
        console.error('Step2');
        const nbFile = Uri.joinPath(workspace.workspaceFolders![0].uri, 'notebook', 'resumeExecution.ipynb');
        fs
        let editor = await workspace.openNotebookDocument(nbFile).then((nb) => window.showNotebookDocument(nb));
        console.error('Step3');
        const cell = editor.notebook.cellAt(0)!;
        await selectDefaultController(editor);
        console.error('Step4');
        runCell(cell).then(noop, noop);
        console.error('Step5');
        await waitForTextOutput(cell, 'Started Execution', 0, false);
        await waitForTextOutput(cell, 'Number:', undefined, false);
        await sleep(2_000); // Wait for additional output
        console.error('Step10');
        console.error('Step6');
        await saveActiveNotebook();
        console.error('Step7');
        await closeActiveWindows();
        await sleep(5_000); // Some issues with the tests, possible not enough time for kernel to die
        await closeActiveWindows();
        console.error('Step8');
        await sleep(5_000); // Some issues with the tests, possible not enough time for kernel to die
        // Open the above notebook and see what the last output is.
        const buffer = await workspace.fs.readFile(nbFile);
        console.error('Step9');
        const contents = JSON.parse(Buffer.from(buffer).toString().trim());
        const lastCellOutputLines = contents.cells[0].outputs[0].text as string[];
        const lastNumber = parseInt(
            lastCellOutputLines[lastCellOutputLines.length - 1].trim().replace('Number:', '').trim(),
            10
        );
        // await window.showErrorMessage(`Last Number is ${lastNumber}`).then(noop, noop);
        console.error('Step11');

        // Ok, now open the same document once again and execution should resume.
        editor = await workspace.openNotebookDocument(nbFile).then((nb) => window.showNotebookDocument(nb));
        console.error('Step12');
        await waitForCondition(
            () => {
                const outputNumbers = Buffer.from(
                    editor.notebook.cellAt(0).outputs.slice(-1)[0].items.slice(-1)[0].data
                )
                    .toString()
                    .trim()
                    .split(/\r?\n/)
                    .map((l) => l.trim())
                    .filter((l) => l.length);
                console.error('Step13', outputNumbers);
                const newLastNumber = parseInt(outputNumbers.slice(-1)[0].replace('Number:', '').trim(), 10);
                return newLastNumber > lastNumber;
            },
            defaultNotebookTestTimeout,
            'Execution did not resume'
        );
    });
});
