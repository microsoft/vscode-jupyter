// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { logger } from '../../../platform/logging';
import { IDisposable } from '../../../platform/common/types';
import { IKernel, IKernelProvider } from '../../../kernels/types';
import { waitForCondition, IExtensionTestApi } from '../../common.node';
import { initialize } from '../../initialize.node';
import {
    closeNotebooksAndCleanUpAfterTests,
    startJupyterServer,
    waitForExecutionCompletedSuccessfully,
    waitForTextOutput,
    getDefaultKernelConnection
} from './helper.node';
import { captureScreenShot } from '../../common';
import { TestNotebookDocument, createKernelController } from './executionHelper';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('Kernel Shutdown @kernelCore', function () {
    this.timeout(120_000);
    let notebook: TestNotebookDocument;
    let kernel: IKernel;
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];

    suiteSetup(async function () {
        logger.info(`Start Test (file: Shutdown)`);
        this.timeout(120_000);
        api = await initialize();
    });

    setup(async function () {
        logger.info(`Start Test ${this.currentTest?.title}`);
        await startJupyterServer();
        await closeNotebooksAndCleanUpAfterTests();
        notebook = new TestNotebookDocument();
        const kernelProvider = api.serviceContainer.get<IKernelProvider>(IKernelProvider);
        const metadata = await getDefaultKernelConnection();
        const controller = createKernelController();
        kernel = kernelProvider.getOrCreate(notebook, { metadata, resourceUri: notebook.uri, controller });
        await kernel.start();
    });

    teardown(async function () {
        logger.info(`Ended Test ${this.currentTest?.title}`);
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this);
        }
        await closeNotebooksAndCleanUpAfterTests(disposables);
    });

    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));

    test('Can shutdown a kernel correctly', async function () {
        // Create a simple test cell that we can execute
        const cell = await notebook.appendCodeCell('print("Hello from kernel")');

        // Get kernel execution service
        const kernelProvider = api.serviceContainer.get<IKernelProvider>(IKernelProvider);
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

        // Now shutdown the kernel
        logger.info('Step 2: Shutdown kernel');
        await kernel.shutdown();

        // Then dispose the kernel
        logger.info('Step 3: Dispose kernel');
        await kernel.dispose();

        // After shutdown and disposal, the kernel should be disposed
        await waitForCondition(
            async () => kernel.disposed,
            30_000,
            'Kernel should be disposed after shutdown and disposal'
        );

        logger.info('Step 4: Verify kernel is disposed');
        assert.isTrue(kernel.disposed, 'Kernel should be disposed after shutdown and disposal');
    });
});
