// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import {
    CancellationTokenSource,
    NotebookCell,
    NotebookCellOutputItem,
    NotebookDocument,
    commands,
    window,
    workspace
} from 'vscode';
import { logger } from '../../../../platform/logging';
import { IDisposable } from '../../../../platform/common/types';
import { captureScreenShot, createEventHandler, initialize, waitForCondition } from '../../../common';
import {
    closeNotebooksAndCleanUpAfterTests,
    createTemporaryNotebook,
    insertCodeCell,
    runCell,
    waitForExecutionCompletedSuccessfully
} from '../../../datascience/notebook/helper';
import { getKernelsApi } from '../../../../standalone/api/kernels';
import { createDeferred, raceTimeoutError } from '../../../../platform/common/utils/async';
import { dispose } from '../../../../platform/common/utils/lifecycle';
import { IKernel, IKernelProvider } from '../../../../kernels/types';
import { IControllerRegistration, IVSCodeNotebookController } from '../../../../notebooks/controllers/types';
import { Kernels, Output } from '../../../../api';
import { JVSC_EXTENSION_ID_FOR_TESTS } from '../../../constants';
import { KernelError } from '../../../../kernels/errors/kernelError';
import { JVSC_EXTENSION_ID } from '../../../../platform/common/constants';
import { notebookCellExecutions } from '../../../../platform/notebooks/cellExecutionStateService';
import { noop } from '../../../core';

suite('Kernel API Tests @typescript', function () {
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
        logger.info('Suite Setup, Step 1');
        const api = await initialize();
        kernelProvider = api.serviceContainer.get<IKernelProvider>(IKernelProvider);
        controllerRegistration = api.serviceContainer.get<IControllerRegistration>(IControllerRegistration);
        kernels = await Promise.resolve(getKernelsApi(JVSC_EXTENSION_ID_FOR_TESTS));
        // Wait till deno kernel has been discovered.
        const connection = await waitForCondition(
            async () =>
                controllerRegistration.all.find(
                    (k) => k.kind === 'startUsingLocalKernelSpec' && k.kernelSpec.language === 'typescript'
                )!,
            15_000,
            'Deno kernel not found'
        );
        controller = controllerRegistration.get(connection, 'jupyter-notebook')!;
        logger.info('Suite Setup (completed)');
    });
    setup(async function () {
        logger.info(`Start Test ${this.currentTest?.title}`);
        const uri = await createTemporaryNotebook(
            [],
            disposables,
            { name: 'deno', display_name: 'Deno' },
            undefined,
            undefined,
            'typescript'
        );
        notebook = await workspace.openNotebookDocument(uri);
        await window.showNotebookDocument(notebook);
        await commands.executeCommand('notebook.selectKernel', {
            id: controller!.id,
            extension: JVSC_EXTENSION_ID
        });
        await insertCodeCell('console.log(1234)', { index: 0, language: 'typescript' });
        realKernel = kernelProvider.getOrCreate(notebook, {
            controller: controller.controller,
            metadata: controller.connection,
            resourceUri: notebook.uri
        });
        logger.info(`Start Test (completed) ${this.currentTest?.title}`);
    });

    teardown(async function () {
        logger.info(`Ended Test ${this.currentTest?.title}`);
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this);
        }

        await closeNotebooksAndCleanUpAfterTests(disposables);
        logger.info(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    test('No kernel returned if no code has been executed @mandatory', async function () {
        const kernel = await kernels.getKernel(notebook.uri);

        assert.isUndefined(kernel, 'Kernel should not be returned as no code was executed');
    });
    test('Get Kernel and execute code @mandatory', async function () {
        // No kernel unless we execute code against this kernel.
        assert.isUndefined(await kernels.getKernel(notebook.uri));

        // Even after starting a kernel the API should not return anything,
        // as no code has been executed against this kernel.
        await realKernel.start({
            disableUI: true,
            onDidChangeDisableUI: () => ({
                dispose: noop
            })
        });
        assert.isUndefined(await kernels.getKernel(notebook.uri));

        // Ensure user has executed some code against this kernel.
        const cell = notebook.cellAt(0)!;
        const executionOrderSet = createDeferred();
        const eventHandler = notebookCellExecutions.onDidChangeNotebookCellExecutionState((e) => {
            if (e.cell === cell && e.cell.executionSummary?.executionOrder) {
                executionOrderSet.resolve();
            }
        });
        disposables.push(eventHandler);
        await Promise.all([runCell(cell), waitForExecutionCompletedSuccessfully(cell), executionOrderSet.promise]);

        const kernel = await kernels.getKernel(notebook.uri);
        if (!kernel) {
            throw new Error('Kernel not found');
        }
        const statusChange = createEventHandler(kernel, 'onDidChangeStatus', disposables);

        // Verify we can execute code using the kernel.
        logger.info(`Execute code silently`);
        const expectedMime = NotebookCellOutputItem.stdout('').mime;
        const token = new CancellationTokenSource();
        await waitForOutput(kernel.executeCode('console.log(1234)', token.token), '1234', expectedMime);
        logger.info(`Execute code silently completed`);
        // Wait for kernel to be idle.
        await waitForCondition(
            () => kernel.status === 'idle',
            5_000,
            `Kernel did not become idle, current status is ${kernel.status}`
        );

        // Verify state transition.
        assert.deepEqual(Array.from(new Set(statusChange.all)), ['busy', 'idle'], 'States are incorrect');

        // Verify we can execute code using the kernel in parallel.
        await Promise.all([
            waitForOutput(kernel.executeCode('console.log(1)', token.token), '1', expectedMime),
            waitForOutput(kernel.executeCode('console.log(2)', token.token), '2', expectedMime),
            waitForOutput(kernel.executeCode('console.log(3)', token.token), '3', expectedMime)
        ]);

        // Wait for kernel to be idle.
        await waitForCondition(
            () => kernel.status === 'idle',
            5_000,
            `Kernel did not become idle, current status is ${kernel.status}`
        );

        // When we execute code that fails, we should get the error information.
        const errorOutputs: Output[] = [];
        let exceptionThrown = false;
        try {
            for await (const output of kernel.executeCode('Kaboom', token.token)) {
                errorOutputs.push(output);
            }
        } catch (ex) {
            exceptionThrown = true;
            assert.instanceOf(ex, KernelError, 'Error thrown is not a kernel error');
        }
        assert.isTrue(exceptionThrown, 'Kernel Execution should fail with an error');
        assert.strictEqual(errorOutputs.length, 1, 'Incorrect number of outputs');
        assert.strictEqual(errorOutputs[0].items.length, 1, 'Incorrect number of output items');
        assert.strictEqual(
            errorOutputs[0].items[0].mime,
            NotebookCellOutputItem.error(new Error('')).mime,
            'Expected an error output'
        );
        const error = JSON.parse(new TextDecoder().decode(errorOutputs[0].items[0].data));
        assert.include(error.message, 'Kaboom');
        assert.isOk(errorOutputs[0].metadata, 'No error metadata found');
        assert.isArray(errorOutputs[0].metadata?.originalError?.traceback, 'No traceback found in original error');
        assert.include(
            errorOutputs[0].metadata?.originalError?.traceback?.join(''),
            'Kaboom',
            'Traceback does not contain original error'
        );
    });
    test('Kernel start event is not triggered by silent executions @mandatory', async function () {
        let startEventCounter = 0;
        // Register event listener to track invocations
        disposables.push(
            kernels.onDidStart(() => {
                startEventCounter++;
            })
        );

        await realKernel.start({
            disableUI: true,
            onDidChangeDisableUI: () => ({
                dispose: noop
            })
        });
        assert.equal(startEventCounter, 0, 'Kernel start event was triggered for a non-user kernel start');
    });
    test('Kernel start event is triggered when started with UI enabled @mandatory', async function () {
        let startEventCounter = 0;
        // Register event listener to track invocations
        disposables.push(
            kernels.onDidStart(() => {
                startEventCounter++;
            })
        );

        await realKernel.start({
            disableUI: false,
            onDidChangeDisableUI: () => ({
                dispose: noop
            })
        });
        assert.equal(startEventCounter, 1, 'Kernel start event was not triggered for a user kernel start');

        // If we call start again with UI enabled, we shouldn't fire additional events
        await realKernel.start({
            disableUI: false,
            onDidChangeDisableUI: () => ({
                dispose: noop
            })
        });
        assert.equal(startEventCounter, 1, 'Multiple start calls should not fire more events');
    });
    test('Kernel start event is triggered when kernel restarts @mandatory', async function () {
        let startEventCounter = 0;
        // Register event listener to track invocations
        disposables.push(
            kernels.onDidStart(() => {
                startEventCounter++;
            })
        );

        await realKernel.start({
            disableUI: true,
            onDidChangeDisableUI: () => ({
                dispose: noop
            })
        });
        await realKernel.restart();
        assert.equal(startEventCounter, 1, 'Kernel start event should be fired exactly once after restarting');
        await realKernel.restart();
        assert.equal(startEventCounter, 2, 'Kernel start event should be fired more than once for restarts');
    });
    test('Kernel start event is triggered when user executes code and the event execution runs first @mandatory', async function () {
        // Register event listener to track invocations
        const source = new CancellationTokenSource();
        let startEventCounter = 0;

        const executionOrderSet = createDeferred();
        disposables.push(
            kernels.onDidStart(async ({ kernel, waitUntil }) => {
                waitUntil(
                    (async () => {
                        const codeToRun =
                            startEventCounter === 0 ? `let foo = ${startEventCounter}` : `foo = ${startEventCounter}`;
                        startEventCounter++;

                        // This is needed for the async generator to get executed.
                        // eslint-disable-next-line @typescript-eslint/no-unused-vars
                        for await (const _out of kernel.executeCode(codeToRun, source.token)) {
                        }

                        // Cell should not have executed at this point.
                        assert.strictEqual(executionOrderSet.resolved, false);
                    })()
                );
            })
        );
        await insertCodeCell('console.log(foo)', { index: 0, language: 'typescript' });

        assert.equal(startEventCounter, 0, 'Kernel start event was triggered for a non-user kernel start');
        const cell = notebook.cellAt(0)!;
        const eventHandler = notebookCellExecutions.onDidChangeNotebookCellExecutionState((e) => {
            if (e.cell === cell && e.cell.executionSummary?.executionOrder) {
                executionOrderSet.resolve();
            }
        });
        disposables.push(eventHandler);

        // Do not explicitly start the kernel here, let it be triggered by the cell execution.
        await Promise.all([runCell(cell), waitForExecutionCompletedSuccessfully(cell), executionOrderSet.promise]);

        // Validate the cell execution output is equal to the expected value of "foo = 0"
        const expectedMime = NotebookCellOutputItem.stdout('').mime;
        assert.equal(
            await decodeFirstOutput(cell, expectedMime),
            '0',
            'Invalid output, kernel start hook should execute code first'
        );

        const kernel = await kernels.getKernel(notebook.uri);
        if (!kernel) {
            throw new Error('Kernel not found');
        }

        // Start event counter should only be 1 after the initial user cell execution
        assert.equal(startEventCounter, 1, 'Kernel start event was not triggered for a user kernel start');

        // Running the same cell again should not fire additional events
        await Promise.all([runCell(cell), waitForExecutionCompletedSuccessfully(cell), executionOrderSet.promise]);
        assert.equal(
            await decodeFirstOutput(cell, expectedMime),
            '0',
            'Invalid output, kernel start hook should only execute once'
        );
        assert.equal(startEventCounter, 1, 'Start event should not be triggered more than once');
    });

    async function decodeFirstOutput(cell: NotebookCell, expectedMimetype: string) {
        return (
            cell.outputs
                .flatMap((output) => output.items)
                .map((item) => {
                    if (item.mime === expectedMimetype) {
                        const output = new TextDecoder().decode(item.data).trim();
                        return output;
                    }
                })
                .find((item) => item !== undefined) ?? ''
        );
    }

    async function waitForOutput(
        executionResult: AsyncIterable<Output>,
        expectedOutput: string,
        expectedMimetype: string
    ) {
        const disposables: IDisposable[] = [];
        const outputsReceived: string[] = [];
        // eslint-disable-next-line no-async-promise-executor
        const outputPromise = new Promise<void>(async (resolve, reject) => {
            for await (const output of executionResult) {
                output.items.forEach((item) => {
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
