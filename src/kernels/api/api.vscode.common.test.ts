// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import {
    CancellationTokenSource,
    NotebookCellData,
    NotebookCellKind,
    NotebookCellOutputItem,
    NotebookEdit,
    NotebookEditor,
    NotebookRange,
    workspace,
    WorkspaceEdit
} from 'vscode';
import { traceInfo } from '../../platform/logging';
import { IDisposable } from '../../platform/common/types';
import {
    captureScreenShot,
    createEventHandler,
    initialize,
    startJupyterServer,
    testMandatory,
    waitForCondition
} from '../../test/common';
import { IS_REMOTE_NATIVE_TEST } from '../../test/constants';
import {
    closeNotebooksAndCleanUpAfterTests,
    createEmptyNotebook,
    runCell,
    selectDefaultController,
    waitForExecutionCompletedSuccessfully
} from '../../test/datascience/notebook/helper';
import { getKernelsApi } from './api';
import { raceTimeoutError } from '../../platform/common/utils/async';
import { ExecutionResult } from '../../api';
import { dispose } from '../../platform/common/utils/lifecycle';

suite('Remote Tests @mandatory @nonPython', function () {
    const disposables: IDisposable[] = [];
    this.timeout(120_000);
    // Retry at least once, because ipywidgets can be flaky (network, comms, etc).
    this.retries(1);
    let editor: NotebookEditor;
    suiteSetup(async function () {
        this.timeout(120_000);
        await initialize();
        if (IS_REMOTE_NATIVE_TEST()) {
            await startJupyterServer();
        }
        editor = (
            await createEmptyNotebook(disposables, undefined, { display_name: 'Deno', name: 'deno' }, 'typescript')
        ).editor;
        await selectDefaultController(editor, 120_000, 'typescript');
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
    testMandatory('Get Kernel and execute code', async function () {
        const nbEdit = NotebookEdit.replaceCells(new NotebookRange(0, editor.notebook.cellCount), [
            new NotebookCellData(NotebookCellKind.Code, 'console.log(1234)', 'typescript')
        ]);
        const edit = new WorkspaceEdit();
        edit.set(editor.notebook.uri, [nbEdit]);
        await workspace.applyEdit(edit);

        const cell = editor.notebook.cellAt(0)!;
        await Promise.all([runCell(cell), waitForExecutionCompletedSuccessfully(cell)]);

        const kernel = getKernelsApi().findKernel({ uri: editor.notebook.uri });
        if (!kernel) {
            throw new Error('Kernel not found');
        }
        const statusChange = createEventHandler(kernel, 'onDidChangeStatus', disposables);

        // Verify we can execute code using the kernel.
        const expectedMime = NotebookCellOutputItem.stdout('').mime;
        const token = new CancellationTokenSource();
        await waitForOutput(kernel.executeCode('console.log(1234)', token.token), '1234', expectedMime);
        // Wait for kernel to be idle.
        await waitForCondition(
            () => kernel.status === 'idle',
            5_000,
            `Kernel did not become idle, current status is ${kernel.status}`
        );

        // Verify state transition.
        assert.deepEqual(statusChange.all, ['busy', 'idle'], 'State transition is incorrect');

        // Verify we can execute code using the kernel in parallel.
        await Promise.all([
            waitForOutput(kernel.executeCode('console.log(1)', token.token), '1', expectedMime),
            waitForOutput(kernel.executeCode('console.log(2)', token.token), '2', expectedMime),
            waitForOutput(kernel.executeCode('console.log(3)', token.token), '3', expectedMime)
        ]);

        // Wait for kernel to be idle.
        await waitForCondition(
            () => kernel.status === 'idle',
            5_000,
            `Kernel did not become idle, current status is ${kernel.status}`
        );
    });
    async function waitForOutput(executionResult: ExecutionResult, expectedOutput: string, expectedMimetype: string) {
        const disposables: IDisposable[] = [];
        const outputPromise = new Promise<void>((resolve, reject) => {
            executionResult.onDidEmitOutput(
                (e) => {
                    e.forEach((item) => {
                        if (item.mime === expectedMimetype) {
                            const output = new TextDecoder().decode(item.data).trim();
                            if (output === expectedOutput) {
                                resolve();
                            } else {
                                reject(new Error(`Unexpected output ${output}`));
                            }
                        } else {
                            reject(new Error(`Unexpected output ${item.mime}`));
                        }
                    });
                },
                undefined,
                disposables
            );
        });

        await raceTimeoutError(30_000, new Error('Timed out waiting for output'), outputPromise).finally(() =>
            dispose(disposables)
        );
    }
});
