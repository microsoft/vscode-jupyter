// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { assert } from 'chai';
import { traceInfo, traceInfoIfCI } from '../../platform/logging';
import { IDisposable } from '../../platform/common/types';
import {
    closeNotebooksAndCleanUpAfterTests,
    createEmptyPythonNotebook,
    createTemporaryNotebook,
    insertCodeCell,
    prewarmNotebooks,
    runCell,
    startJupyterServer,
    waitForTextOutput
} from '../datascience/notebook/helper.node';
import { initialize } from '../initialize.node';
import * as sinon from 'sinon';
import { captureScreenShot, createEventHandler, IExtensionTestApi } from '../common.node';
import { IVSCodeNotebook } from '../../platform/common/application/types';
import { IS_REMOTE_NATIVE_TEST } from '../constants.node';
import { Uri, workspace } from 'vscode';
import { executeSilently } from '../../kernels/helpers';
import { getPlainTextOrStreamOutput } from '../../kernels/kernel';
import { IInterpreterService } from '../../platform/interpreter/contracts';

suite('3rd Party Kernel Service API', function () {
    let api: IExtensionTestApi;
    let vscodeNotebook: IVSCodeNotebook;
    const disposables: IDisposable[] = [];
    this.timeout(120_000);
    suiteSetup(async function () {
        traceInfo('Suite Setup VS Code Notebook - Execution');
        this.timeout(120_000);
        try {
            api = await initialize();
            await startJupyterServer();
            await prewarmNotebooks();
            sinon.restore();
            vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
            traceInfo('Suite Setup (completed)');
        } catch (e) {
            traceInfo('Suite Setup (failed) - Execution');
            await captureScreenShot('API-suite');
            throw e;
        }
    });
    // Use same notebook without starting kernel in every single test (use one for whole suite).
    setup(async function () {
        try {
            traceInfo(`Start Test ${this.currentTest?.title}`);
            sinon.restore();
            await startJupyterServer();
            traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
        } catch (e) {
            await captureScreenShot(this);
            throw e;
        }
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this);
        }
        // Added temporarily to identify why tests are failing.
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

    test('Access Kernels', async () => {
        const kernelService = await api.getKernelService();
        const onDidChangeKernels = createEventHandler(kernelService!, 'onDidChangeKernels');

        await createEmptyPythonNotebook(disposables);
        await insertCodeCell('print("123412341234")', { index: 0 });
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;
        await Promise.all([runCell(cell), waitForTextOutput(cell, '123412341234')]);

        await onDidChangeKernels.assertFiredExactly(1);

        const kernels = kernelService?.getActiveKernels();
        assert.isAtLeast(kernels!.length, 1);
        assert.strictEqual(
            kernels![0].uri!.toString(),
            vscodeNotebook.activeNotebookEditor?.notebook.uri.toString(),
            'Kernel notebook is not the active notebook'
        );

        assert.isObject(kernels![0].metadata, 'Kernel Connection is undefined');
        const kernel = kernelService?.getKernel(vscodeNotebook.activeNotebookEditor!.notebook!.uri);
        assert.strictEqual(kernels![0].metadata, kernel!.metadata, 'Kernel Connection not same for the document');

        await closeNotebooksAndCleanUpAfterTests(disposables);

        await onDidChangeKernels.assertFiredExactly(2);
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
        const nbFile = await createTemporaryNotebook([], disposables);
        const nb = await workspace.openNotebookDocument(nbFile);
        const kernelInfo = await kernelService?.startKernel(pythonKernel!, nb.uri!);

        assert.isOk(kernelInfo!.connection, 'Kernel Connection is undefined');
        assert.isOk(kernelInfo!.kernelSocket, 'Kernel Socket is undefined');

        await onDidChangeKernels.assertFiredExactly(1);

        let kernels = kernelService?.getActiveKernels();
        assert.isAtLeast(kernels!.length, 1);
        assert.strictEqual(
            kernels![0].uri!.toString(),
            nb.uri.toString(),
            'Kernel notebook is not the active notebook'
        );

        assert.strictEqual(kernels![0].metadata.id, pythonKernel?.id, 'Kernel Connection is not the same');
        const kernel = kernelService?.getKernel(nb.uri);
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
