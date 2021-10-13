// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as sinon from 'sinon';
import * as path from 'path';
import { commands, Memento, Uri } from 'vscode';
import { IEncryptedStorage, IVSCodeNotebook } from '../../../client/common/application/types';
import { traceInfo } from '../../../client/common/logger';
import { GLOBAL_MEMENTO, IDisposable, IMemento } from '../../../client/common/types';
import { IExtensionTestApi, waitForCondition } from '../../common';
import { closeActiveWindows, EXTENSION_ROOT_DIR_FOR_TESTS, initialize, IS_REMOTE_NATIVE_TEST } from '../../initialize';
import {
    canRunNotebookTests,
    closeNotebooksAndCleanUpAfterTests,
    runAllCellsInActiveNotebook,
    startJupyterServer,
    waitForExecutionCompletedSuccessfully,
    waitForKernelToGetAutoSelected,
    createTemporaryNotebook,
    saveActiveNotebook,
    runCell,
    deleteAllCellsAndWait,
    insertCodeCell,
    waitForTextOutput
} from './helper';
import { openNotebook } from '../helpers';
import { PYTHON_LANGUAGE } from '../../../client/common/constants';
import { PreferredRemoteKernelIdProvider } from '../../../client/datascience/notebookStorage/preferredRemoteKernelIdProvider';
import { Settings } from '../../../client/datascience/constants';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataScience - VSCode Notebook - (Remote) (Execution) (slow)', function () {
    this.timeout(120_000);
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
    let globalMemento: Memento;
    let encryptedStorage: IEncryptedStorage;
    suiteSetup(async function () {
        if (!IS_REMOTE_NATIVE_TEST) {
            return this.skip();
        }
        this.timeout(120_000);
        api = await initialize();
        if (!(await canRunNotebookTests())) {
            return this.skip();
        }
        await startJupyterServer();
        sinon.restore();
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        encryptedStorage = api.serviceContainer.get<IEncryptedStorage>(IEncryptedStorage);
        globalMemento = api.serviceContainer.get<Memento>(IMemento, GLOBAL_MEMENTO);
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
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));
    test('MRU and encrypted storage should be updated with remote Uri info', async function () {
        // Entered issue here - test failing: https://github.com/microsoft/vscode-jupyter/issues/7579
        this.skip();
        const previousList = globalMemento.get<{}[]>(Settings.JupyterServerUriList, []);
        const encryptedStorageSpiedStore = sinon.spy(encryptedStorage, 'store');
        await openNotebook(ipynbFile.fsPath);
        await waitForKernelToGetAutoSelected(PYTHON_LANGUAGE);
        await deleteAllCellsAndWait();
        await insertCodeCell('print("123412341234")', { index: 0 });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;
        await Promise.all([runAllCellsInActiveNotebook(), waitForExecutionCompletedSuccessfully(cell)]);

        // Wait for MRU to get updated & encrypted storage to get updated.
        await waitForCondition(async () => encryptedStorageSpiedStore.called, 5_000, 'Encrypted storage not updated');
        const newList = globalMemento.get<{}[]>(Settings.JupyterServerUriList, []);
        assert.notDeepEqual(previousList, newList, 'MRU not updated');
    });
    test('Use same kernel when re-opening notebook', async function () {
        // This isn't actually working. Preferred kernel is set to the old kernel but VS code remembers
        // the notebook and doesn't use the preferred kernel. We'd have to update the 'id' from last time to
        // point to this one
        // https://github.com/microsoft/vscode-jupyter/issues/7610
        this.skip();
        await openNotebook(ipynbFile.fsPath);
        await waitForKernelToGetAutoSelected(PYTHON_LANGUAGE);
        let nbEditor = vscodeNotebook.activeNotebookEditor!;
        assert.isOk(nbEditor, 'No active notebook');
        // Cell 1 = `a = "Hello World"`
        // Cell 2 = `print(a)`
        let cell2 = nbEditor.document.getCells()![1]!;
        await Promise.all([
            runAllCellsInActiveNotebook(),
            waitForExecutionCompletedSuccessfully(cell2),
            waitForTextOutput(cell2, 'Hello World', 0, false)
        ]);

        // Confirm kernel id gets saved for this notebook.
        // This is not necessary, but this guarantees a faster & non-flaky test to ensure we don't close the notebook too early.
        // If we nb it as soon as output appears, its possible the kernel id hasn't been saved yet & we mess that up.
        // Optionally we could wait for 100ms.
        await waitForCondition(
            async () => !!remoteKernelIdProvider.getPreferredRemoteKernelId(nbEditor.document.uri),
            5_000,
            'Remote Kernel id not saved'
        );

        await saveActiveNotebook();
        await closeActiveWindows();

        // Re-open and execute the second cell.
        // It should connect to the same live kernel
        // Second cell should display the value of existing variable from previous execution.

        await openNotebook(ipynbFile.fsPath);
        await waitForKernelToGetAutoSelected(PYTHON_LANGUAGE);
        nbEditor = vscodeNotebook.activeNotebookEditor!;
        assert.isOk(nbEditor, 'No active notebook');

        await commands.executeCommand('notebook.clearAllCellsOutputs');

        // Wait till output is empty for both cells
        await waitForCondition(
            async () => !nbEditor.document.getCells().some((cell) => cell.outputs.length > 0),
            5_000,
            'Cell output not cleared'
        );

        // Execute second cell (same kernel so should be able to get results)
        cell2 = nbEditor.document.getCells()![1]!;
        await Promise.all([
            runCell(cell2),
            waitForExecutionCompletedSuccessfully(cell2),
            waitForTextOutput(cell2, 'Hello World', 0, false)
        ]);
    });
});
