// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as sinon from 'sinon';
import * as path from 'path';
import { commands, Uri } from 'vscode';
import { IVSCodeNotebook } from '../../../client/common/application/types';
import { traceInfo } from '../../../client/common/logger';
import { IDisposable } from '../../../client/common/types';
import { IExtensionTestApi, waitForCondition } from '../../common';
import { closeActiveWindows, EXTENSION_ROOT_DIR_FOR_TESTS, initialize, IS_REMOTE_NATIVE_TEST } from '../../initialize';
import {
    assertHasTextOutputInVSCode,
    canRunNotebookTests,
    closeNotebooksAndCleanUpAfterTests,
    executeActiveDocument,
    trustAllNotebooks,
    startJupyterServer,
    waitForExecutionCompletedSuccessfully,
    waitForKernelToGetAutoSelected,
    stopJupyterServer,
    createTemporaryNotebook,
    saveActiveNotebook,
    executeCell
} from './helper';
import { openNotebook } from '../helpers';
import { PYTHON_LANGUAGE } from '../../../client/common/constants';
import { PreferredRemoteKernelIdProvider } from '../../../client/datascience/notebookStorage/preferredRemoteKernelIdProvider';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataScience - VSCode Notebook - (Remote) (Execution) (slow)xxx', function () {
    this.timeout(920_000);
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
    let remoteKernelIdProvider: PreferredRemoteKernelIdProvider;
    const templatePythonNb = path.join(
        EXTENSION_ROOT_DIR_FOR_TESTS,
        'src',
        'test',
        'datascience',
        'notebook',
        'rememberRemoteKernel.ipynb'
    );
    let ipynbFile: Uri;
    suiteSetup(async function () {
        if (!IS_REMOTE_NATIVE_TEST) {
            return this.skip();
        }
        this.timeout(120_000);
        api = await initialize();
        if (!(await canRunNotebookTests())) {
            return this.skip();
        }
        await trustAllNotebooks();
        await startJupyterServer();
        // await prewarmNotebooks();
        sinon.restore();
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        remoteKernelIdProvider = api.serviceContainer.get<PreferredRemoteKernelIdProvider>(
            PreferredRemoteKernelIdProvider
        );
    });
    // Use same notebook without starting kernel in every single test (use one for whole suite).
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        sinon.restore();
        await startJupyterServer();
        // Don't use same file for this test (files get modified in tests and we might save stuff)
        ipynbFile = Uri.file(await createTemporaryNotebook(templatePythonNb, disposables));
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        // Added temporarily to identify why tests are failing.
        process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT = undefined;
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(async () => {
        await closeNotebooksAndCleanUpAfterTests(disposables);
        await stopJupyterServer();
    });
    test('Use same kernel when re-opening notebook', async () => {
        await openNotebook(api.serviceContainer, ipynbFile.fsPath, { isNotTrusted: true });
        await waitForKernelToGetAutoSelected(PYTHON_LANGUAGE);
        let nbEditor = vscodeNotebook.activeNotebookEditor!;
        assert.isOk(nbEditor, 'No active notebook');
        // await sleep(60_000);
        // Cell 1 = `a = "Hello World"`
        // Cell 2 = `print(a)`
        await executeActiveDocument();

        let cell2 = nbEditor.document.cells![1]!;
        await waitForExecutionCompletedSuccessfully(cell2);
        assertHasTextOutputInVSCode(cell2, 'Hello World', 0);

        // Confirm kernel id gets saved for this notebook.
        // This is not necessary, but this guarantees a faster & non-flaky test to ensure we don't close the notebook too early.
        // If we nb it as soon as output appears, its possible the kernel id hasn't been saved yet & we mess that up.
        // Optionally we could wait for 100ms.
        await waitForCondition(
            async () => !!remoteKernelIdProvider.getPreferredRemoteKernelId(nbEditor.document.uri),
            5_000,
            'Remote Kernel id not saved'
        );

        await saveActiveNotebook(disposables);
        // await sleep(60_000);
        await closeActiveWindows();

        // Re-open and execute the second cell.
        // It should connect to the same live kernel
        // Second cell should display the value of existing variable from previous execution.

        await openNotebook(api.serviceContainer, ipynbFile.fsPath, { isNotTrusted: true });
        // await sleep(60_000);
        await waitForKernelToGetAutoSelected(PYTHON_LANGUAGE);
        // await sleep(60_000);
        nbEditor = vscodeNotebook.activeNotebookEditor!;
        assert.isOk(nbEditor, 'No active notebook');

        await commands.executeCommand('notebook.clearAllCellsOutputs');

        // Wait till output is empty for both cells
        await waitForCondition(
            async () => !nbEditor.document.cells.some((cell) => cell.outputs.length > 0),
            5_000,
            'Cell output not cleared'
        );

        // Execute second cell
        cell2 = nbEditor.document.cells![1]!;
        await executeCell(cell2);
        await waitForExecutionCompletedSuccessfully(cell2);
        assertHasTextOutputInVSCode(cell2, 'Hello World', 0);
    });
});
