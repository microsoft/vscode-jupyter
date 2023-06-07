// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { traceInfo } from '../../platform/logging';
import { IDisposable } from '../../platform/common/types';
import {
    closeNotebooksAndCleanUpAfterTests,
    defaultNotebookTestTimeout,
    startJupyterServer
} from '../datascience/notebook/helper.node';
import { initialize } from '../initialize.node';
import * as sinon from 'sinon';
import { captureScreenShot, createEventHandler, IExtensionTestApi, waitForCondition } from '../common.node';
import { IS_REMOTE_NATIVE_TEST } from '../constants.node';
import { executeSilently } from '../../kernels/helpers';
import { getPlainTextOrStreamOutput } from '../../kernels/kernel';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { createKernelController, TestNotebookDocument } from '../datascience/notebook/executionHelper';
import { IKernelProvider, IKernelFinder } from '../../kernels/types';
import { areInterpreterPathsSame } from '../../platform/pythonEnvironments/info/interpreter';
import { getDisplayPath } from '../../platform/common/platform/fs-paths';
import { KernelConnectionMetadata } from '../../api';

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
        const kernelFiner = api.serviceContainer.get<IKernelFinder>(IKernelFinder);
        const interpreterService = api.serviceContainer.get<IInterpreterService>(IInterpreterService);
        const interpreter = await interpreterService.getActiveInterpreter();
        if (!interpreter) {
            throw new Error('Active Interpreter is undefined.0');
        }
        const metadata = await waitForCondition(
            () =>
                kernelFiner.kernels.find(
                    (item) =>
                        item.kind === 'startUsingPythonInterpreter' &&
                        areInterpreterPathsSame(item.interpreter.uri, interpreter.uri)
                ),
            defaultNotebookTestTimeout,
            () =>
                `Kernel Connection pointing to active interpreter not found, active kernels include ${kernelFiner.kernels
                    .map((item) => `${item.kind}, id=${item.id}, interpreter ${getDisplayPath(item.interpreter?.uri)}`)
                    .join(', ')}`
        );

        const controller = createKernelController();
        const kernel = kernelProvider.getOrCreate(notebook, { metadata, resourceUri: notebook.uri, controller });
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
        const interpreterService = await api.serviceContainer.get<IInterpreterService>(IInterpreterService);
        const onDidChangeKernels = createEventHandler(kernelService!, 'onDidChangeKernels');
        const activeInterpreter = await interpreterService.getActiveInterpreter();
        if (!activeInterpreter) {
            throw new Error('Active Interpreter is undefined.1');
        }
        assert.isOk(activeInterpreter);
        let kernelSpecs: KernelConnectionMetadata[] = [];
        const pythonKernel = await waitForCondition(
            async () => {
                kernelSpecs = await kernelService!.getKernelSpecifications();
                return IS_REMOTE_NATIVE_TEST()
                    ? kernelSpecs.find(
                          (item) => item.kind === 'startUsingRemoteKernelSpec' && item.kernelSpec.language === 'python'
                      )
                    : kernelSpecs.find(
                          (item) =>
                              item.kind === 'startUsingPythonInterpreter' &&
                              areInterpreterPathsSame(item.interpreter.uri, activeInterpreter.uri)
                      );
            },
            defaultNotebookTestTimeout,
            () =>
                `Python Kernel not found, active interpreter is ${activeInterpreter.uri.toString()}, found kernel specs ${
                    kernelSpecs.length
                }: ${kernelSpecs
                    .map((i) => `${i.id}, ${i.kind}, ${i.interpreter?.uri?.path}`)
                    .join('\n')}, \n ${JSON.stringify(kernelSpecs, undefined, 2)}`
        );
        assert.isOk(pythonKernel, 'Python Kernel Spec not found');

        // Don't use same file (due to dirty handling, we might save in dirty.)
        // Coz we won't save to file, hence extension will backup in dirty file and when u re-open it will open from dirty.
        const kernelInfo = await kernelService?.startKernel(pythonKernel!, notebook.uri!);

        assert.isOk(kernelInfo!.connection, 'Kernel Connection is undefined');
        assert.isOk(kernelInfo!.kernelSocket, 'Kernel Socket is undefined');

        await onDidChangeKernels.assertFiredExactly(1);

        let kernels = kernelService?.getActiveKernels();
        assert.isAtLeast(kernels!.length, 1);
        assert.strictEqual(
            kernels![0].uri!.toString(),
            notebook.uri.toString(),
            'Kernel notebook is not the active notebook'
        );

        assert.strictEqual(kernels![0].metadata.id, pythonKernel?.id, 'Kernel Connection is not the same');
        const kernel = kernelService?.getKernel(notebook.uri);
        assert.strictEqual(kernels![0].metadata.id, kernel!.metadata.id, 'Kernel Connection not same for the document');

        // Verify we can run some code against this kernel.
        const outputs = await executeSilently(kernel?.connection.connection!, '98765');
        assert.strictEqual(outputs.length, 1);
        assert.include(getPlainTextOrStreamOutput(outputs), '98765');
        await closeNotebooksAndCleanUpAfterTests(disposables);

        await onDidChangeKernels.assertFiredExactly(2);

        assert.strictEqual(kernelInfo!.connection.connectionStatus, 'disconnected');
        assert.isTrue(kernelInfo!.connection.isDisposed, 'Not disposed');
    });
});
