// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { assert } from 'chai';
import * as sinon from 'sinon';
import { commands, Uri, workspace } from 'vscode';
import { JupyterServerSelector } from '../../../kernels/jupyter/serverSelector';
import { PreferredRemoteKernelIdProvider } from '../../../kernels/jupyter/preferredRemoteKernelIdProvider';
import { isLocalConnection, RemoteKernelSpecConnectionMetadata } from '../../../kernels/types';
import { IVSCodeNotebook } from '../../../platform/common/application/types';
import { DataScience } from '../../../platform/common/utils/localize';
import { JVSC_EXTENSION_ID, PYTHON_LANGUAGE } from '../../../platform/common/constants';
import { traceInfoIfCI, traceInfo } from '../../../platform/logging';
import { captureScreenShot, IExtensionTestApi, initialize, waitForCondition } from '../../common';
import { openNotebook } from '../helpers';
import { JupyterServer } from '../jupyterServer.node';
import { closeNotebooksAndCleanUpAfterTests, hijackPrompt } from './helper';
import {
    createEmptyPythonNotebook,
    createTemporaryNotebook,
    defaultNotebookTestTimeout,
    insertCodeCell,
    runAllCellsInActiveNotebook,
    runCell,
    startJupyterServer,
    waitForExecutionCompletedSuccessfully,
    waitForKernelToGetAutoSelected,
    waitForTextOutput
} from './helper.node';
import { IServiceContainer } from '../../../platform/ioc/types';
import { IDisposable } from '../../../platform/common/types';
import { IS_REMOTE_NATIVE_TEST } from '../../constants';
import { runCellAndVerifyUpdateOfPreferredRemoteKernelId } from './remoteNotebookEditor.vscode.common.test';
import { IControllerLoader, IControllerRegistration } from '../../../notebooks/controllers/types';
import { IInterpreterService } from '../../../platform/interpreter/contracts';

suite('Remote Kernel Execution', function () {
    let controllerLoader: IControllerLoader;
    let controllerRegistration: IControllerRegistration;
    let jupyterServerSelector: JupyterServerSelector;
    let vscodeNotebook: IVSCodeNotebook;
    let ipynbFile: Uri;
    let remoteKernelIdProvider: PreferredRemoteKernelIdProvider;
    let svcContainer: IServiceContainer;
    let interpreterService: IInterpreterService;

    this.timeout(120_000);
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];

    suiteSetup(async function () {
        if (!IS_REMOTE_NATIVE_TEST()) {
            return this.skip();
        }
        this.timeout(120_000);
        api = await initialize();
        await startJupyterServer();
        sinon.restore();
        const serviceContainer = api.serviceContainer;
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        controllerLoader = api.serviceContainer.get<IControllerLoader>(IControllerLoader);
        controllerRegistration = api.serviceContainer.get<IControllerRegistration>(IControllerRegistration);
        jupyterServerSelector = serviceContainer.get<JupyterServerSelector>(JupyterServerSelector);
        vscodeNotebook = serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        remoteKernelIdProvider = serviceContainer.get<PreferredRemoteKernelIdProvider>(PreferredRemoteKernelIdProvider);
        svcContainer = serviceContainer;
        interpreterService = await api.serviceContainer.get<IInterpreterService>(IInterpreterService);
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
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this);
        }
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));

    // This test needs to run in node only as we have to start another jupyter server
    test('Old Remote kernels are removed when switching to new Remote Server @kernelPicker', async function () {
        // Opening a notebook will trigger the refresh of the kernel list.
        let nbUri = await createTemporaryNotebook([], disposables);
        await openNotebook(nbUri);

        const baseUrls = new Set<string>();
        // Wait til we get new controllers with a different base url.
        await waitForCondition(
            async () => {
                const controllers = controllerRegistration.registered;
                const remoteKernelSpecs = controllers
                    .filter((item) => item.connection.kind === 'startUsingRemoteKernelSpec')
                    .map((item) => item.connection as RemoteKernelSpecConnectionMetadata);
                remoteKernelSpecs.forEach((item) => baseUrls.add(item.baseUrl));
                return remoteKernelSpecs.length > 0;
            },
            defaultNotebookTestTimeout,
            () => `Should have at least one remote kernelspec, ${JSON.stringify(controllerRegistration.registered)}`
        );

        traceInfoIfCI(`Base Url is ${Array.from(baseUrls).join(', ')}`);

        // Start another jupyter server with a new port.
        const uri = await JupyterServer.instance.startSecondJupyterWithToken();
        const uriString = decodeURIComponent(uri.toString());
        traceInfo(`Another Jupyter started and listening at ${uriString}`);
        await jupyterServerSelector.setJupyterURIToLocal();
        await jupyterServerSelector.setJupyterURIToRemote(uriString);

        // Opening a notebook will trigger the refresh of the kernel list.
        nbUri = await createTemporaryNotebook([], disposables);
        await openNotebook(nbUri);
        traceInfo(`Waiting for kernels to get refreshed for Jupyter Remotenp ${uriString}`);

        // Wait til we get new controllers with a different base url.
        await waitForCondition(
            async () => {
                const controllers = controllerRegistration.registered;
                return controllers.some(
                    (item) =>
                        item.connection.kind === 'startUsingRemoteKernelSpec' && !baseUrls.has(item.connection.baseUrl)
                );
            },
            defaultNotebookTestTimeout,
            () =>
                `Should have at least one remote kernelspec with different baseUrls, ${JSON.stringify(
                    controllerRegistration.registered.map((item) => item.connection.kind)
                )}`
        );
    });
    test('Local Kernel state is not lost when connecting to remote @kernelPicker', async function () {
        // After resetting connection to local only, verify all remote connections are no longer available.
        await jupyterServerSelector.setJupyterURIToLocal();

        const activeInterpreter = await interpreterService.getActiveInterpreter();
        traceInfoIfCI(`active interpreter ${activeInterpreter?.uri.path}`);
        const { notebook } = await createEmptyPythonNotebook(disposables);
        const controllerManager = svcContainer.get<IControllerRegistration>(IControllerRegistration);
        const preferredController = controllerManager.getSelected(notebook);
        traceInfoIfCI(`preferred controller ${preferredController?.connection.id}`);

        await insertCodeCell('a = "123412341234"', { index: 0 });
        await insertCodeCell('print(a)', { index: 1 });
        const cell1 = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;
        const cell2 = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(1)!;
        await runCell(cell1);

        // Now connect to a remote jupyter server.
        await startJupyterServer();

        // Verify we have a remote kernel spec.
        await waitForCondition(
            async () => {
                const controllers = controllerRegistration.registered;
                traceInfoIfCI(`Check ${controllers.length} registered controllers`);
                traceInfoIfCI(
                    `list controllers ${controllers.length}: ${controllers
                        .map((i) => `${i.connection.id}, ${i.connection.kind}`)
                        .join('\n')}`
                );
                return controllers.some((item) => item.connection.kind === 'startUsingRemoteKernelSpec');
            },
            defaultNotebookTestTimeout,
            'Should have at least one remote controller'
        );

        const newPreferredController = controllerManager.getSelected(notebook);
        traceInfoIfCI(`new preferred controller ${newPreferredController?.connection.id}`);

        // Run the second cell and verify we still have the same kernel state.
        await Promise.all([runCell(cell2), waitForTextOutput(cell2, '123412341234')]);
    });

    test('Remote kernels support intellisense @lsp', async function () {
        const { editor } = await openNotebook(ipynbFile);
        await waitForKernelToGetAutoSelected(editor, PYTHON_LANGUAGE);
        let nbEditor = vscodeNotebook.activeNotebookEditor!;
        assert.isOk(nbEditor, 'No active notebook');
        // Cell 1 = `a = "Hello World"`
        // Cell 2 = `print(a)`
        let cell2 = nbEditor.notebook.getCells()![1]!;
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

    test('Remote kernels work with https @kernelCore', async function () {
        // Note, this test won't work in web yet.
        const config = workspace.getConfiguration('jupyter');
        await config.update('allowUnauthorizedRemoteConnection', false);
        const prompt = await hijackPrompt(
            'showErrorMessage',
            { contains: 'certificate' },
            { result: DataScience.jupyterSelfCertEnable(), clickImmediately: true }
        );
        await startJupyterServer(undefined, true);

        await waitForCondition(
            async () => {
                const controllers = controllerRegistration.registered;
                return controllers.some((item) => item.connection.kind === 'startUsingRemoteKernelSpec');
            },
            defaultNotebookTestTimeout,
            'Should have at least one remote controller'
        );

        const { editor } = await openNotebook(ipynbFile);
        await waitForCondition(() => prompt.displayed, defaultNotebookTestTimeout, 'Prompt not displayed');
        await waitForKernelToGetAutoSelected(editor, PYTHON_LANGUAGE, true);
        let nbEditor = vscodeNotebook.activeNotebookEditor!;
        assert.isOk(nbEditor, 'No active notebook');
        // Cell 1 = `a = "Hello World"`
        // Cell 2 = `print(a)`
        let cell2 = nbEditor.notebook.getCells()![1]!;
        await Promise.all([
            runAllCellsInActiveNotebook(),
            waitForExecutionCompletedSuccessfully(cell2),
            waitForTextOutput(cell2, 'Hello World', 0, false)
        ]);
    });
    test('When switching from remote to local, then clear the preferred remote kernel @kernelPicker', async function () {
        // https://github.com/microsoft/vscode-jupyter/issues/10046
        return this.skip();
        await runCellAndVerifyUpdateOfPreferredRemoteKernelId(ipynbFile, svcContainer);

        const nbEditor = vscodeNotebook.activeNotebookEditor!;
        assert.isOk(nbEditor, 'No active notebook');
        const controllerManager = svcContainer.get<IControllerRegistration>(IControllerRegistration);

        // Verify we're connected to a remote kernel.
        const remoteController = controllerManager.getSelected(nbEditor.notebook);
        assert.strictEqual(isLocalConnection(remoteController!.connection), false, 'Should be a remote connection');

        // Verify we have a preferred remote kernel stored.
        assert.isNotEmpty(
            await remoteKernelIdProvider.getPreferredRemoteKernelId(nbEditor.notebook.uri),
            'Preferred remote kernel id cannot be empty'
        );

        // Switch to a local kernel.
        const localKernelController = await waitForCondition(
            () =>
                controllerRegistration.registered.find(
                    (item) =>
                        item.connection.kind === 'startUsingLocalKernelSpec' ||
                        item.connection.kind === 'startUsingPythonInterpreter'
                ),
            defaultNotebookTestTimeout,
            'No local kernel controller found'
        );
        await commands.executeCommand('notebook.selectKernel', {
            id: localKernelController?.id,
            extension: JVSC_EXTENSION_ID
        });

        // Wait for the controller to get selected.
        await waitForCondition(
            async () => controllerManager.getSelected(nbEditor.notebook) === localKernelController,
            5_000,
            `Controller not switched to local kernel, instead it is ${
                controllerManager.getSelected(nbEditor.notebook)?.id
            }`
        );

        // Wait for the preferred remote kernel id to be cleared for this notebook.
        let preferredKernelId = await remoteKernelIdProvider.getPreferredRemoteKernelId(nbEditor.notebook.uri);
        await waitForCondition(
            async () => {
                preferredKernelId = await remoteKernelIdProvider.getPreferredRemoteKernelId(nbEditor.notebook.uri);
                return !preferredKernelId;
            },
            5_000,
            () => `Remote Kernel is not empty, instead the value is ${preferredKernelId}`
        );
    });
});
