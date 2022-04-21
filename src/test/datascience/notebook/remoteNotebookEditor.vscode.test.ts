// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { JupyterServerSelector } from '../../../kernels/jupyter/serverSelector';
import { RemoteKernelSpecConnectionMetadata } from '../../../kernels/types';
import { INotebookControllerManager } from '../../../notebooks/types';
import { traceInfoIfCI, traceInfo } from '../../../platform/logging';
import { waitForCondition } from '../../common';
import { openNotebook } from '../helpers';
import { JupyterServer } from '../jupyterServer.node';
import { createTemporaryNotebook, defaultNotebookTestTimeout, getServices, startJupyterServer } from './helper.node';
import { sharedRemoteNotebookEditorTests } from './remoteNotebookEditor.vscode.common';

suite('DataScience - VSCode Notebook - (Remote) (Execution) (slow)', function () {
    // Use the shared code that runs the tests
    const disposables = sharedRemoteNotebookEditorTests(this, (n) => {
        return startJupyterServer(n);
    });

    // This test needs to run in node only as we have to start another jupyter server
    test('Old Remote kernels are removed when switching to new Remote Server', async function () {
        const { serviceContainer } = await getServices();
        const controllerManager = serviceContainer.get<INotebookControllerManager>(
            INotebookControllerManager,
            INotebookControllerManager
        );
        const jupyterServerSelector = serviceContainer.get<JupyterServerSelector>(JupyterServerSelector);

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
                    controllerManager.registeredNotebookControllers()
                )}`
        );
    });
});
