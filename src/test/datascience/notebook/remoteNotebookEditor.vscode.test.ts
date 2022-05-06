/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert } from 'chai';
import { commands, Uri, workspace } from 'vscode';
import { JupyterServerSelector } from '../../../kernels/jupyter/serverSelector';
import { RemoteKernelSpecConnectionMetadata } from '../../../kernels/types';
import { INotebookControllerManager } from '../../../notebooks/types';
import { IVSCodeNotebook } from '../../../platform/common/application/types';
import { PYTHON_LANGUAGE } from '../../../platform/common/constants';
import { DataScience } from '../../../platform/common/utils/localize';
import { IServiceContainer } from '../../../platform/ioc/types';
import { traceInfoIfCI, traceInfo } from '../../../platform/logging';
import { waitForCondition } from '../../common';
import { openNotebook } from '../helpers.node';
import { JupyterServer } from '../jupyterServer.node';
import { hijackPrompt } from './helper';
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
import { sharedRemoteNotebookEditorTests } from './remoteNotebookEditor.vscode.common';

suite('DataScience - VSCode Notebook - (Remote) (Execution) (slow)', function () {
    let controllerManager: INotebookControllerManager;
    let jupyterServerSelector: JupyterServerSelector;
    let vscodeNotebook: IVSCodeNotebook;
    let ipynbFile: Uri;

    // Use the shared code that runs the tests
    const disposables = sharedRemoteNotebookEditorTests(
        this,
        (n) => {
            return startJupyterServer(n);
        },
        (serviceContainer: IServiceContainer) => {
            controllerManager = serviceContainer.get<INotebookControllerManager>(
                INotebookControllerManager,
                INotebookControllerManager
            );
            jupyterServerSelector = serviceContainer.get<JupyterServerSelector>(JupyterServerSelector);
            vscodeNotebook = serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        },
        async () => {
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
        }
    );

    // This test needs to run in node only as we have to start another jupyter server
    test('Old Remote kernels are removed when switching to new Remote Server', async function () {
        await controllerManager.loadNotebookControllers();

        // Opening a notebook will trigger the refresh of the kernel list.
        let nbUri = await createTemporaryNotebook([], disposables);
        await openNotebook(nbUri);

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
        nbUri = await createTemporaryNotebook([], disposables);
        await openNotebook(nbUri);
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
                    controllerManager.registeredNotebookControllers().map((item) => item.connection.kind)
                )}`
        );
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

    test('Remote kernels support intellisense', async function () {
        await openNotebook(ipynbFile);
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

    test('Remote kernels work with https', async function () {
        // Note, this test won't work in web yet.
        const config = workspace.getConfiguration('jupyter');
        await config.update('allowUnauthorizedRemoteConnection', false);
        const prompt = await hijackPrompt(
            'showErrorMessage',
            { contains: 'certificate' },
            { text: DataScience.jupyterSelfCertEnable(), clickImmediately: true }
        );
        await startJupyterServer(undefined, true);
        // Prompt should come up as soon as we connect.
        await waitForCondition(() => prompt.displayed, defaultNotebookTestTimeout, 'Prompt not displayed');
        await openNotebook(ipynbFile);
        await waitForKernelToGetAutoSelected(PYTHON_LANGUAGE, true);
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
    });
});
