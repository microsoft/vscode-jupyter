// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as sinon from 'sinon';
import { commands, Memento, NotebookDocument, Uri, window } from 'vscode';
import { IEncryptedStorage, IVSCodeNotebook } from '../../../platform/common/application/types';
import { traceInfo } from '../../../platform/logging';
import { GLOBAL_MEMENTO, IDisposable, IMemento } from '../../../platform/common/types';
import { IExtensionTestApi, waitForCondition } from '../../common';
import { closeActiveWindows, initialize } from '../../initialize';
import {
    runAllCellsInActiveNotebook,
    waitForExecutionCompletedSuccessfully,
    waitForKernelToGetAutoSelected,
    saveActiveNotebook,
    runCell,
    deleteAllCellsAndWait,
    insertCodeCell,
    waitForTextOutput,
    closeNotebooksAndCleanUpAfterTests,
    createTemporaryNotebook,
    createEmptyPythonNotebook
} from './helper';
import { openNotebook } from '../helpers';
import { PYTHON_LANGUAGE, Settings } from '../../../platform/common/constants';
import { IS_REMOTE_NATIVE_TEST, JVSC_EXTENSION_ID_FOR_TESTS } from '../../constants';
import { PreferredRemoteKernelIdProvider } from '../../../kernels/raw/finder/preferredRemoteKernelIdProvider';
import { INotebookControllerManager } from '../../../notebooks/types';
import { IServiceContainer } from '../../../platform/ioc/types';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
export function sharedRemoteNotebookEditorTests(
    suite: Mocha.Suite,
    startJupyterServer: (notebook?: NotebookDocument) => Promise<void>,
    finishSuiteSetup: (serviceContainer: IServiceContainer) => void,
    finishTestSetup: () => Promise<void>,
    handleTestTeardown: (context: Mocha.Context) => Promise<void>
) {
    suite.timeout(120_000);
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
    let ipynbFile: Uri;
    let serviceContainer: IServiceContainer;
    let globalMemento: Memento;
    let encryptedStorage: IEncryptedStorage;
    let controllerManager: INotebookControllerManager;

    suiteSetup(async function () {
        if (!IS_REMOTE_NATIVE_TEST()) {
            return this.skip();
        }
        this.timeout(120_000);
        api = await initialize();
        await startJupyterServer();
        sinon.restore();
        serviceContainer = api.serviceContainer;
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        encryptedStorage = api.serviceContainer.get<IEncryptedStorage>(IEncryptedStorage);
        globalMemento = api.serviceContainer.get<Memento>(IMemento, GLOBAL_MEMENTO);
        controllerManager = api.serviceContainer.get<INotebookControllerManager>(
            INotebookControllerManager,
            INotebookControllerManager
        );
        finishSuiteSetup(api.serviceContainer);
    });
    // Use same notebook without starting kernel in every single test (use one for whole suite).
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        sinon.restore();
        if (!this.currentTest?.title.includes('preferred')) {
            await startJupyterServer();
        }
        // Don't use same file for this test (files get modified in tests and we might save stuff)
        ipynbFile = await createTemporaryNotebook(
            [
                {
                    cell_type: 'code',
                    source: ['a = "Hello World"\n'],
                    outputs: [],
                    execution_count: 0,
                    metadata: {}
                },
                {
                    cell_type: 'code',
                    source: ['print(a)\n'],
                    outputs: [],
                    execution_count: 0,
                    metadata: {}
                }
            ],
            disposables
        );
        await finishTestSetup();
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        await handleTestTeardown(this);
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));
    test('MRU and encrypted storage should be updated with remote Uri info', async function () {
        // Entered issue here - test failing: https://github.com/microsoft/vscode-jupyter/issues/7579
        this.skip();
        const previousList = globalMemento.get<{}[]>(Settings.JupyterServerUriList, []);
        const encryptedStorageSpiedStore = sinon.spy(encryptedStorage, 'store');
        await openNotebook(ipynbFile);
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
        await reopeningNotebookUsesSameRemoteKernel(ipynbFile, serviceContainer);
    });

    test('Can run against a remote kernelspec', async function () {
        await controllerManager.loadNotebookControllers();
        const controllers = controllerManager.getRegisteredNotebookControllers();

        // Verify we have a remote kernel spec.
        assert.ok(
            controllers.some((item) => item.connection.kind === 'startUsingRemoteKernelSpec'),
            'Should have at least one remote controller'
        );

        // Don't wait for the kernel since we will select our own
        await createEmptyPythonNotebook(disposables, undefined, true);

        // Find the default remote Python kernel (we know that will have ipykernel, as we've set up CI as such).
        const defaultPythonKernel = await controllerManager.getActiveInterpreterOrDefaultController(
            'jupyter-notebook',
            undefined
        );
        assert.ok(defaultPythonKernel, 'No default remote kernel');

        assert.strictEqual(
            defaultPythonKernel?.connection.kind,
            'startUsingRemoteKernelSpec',
            'Not a remote kernelspec'
        );
        await commands.executeCommand('notebook.selectKernel', {
            id: defaultPythonKernel!.controller.id,
            extension: JVSC_EXTENSION_ID_FOR_TESTS
        });

        await insertCodeCell('print("123412341234")', { index: 0 });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;
        await Promise.all([runCell(cell), waitForTextOutput(cell, '123412341234')]);
    });

    return disposables;
}

export async function reopeningNotebookUsesSameRemoteKernel(
    ipynbFile: Uri,
    serviceContainer: IServiceContainer,
    doNotSaveAndCloseNotebook = false
) {
    const remoteKernelIdProvider = serviceContainer.get<PreferredRemoteKernelIdProvider>(
        PreferredRemoteKernelIdProvider
    );

    await openNotebook(ipynbFile);
    await waitForKernelToGetAutoSelected(PYTHON_LANGUAGE, true);
    let nbEditor = window.activeNotebookEditor!;
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

    if (doNotSaveAndCloseNotebook) {
        return;
    }

    await saveActiveNotebook();
    await closeActiveWindows();

    // Re-open and execute the second cell.
    // It should connect to the same live kernel. Don't force it to pick it.
    // Second cell should display the value of existing variable from previous execution.

    await openNotebook(ipynbFile);
    await waitForKernelToGetAutoSelected(PYTHON_LANGUAGE, true, 100_000, true);
    nbEditor = window.activeNotebookEditor!;
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
}
