// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as sinon from 'sinon';
import * as path from 'path';
import { commands, Memento, Uri } from 'vscode';
import { IEncryptedStorage, IVSCodeNotebook } from '../../../client/common/application/types';
import { traceInfo, traceInfoIfCI } from '../../../client/common/logger';
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
    waitForTextOutput,
    defaultNotebookTestTimeout,
    createEmptyPythonNotebook
} from './helper';
import { openNotebook } from '../helpers';
import { PYTHON_LANGUAGE } from '../../../client/common/constants';
import { PreferredRemoteKernelIdProvider } from '../../../client/datascience/notebookStorage/preferredRemoteKernelIdProvider';
import { Settings } from '../../../client/datascience/constants';
import { INotebookControllerManager } from '../../../client/datascience/notebook/types';
import { JupyterServerSelector } from '../../../client/datascience/jupyter/serverSelector';
import { RemoteKernelSpecConnectionMetadata } from '../../../client/datascience/jupyter/kernels/types';
import { JupyterServer } from '../jupyterServer';
import { JVSC_EXTENSION_ID_FOR_TESTS } from '../../constants';

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
    let controllerManager: INotebookControllerManager;
    let jupyterServerSelector: JupyterServerSelector;

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
        jupyterServerSelector = api.serviceContainer.get<JupyterServerSelector>(JupyterServerSelector);
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        encryptedStorage = api.serviceContainer.get<IEncryptedStorage>(IEncryptedStorage);
        globalMemento = api.serviceContainer.get<Memento>(IMemento, GLOBAL_MEMENTO);
        controllerManager = api.serviceContainer.get<INotebookControllerManager>(
            INotebookControllerManager,
            INotebookControllerManager
        );
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
    test('Local and Remote kernels are listed', async function () {
        await controllerManager.loadNotebookControllers();
        const controllers = controllerManager.registeredNotebookControllers();
        assert.ok(
            controllers.some((item) => item.connection.kind === 'startUsingRemoteKernelSpec'),
            'Should have at least one remote kernelspec'
        );
        assert.ok(
            controllers.some(
                (item) =>
                    item.connection.kind === 'startUsingLocalKernelSpec' ||
                    item.connection.kind === 'startUsingPythonInterpreter'
            ),
            'Should have at least one local kernel'
        );
    });
    test('Remote kernels are removed when switching to local', async function () {
        await controllerManager.loadNotebookControllers();
        assert.ok(async () => {
            const controllers = controllerManager.registeredNotebookControllers();
            return controllers.filter((item) => item.connection.kind === 'startUsingRemoteKernelSpec').length === 0;
        }, 'Should have at least one remote kernelspec');

        // After resetting connection to local only, then remove all remote connections.
        await jupyterServerSelector.setJupyterURIToLocal();
        traceInfoIfCI('Waiting for remote kernels to be removed');

        await waitForCondition(
            async () => {
                const controllers = controllerManager.registeredNotebookControllers();
                return controllers.filter((item) => item.connection.kind === 'startUsingRemoteKernelSpec').length === 0;
            },
            defaultNotebookTestTimeout,
            () =>
                `Should not have any remote controllers, existing ${JSON.stringify(
                    controllerManager.registeredNotebookControllers()
                )}`
        );
    });

    test('Old Remote kernels are removed when switching to new Remote Server', async function () {
        await controllerManager.loadNotebookControllers();

        // Opening a notebook will trigger the refresh of the kernel list.
        let nbUri = Uri.file(await createTemporaryNotebook(templatePythonNb, disposables));
        await openNotebook(nbUri.fsPath);

        const baseUrls = new Set<string>();
        // Wait til we get new controllers with a different base url.
        await waitForCondition(
            async () => {
                const controllers = controllerManager.registeredNotebookControllers();
                const remoteKernelSpecs = controllers
                    .filter((item) => item.connection.kind === 'startUsingRemoteKernelSpec')
                    .map((item) => item.connection as RemoteKernelSpecConnectionMetadata);
                remoteKernelSpecs.forEach((item) => baseUrls.add(item.baseUrl));
                return remoteKernelSpecs.length > 0;
            },
            defaultNotebookTestTimeout,
            () =>
                `Should have at least one remote kernelspec, ${JSON.stringify(
                    controllerManager.registeredNotebookControllers()
                )}`
        );

        traceInfoIfCI(`Base Url is ${Array.from(baseUrls).join(', ')}`);

        // Start another jupyter server with a new port.
        const uri = await JupyterServer.instance.startSecondJupyterWithToken();
        const uriString = decodeURIComponent(uri.toString());
        traceInfo(`Another Jupyter started and listening at ${uriString}`);
        await jupyterServerSelector.setJupyterURIToLocal();
        await jupyterServerSelector.setJupyterURIToRemote(uriString);

        // Opening a notebook will trigger the refresh of the kernel list.
        nbUri = Uri.file(await createTemporaryNotebook(templatePythonNb, disposables));
        await openNotebook(nbUri.fsPath);
        traceInfo(`Waiting for kernels to get refreshed for Jupyter Remotenp ${uriString}`);

        // Wait til we get new controllers with a different base url.
        await waitForCondition(
            async () => {
                const controllers = controllerManager.registeredNotebookControllers();
                return controllers.some(
                    (item) =>
                        item.connection.kind === 'startUsingRemoteKernelSpec' && !baseUrls.has(item.connection.baseUrl)
                );
            },
            defaultNotebookTestTimeout,
            () =>
                `Should have at least one remote kernelspec with different baseUrls, ${JSON.stringify(
                    controllerManager.registeredNotebookControllers()
                )}`
        );
    });

    test('Local Kernel state is not lost when connecting to remote', async function () {
        await controllerManager.loadNotebookControllers();

        // After resetting connection to local only, verify all remote connections are no longer available.
        await jupyterServerSelector.setJupyterURIToLocal();
        await waitForCondition(
            async () => {
                const controllers = controllerManager.registeredNotebookControllers();
                return controllers.filter((item) => item.connection.kind === 'startUsingRemoteKernelSpec').length === 0;
            },
            defaultNotebookTestTimeout,
            'Should not have any remote controllers'
        );

        await createEmptyPythonNotebook(disposables);
        await insertCodeCell('a = "123412341234"', { index: 0 });
        await insertCodeCell('print(a)', { index: 1 });
        const cell1 = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;
        const cell2 = vscodeNotebook.activeNotebookEditor?.document.cellAt(1)!;
        await runCell(cell1);

        // Now that we don't have any remote kernels, connect to a remote jupyter server.
        await startJupyterServer();

        // Verify we have a remote kernel spec.
        await waitForCondition(
            async () => {
                const controllers = controllerManager.registeredNotebookControllers();
                return controllers.some((item) => item.connection.kind === 'startUsingRemoteKernelSpec');
            },
            defaultNotebookTestTimeout,
            'Should have at least one remote controller'
        );

        // Run the second cell and verify we still have the same kernel state.
        await Promise.all([runCell(cell2), waitForTextOutput(cell2, '123412341234')]);
    });

    test('Can run against a remote kernelspec', async function () {
        await controllerManager.loadNotebookControllers();
        const controllers = controllerManager.registeredNotebookControllers();

        // Verify we have a remote kernel spec.
        assert.ok(
            controllers.some((item) => item.connection.kind === 'startUsingRemoteKernelSpec'),
            'Should have at least one remote controller'
        );

        await createEmptyPythonNotebook(disposables);

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

    test('Remote kernels support intellisense', async function () {
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

        // Wait for tokens on the second cell (it works with just plain pylance)
        await waitForCondition(
            async () => {
                const promise = commands.executeCommand('vscode.provideDocumentSemanticTokens', cell2.document.uri);
                const result = (await promise) as any;
                return result && result.data.length > 0;
            },
            defaultNotebookTestTimeout,
            `Tokens never appear for first cell`,
            100,
            true
        );
    });
});
