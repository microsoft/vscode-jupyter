// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { traceInfo } from '../../platform/logging';
import { IDisposable } from '../../platform/common/types';
import { closeNotebooksAndCleanUpAfterTests, startJupyterServer } from '../datascience/notebook/helper.node';
import { initialize } from '../initialize.node';
import * as sinon from 'sinon';
import { captureScreenShot, createEventHandler, IExtensionTestApi, waitForCondition } from '../common.node';
import { executeSilently } from '../../kernels/helpers';
import { getPlainTextOrStreamOutput } from '../../kernels/kernel';
import { TestNotebookDocument } from '../datascience/notebook/executionHelper';
import { IKernelProvider, LocalKernelConnectionMetadata } from '../../kernels/types';
import { KernelConnectionMetadata } from '../../api';
import { IControllerRegistration } from '../../notebooks/controllers/types';

suite('3rd Party Kernel Service API @kernelCore', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    this.timeout(120_000);
    let notebook: TestNotebookDocument;
    suiteSetup(async function () {
        traceInfo('Suite Setup 3rd Party Kernel Service API');
        this.timeout(120_000);
        try {
            api = await initialize();
            await startJupyterServer();
            sinon.restore();
            notebook = new TestNotebookDocument();
            traceInfo('Suite Setup (completed)');
        } catch (e) {
            traceInfo('Suite Setup (failed) - 3rd Party Kernel Service API');
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
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        sinon.restore();
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
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
});
