// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { CancellationTokenSource, NotebookCellOutputItem, NotebookDocument } from 'vscode';
import { traceInfo } from '../../platform/logging';
import { IDisposable } from '../../platform/common/types';
import { captureScreenShot, initialize, startJupyterServer, suiteMandatory, testMandatory } from '../../test/common';
import {
    closeNotebooksAndCleanUpAfterTests,
    createEmptyPythonNotebook,
    insertCodeCell,
    prewarmNotebooks,
    runCell,
    waitForExecutionCompletedSuccessfully
} from '../../test/datascience/notebook/helper';
import { getKernelsApi } from './api';
import { raceTimeoutError } from '../../platform/common/utils/async';
import { dispose } from '../../platform/common/utils/lifecycle';
import { IKernel, IKernelProvider } from '../types';
import { IControllerRegistration, IVSCodeNotebookController } from '../../notebooks/controllers/types';
import { Kernels, OutputItem } from '../../api';
import { JVSC_EXTENSION_ID_FOR_TESTS } from '../../test/constants';

suiteMandatory('Kernel API Tests @python', function () {
    const disposables: IDisposable[] = [];
    this.timeout(120_000);
    let kernelProvider: IKernelProvider;
    let notebook: NotebookDocument;
    let controller: IVSCodeNotebookController;
    let realKernel: IKernel;
    let kernels: Kernels;
    let controllerRegistration: IControllerRegistration;
    suiteSetup(async function () {
        this.timeout(120_000);
        traceInfo('Suite Setup, Step 1');
        const api = await initialize();
        kernelProvider = api.serviceContainer.get<IKernelProvider>(IKernelProvider);
        controllerRegistration = api.serviceContainer.get<IControllerRegistration>(IControllerRegistration);
        traceInfo('Suite Setup, Step 2');
        await startJupyterServer();
        traceInfo('Suite Setup, Step 3');
        await prewarmNotebooks();
        traceInfo('Suite Setup, Step 4');
        kernels = await Promise.resolve(getKernelsApi(JVSC_EXTENSION_ID_FOR_TESTS));
        traceInfo('Suite Setup (completed)');
    });
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        const notebookEditor = (await createEmptyPythonNotebook(disposables)).editor;
        notebook = notebookEditor.notebook;
        await insertCodeCell('print("1234")', { index: 0 });
        controller = controllerRegistration.getSelected(notebook)!;
        realKernel = kernelProvider.getOrCreate(notebook, {
            controller: controller.controller,
            metadata: controller.connection,
            resourceUri: notebook.uri
        });
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
    test('No kernel returned if no code has been executed', async function () {
        const kernel = await kernels.findKernel(notebook.uri);

        assert.isUndefined(kernel, 'Kernel should not be returned as no code was executed');
    });
    testMandatory('Get Kernel and execute code', async function () {
        // No kernel unless we execute code against this kernel.
        assert.isUndefined(kernels.findKernel(notebook.uri));

        // Even after starting a kernel the API should not return anyting,
        // as no code has been executed against this kernel.
        await realKernel.start();
        await kernels.findKernel(notebook.uri);

        // Ensure user has executed some code against this kernel.
        const cell = notebook.cellAt(0)!;
        await Promise.all([runCell(cell), waitForExecutionCompletedSuccessfully(cell)]);

        const kernel = await kernels.findKernel(notebook.uri);
        if (!kernel) {
            throw new Error('Kernel not found');
        }
        // const statusChange = createEventHandler(kernel, 'onDidChangeStatus', disposables);

        // Verify we can execute code using the kernel.
        traceInfo(`Execute code silently`);
        const expectedMime = NotebookCellOutputItem.stdout('').mime;
        const token = new CancellationTokenSource();
        await waitForOutput(kernel.executeCode('print(1234)', token.token), '1234', expectedMime);
        traceInfo(`Execute code silently completed`);
        // // Wait for kernel to be idle.
        // await waitForCondition(
        //     () => kernel.status === 'idle',
        //     5_000,
        //     `Kernel did not become idle, current status is ${kernel.status}`
        // );

        // // Verify state transition.
        // assert.deepEqual(Array.from(new Set(statusChange.all)), ['busy', 'idle'], 'States are incorrect');

        // Verify we can execute code using the kernel in parallel.
        await Promise.all([
            waitForOutput(kernel.executeCode('print(1)', token.token), '1', expectedMime),
            waitForOutput(kernel.executeCode('print(2)', token.token), '2', expectedMime),
            waitForOutput(kernel.executeCode('print(3)', token.token), '3', expectedMime)
        ]);

        // // Wait for kernel to be idle.
        // await waitForCondition(
        //     () => kernel.status === 'idle',
        //     5_000,
        //     `Kernel did not become idle, current status is ${kernel.status}`
        // );
    });

    async function waitForOutput(
        executionResult: AsyncIterable<OutputItem[]>,
        expectedOutput: string,
        expectedMimetype: string
    ) {
        const disposables: IDisposable[] = [];
        const outputsReceived: string[] = [];
        const outputPromise = new Promise<void>(async (resolve, reject) => {
            for await (const items of executionResult) {
                items.forEach((item) => {
                    if (item.mime === expectedMimetype) {
                        const output = new TextDecoder().decode(item.data).trim();
                        if (output === expectedOutput.trim()) {
                            resolve();
                        } else {
                            reject(new Error(`Unexpected output ${output}`));
                        }
                    } else {
                        outputsReceived.push(`${item.mime} ${new TextDecoder().decode(item.data).trim()}`);
                    }
                });
            }
        });

        await raceTimeoutError(
            30_000,
            new Error(`Timed out waiting for output, got ${outputsReceived}`),
            outputPromise
        ).finally(() => dispose(disposables));
    }
});
