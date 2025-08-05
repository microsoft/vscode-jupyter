// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { logger } from '../../platform/logging';
import { IDisposable } from '../../platform/common/types';
import { closeNotebooksAndCleanUpAfterTests, startJupyterServer } from '../datascience/notebook/helper.node';
import { initialize } from '../initialize.node';
import * as sinon from 'sinon';
import { captureScreenShot, createEventHandler, IExtensionTestApi, waitForCondition } from '../common.node';
import { executeSilently } from '../../kernels/helpers';
import { getPlainTextOrStreamOutput } from '../../kernels/kernel';
import { TestNotebookDocument, createKernelController } from '../datascience/notebook/executionHelper';
import { IKernelProvider, LocalKernelConnectionMetadata } from '../../kernels/types';
import { KernelConnectionMetadata } from '../../api';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import { getKernelsApi } from '../../standalone/api/kernels';
import { JVSC_EXTENSION_ID } from '../../platform/common/constants';
import { Kernels } from '../../api';
import {
    waitForExecutionCompletedSuccessfully,
    waitForTextOutput,
    getDefaultKernelConnection
} from '../datascience/notebook/helper.node';

suite('3rd Party Kernel Service API @kernelCore', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    this.timeout(120_000);
    let notebook: TestNotebookDocument;
    let kernels: Kernels;
    suiteSetup(async function () {
        logger.info('Suite Setup 3rd Party Kernel Service API');
        this.timeout(120_000);
        try {
            api = await initialize();
            await startJupyterServer();
            kernels = await Promise.resolve(getKernelsApi(JVSC_EXTENSION_ID));
            sinon.restore();
            notebook = new TestNotebookDocument();
            logger.info('Suite Setup (completed)');
        } catch (e) {
            logger.info('Suite Setup (failed) - 3rd Party Kernel Service API');
            await captureScreenShot('API-suite');
            throw e;
        }
    });
    // Use same notebook without starting kernel in every single test (use one for whole suite).
    setup(async function () {
        notebook.cells.length = 0;
        const kernelProvider = api.serviceContainer.get<IKernelProvider>(IKernelProvider);
        const controllerRegistration = api.serviceContainer.get<IControllerRegistration>(IControllerRegistration);
        // Wait till deno kernel has been discovered.
        const connection = await waitForCondition(
            async () =>
                controllerRegistration.all.find(
                    (k) => k.kind === 'startUsingLocalKernelSpec' && k.kernelSpec.language === 'typescript'
                )!,
            15_000,
            'Deno kernel not found'
        );
        const controller = controllerRegistration.get(connection, 'jupyter-notebook')!;
        const kernel = kernelProvider.getOrCreate(notebook, {
            metadata: connection,
            resourceUri: notebook.uri,
            controller: controller.controller
        });
        kernelProvider.getKernelExecution(kernel);

        sinon.restore();
        logger.info(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        sinon.restore();
        await closeNotebooksAndCleanUpAfterTests(disposables);
        logger.info(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));

    test('List kernel specs', async () => {
        const kernelService = await api.getKernelService();

        // Verify we can invoke the methods on the service.
        const specs = await kernelService!.getKernelSpecifications();
        assert.isAtLeast(specs.length, 1);
    });
    test('Start Kernel', async function () {
        const kernelService = await api.getKernelService();
        const onDidChangeKernels = createEventHandler(kernelService!, 'onDidChangeKernels');
        const kernelProvider = api.serviceContainer.get<IKernelProvider>(IKernelProvider);
        const controllerRegistration = api.serviceContainer.get<IControllerRegistration>(IControllerRegistration);
        const connection = await waitForCondition(
            async () =>
                controllerRegistration.all.find(
                    (k) => k.kind === 'startUsingLocalKernelSpec' && k.kernelSpec.language === 'typescript'
                )!,
            15_000,
            'Deno kernel not found'
        );
        const controller = controllerRegistration.get(connection, 'jupyter-notebook')!;
        const pythonKernel = kernelProvider.getOrCreate(notebook, {
            metadata: connection,
            resourceUri: notebook.uri,
            controller: controller.controller
        });
        assert.isOk(pythonKernel, 'Kernel Spec not found');

        // Don't use same file (due to dirty handling, we might save in dirty.)
        // Coz we won't save to file, hence extension will backup in dirty file and when u re-open it will open from dirty.
        const kernelInfo = await kernelService?.startKernel(connection as KernelConnectionMetadata, notebook.uri!);

        assert.isOk(kernelInfo, 'Kernel Connection is undefined');

        await onDidChangeKernels.assertFiredExactly(1);

        let kernels = kernelService?.getActiveKernels();
        assert.isAtLeast(kernels!.length, 1);
        assert.strictEqual(
            kernels![0].uri!.toString(),
            notebook.uri.toString(),
            'Kernel notebook is not the active notebook'
        );

        const metadata = kernels![0].metadata as unknown as LocalKernelConnectionMetadata;
        assert.strictEqual(metadata.kind, 'startUsingLocalKernelSpec', 'Kernel Connection is not the same');
        assert.strictEqual(metadata.kernelSpec.language, 'typescript');
        assert.strictEqual(metadata.kernelSpec.name, 'deno');

        const kernel = kernelService?.getKernel(notebook.uri);
        assert.strictEqual(metadata.id, kernel!.metadata.id, 'Kernel Connection not same for the document');

        // Verify we can run some code against this kernel.
        const outputs = await executeSilently(kernel?.connection.kernel!, '98765');
        assert.strictEqual(outputs.length, 1);
        assert.include(getPlainTextOrStreamOutput(outputs), '98765');
        await closeNotebooksAndCleanUpAfterTests(disposables);

        await onDidChangeKernels.assertFiredAtLeast(2);

        assert.isNotOk(kernelInfo?.kernel);
        assert.isTrue(kernelInfo?.isDisposed, 'Not disposed');
    });

    test('Can shutdown a kernel correctly via API', async function () {
        // Create a separate notebook for this test to avoid conflicts
        const shutdownNotebook = new TestNotebookDocument();

        // Create a simple test cell that we can execute
        const cell = await shutdownNotebook.appendCodeCell('print("Hello from kernel")');

        // Get a Python kernel for this test
        const kernelProvider = api.serviceContainer.get<IKernelProvider>(IKernelProvider);
        const metadata = await getDefaultKernelConnection();
        const controller = createKernelController();
        const kernel = kernelProvider.getOrCreate(shutdownNotebook, {
            metadata,
            resourceUri: shutdownNotebook.uri,
            controller
        });
        await kernel.start();

        // Get kernel execution service
        const kernelExecution = kernelProvider.getKernelExecution(kernel);

        // First, start the kernel by executing a cell
        logger.info('Step 1: Execute cell to ensure kernel is started');
        await Promise.all([
            kernelExecution.executeCell(cell),
            waitForExecutionCompletedSuccessfully(cell),
            waitForTextOutput(cell, 'Hello from kernel', 0, false)
        ]);

        // Verify kernel is running
        assert.isFalse(kernel.disposed, 'Kernel should not be disposed before shutdown');

        // Get the API kernel instance (must execute code first for API to return kernel)
        const apiKernel = await kernels.getKernel(shutdownNotebook.uri);
        assert.isDefined(apiKernel, 'Should get kernel via API after code execution');

        // Now shutdown the kernel via API
        logger.info('Step 2: Shutdown kernel via API');
        await apiKernel!.shutdown();

        // After shutdown, the kernel should be disposed
        await waitForCondition(async () => kernel.disposed, 30_000, 'Kernel should be disposed after API shutdown');

        logger.info('Step 3: Verify kernel is disposed');
        assert.isTrue(kernel.disposed, 'Kernel should be disposed after API shutdown');
    });
});
