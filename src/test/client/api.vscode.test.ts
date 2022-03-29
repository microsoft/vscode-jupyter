// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { assert } from 'chai';
import * as path from 'path';
import { traceInfo } from '../../platform/common/logger';
import { IDisposable } from '../../platform/common/types';
import {
    closeNotebooksAndCleanUpAfterTests,
    createEmptyPythonNotebook,
    createTemporaryNotebook,
    insertCodeCell,
    prewarmNotebooks,
    runCell,
    startJupyterServer,
    waitForTextOutput,
    workAroundVSCodeNotebookStartPages
} from '../datascience/notebook/helper';
import { initialize } from '../initialize';
import * as sinon from 'sinon';
import { captureScreenShot, createEventHandler, IExtensionTestApi } from '../common';
import { IVSCodeNotebook } from '../../platform/common/application/types';
import { EXTENSION_ROOT_DIR_FOR_TESTS, IS_REMOTE_NATIVE_TEST } from '../constants';
import { Uri, workspace } from 'vscode';

// eslint-disable-next-line
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
            await workAroundVSCodeNotebookStartPages();
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
            await captureScreenShot(this.currentTest?.title || 'unknown');
            throw e;
        }
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this.currentTest?.title);
        }
        // Added temporarily to identify why tests are failing.
        process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT = undefined;
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

        let kernels = await kernelService?.getActiveKernels();
        assert.strictEqual(kernels!.length, 0, 'Initially no active kernels');

        await createEmptyPythonNotebook(disposables);
        await insertCodeCell('print("123412341234")', { index: 0 });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;
        await Promise.all([runCell(cell), waitForTextOutput(cell, '123412341234')]);

        await onDidChangeKernels.assertFiredExactly(1);

        kernels = await kernelService?.getActiveKernels();
        assert.isAtLeast(kernels!.length, 1);
        assert.strictEqual(
            kernels![0].uri.toString(),
            vscodeNotebook.activeNotebookEditor?.document.uri.toString(),
            'Kernel notebook is not the active notebook'
        );

        assert.isObject(kernels![0].metadata, 'Kernel Connection is undefined');
        const kernel = kernelService?.getKernel(vscodeNotebook.activeNotebookEditor!.document!.uri);
        assert.strictEqual(kernels![0].metadata, kernel!.metadata, 'Kernel Connection not same for the document');

        await closeNotebooksAndCleanUpAfterTests(disposables);

        await onDidChangeKernels.assertFiredExactly(2);
        kernels = await kernelService?.getActiveKernels();
        assert.strictEqual(kernels!.length, 0, 'Should not have any kernels');
    });

    test('Start Kernel', async function () {
        const kernelService = await api.getKernelService();
        const onDidChangeKernels = createEventHandler(kernelService!, 'onDidChangeKernels');

        const kernelSpecs = await kernelService!.getKernelSpecifications();
        const pythonKernel = IS_REMOTE_NATIVE_TEST
            ? kernelSpecs.find(
                  (item) => item.kind === 'startUsingRemoteKernelSpec' && item.kernelSpec.language === 'python'
              )
            : kernelSpecs.find((item) => item.kind === 'startUsingPythonInterpreter');
        assert.isOk(pythonKernel, 'Python Kernel Spec not found');

        const templatePythonNbFile = path.join(
            EXTENSION_ROOT_DIR_FOR_TESTS,
            'src/test/datascience/notebook/emptyPython.ipynb'
        );
        // Don't use same file (due to dirty handling, we might save in dirty.)
        // Coz we won't save to file, hence extension will backup in dirty file and when u re-open it will open from dirty.
        const nbFile = await createTemporaryNotebook(templatePythonNbFile, disposables);
        const nb = await workspace.openNotebookDocument(Uri.file(nbFile));
        const kernelInfo = await kernelService?.startKernel(pythonKernel!, nb.uri!);

        assert.isOk(kernelInfo!.connection, 'Kernel Connection is undefined');
        assert.isOk(kernelInfo!.kernelSocket, 'Kernel Socket is undefined');

        await onDidChangeKernels.assertFiredExactly(1);

        let kernels = await kernelService?.getActiveKernels();
        assert.isAtLeast(kernels!.length, 1);
        assert.strictEqual(kernels![0].uri.toString(), nb.uri.toString(), 'Kernel notebook is not the active notebook');

        assert.strictEqual(kernels![0].metadata, pythonKernel, 'Kernel Connection is not the same');
        const kernel = kernelService?.getKernel(nb.uri);
        assert.strictEqual(kernels![0].metadata, kernel!.metadata, 'Kernel Connection not same for the document');

        await closeNotebooksAndCleanUpAfterTests(disposables);

        await onDidChangeKernels.assertFiredExactly(2);
        kernels = await kernelService?.getActiveKernels();
        assert.strictEqual(kernels!.length, 0, 'Should not have any kernels');

        assert.strictEqual(kernelInfo!.connection.connectionStatus, 'disconnected');
        assert.isTrue(kernelInfo!.connection.isDisposed, 'Not disposed');
    });
});
