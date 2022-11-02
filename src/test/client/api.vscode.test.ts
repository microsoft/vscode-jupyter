// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { traceInfo, traceInfoIfCI } from '../../platform/logging';
import { IDisposable } from '../../platform/common/types';
import {
    closeNotebooksAndCleanUpAfterTests,
    defaultNotebookTestTimeout,
    startJupyterServer,
    waitForTextOutput
} from '../datascience/notebook/helper.node';
import { initialize } from '../initialize.node';
import * as sinon from 'sinon';
import { captureScreenShot, createEventHandler, IExtensionTestApi, waitForCondition } from '../common.node';
import { IS_REMOTE_NATIVE_TEST } from '../constants.node';
import { Disposable, Uri, workspace } from 'vscode';
import { executeSilently } from '../../kernels/helpers';
import { getPlainTextOrStreamOutput } from '../../kernels/kernel';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { createKernelController, TestNotebookDocument } from '../datascience/notebook/executionHelper';
import { IKernel, INotebookKernelExecution, IKernelProvider, IKernelFinder } from '../../kernels/types';
import { areInterpreterPathsSame } from '../../platform/pythonEnvironments/info/interpreter';

suite('3rd Party Kernel Service API', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    this.timeout(120_000);
    let notebook: TestNotebookDocument;
    let kernel: IKernel;
    let kernelExecution: INotebookKernelExecution;
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
            assert.fail('Active Interpreter is undefined');
        }
        const metadata = await waitForCondition(
            () =>
                kernelFiner.kernels.find(
                    (item) =>
                        item.kind === 'startUsingPythonInterpreter' &&
                        areInterpreterPathsSame(item.interpreter.uri, interpreter.uri)
                ),
            defaultNotebookTestTimeout,
            `Kernel Connection pointing to active interpreter not found`
        );

        const controller = createKernelController();
        kernel = kernelProvider.getOrCreate(notebook, { metadata, resourceUri: notebook.uri, controller });
        // await kernel.start();
        kernelExecution = kernelProvider.getKernelExecution(kernel);
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

    test.skip('Access Kernels', async () => {
        const kernelService = await api.getKernelService();
        const onDidChangeKernels = createEventHandler(kernelService!, 'onDidChangeKernels');

        const notebooks = sinon.stub(workspace, 'notebookDocuments');
        disposables.push(new Disposable(() => notebooks.restore()));
        notebooks.get(() => [notebook]);

        const cell = await notebook.appendCodeCell('print("123412341234")');
        await Promise.all([kernelExecution.executeCell(cell), waitForTextOutput(cell, '123412341234')]);

        await onDidChangeKernels.assertFiredExactly(1, 10_000);

        const kernels = kernelService?.getActiveKernels();
        assert.isAtLeast(kernels!.length, 1);
        assert.strictEqual(
            kernels![0].uri!.toString(),
            notebook.uri.toString(),
            'Kernel notebook is not the active notebook'
        );

        assert.isObject(kernels![0].metadata, 'Kernel Connection is undefined');
        const kernel = kernelService?.getKernel(notebook!.uri);
        assert.strictEqual(kernels![0].metadata, kernel!.metadata, 'Kernel Connection not same for the document');

        await closeNotebooksAndCleanUpAfterTests(disposables);

        await onDidChangeKernels.assertFiredExactly(2, 10_000);
    });

    test('Start Kernel', async function () {
        const kernelService = await api.getKernelService();
        const interpreterService = await api.serviceContainer.get<IInterpreterService>(IInterpreterService);
        const onDidChangeKernels = createEventHandler(kernelService!, 'onDidChangeKernels');
        const activeInterpreter = await interpreterService.getActiveInterpreter();

        const kernelSpecs = await kernelService!.getKernelSpecifications();
        traceInfoIfCI(
            `Found kernel specs ${kernelSpecs.length}: ${kernelSpecs
                .map((i) => `${i.id}, ${i.kind}, ${i.interpreter?.uri.path}`)
                .join('\n')}`
        );
        const pythonKernel = IS_REMOTE_NATIVE_TEST()
            ? kernelSpecs.find(
                  (item) => item.kind === 'startUsingRemoteKernelSpec' && item.kernelSpec.language === 'python'
              )
            : kernelSpecs.find(
                  (item) =>
                      item.kind === 'startUsingPythonInterpreter' &&
                      activeInterpreter &&
                      Uri.from(item.interpreter.uri).toString() === Uri.from(activeInterpreter.uri).toString()
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
