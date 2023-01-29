// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import { NotebookCellExecutionState } from 'vscode';
import { IApplicationShell } from '../../../platform/common/application/types';
import { traceError, traceInfo } from '../../../platform/logging';
import { IConfigurationService, IDisposable, IJupyterSettings, ReadWrite } from '../../../platform/common/types';
import { noop } from '../../../platform/common/utils/misc';
import { IKernel, IKernelProvider, INotebookKernelExecution } from '../../../kernels/types';
import { createEventHandler, IExtensionTestApi, sleep, waitForCondition } from '../../common.node';
import { IS_NON_RAW_NATIVE_TEST, IS_REMOTE_NATIVE_TEST } from '../../constants.node';
import { initialize } from '../../initialize.node';
import {
    assertVSCCellIsNotRunning,
    closeNotebooksAndCleanUpAfterTests,
    startJupyterServer,
    waitForExecutionCompletedWithErrors,
    waitForTextOutput,
    waitForExecutionCompletedSuccessfully,
    waitForQueuedForExecution,
    clickOKForRestartPrompt,
    getDefaultKernelConnection
} from './helper.node';
import { hasErrorOutput, NotebookCellStateTracker, getTextOutputValue } from '../../../kernels/execution/helpers';
import { TestNotebookDocument, createKernelController } from './executionHelper';
import { captureScreenShot } from '../../common';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this,  */
/*
 * This test focuses on interrupting, restarting kernels.
 * We will not use actual kernels, just ensure the appropriate methods are invoked on the appropriate classes.
 * This is done by stubbing out some methods.
 */
suite('Restart/Interrupt/Cancel/Errors @kernelCore', function () {
    this.timeout(60_000);

    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let oldAskForRestart: boolean | undefined;
    let dsSettings: ReadWrite<IJupyterSettings>;
    let notebook: TestNotebookDocument;
    let kernel: IKernel;
    let kernelExecution: INotebookKernelExecution;
    const suiteDisposables: IDisposable[] = [];
    suiteSetup(async function () {
        try {
            traceInfo(`Start Suite Test Restart/Interrupt/Cancel/Errors @kernelCore`);
            api = await initialize();
            await startJupyterServer();
            await closeNotebooksAndCleanUpAfterTests();
            dsSettings = api.serviceContainer.get<IConfigurationService>(IConfigurationService).getSettings(undefined);
            oldAskForRestart = dsSettings.askForKernelRestart;
            notebook = new TestNotebookDocument();
            const kernelProvider = api.serviceContainer.get<IKernelProvider>(IKernelProvider);
            const metadata = await getDefaultKernelConnection();
            traceInfo(`Start Suite Test Restart/Interrupt/Cancel/Errors @kernelCore metadata ${metadata.id}`);
            const controller = createKernelController();
            traceInfo(`Controller created`);
            kernel = kernelProvider.getOrCreate(notebook, { metadata, resourceUri: notebook.uri, controller });
            traceInfo(`Kernel created`);
            await kernel.start();
            traceInfo(`Kernel started`);
            kernelExecution = kernelProvider.getKernelExecution(kernel);
            traceInfo(`Start Suite Test Complete Restart/Interrupt/Cancel/Errors @kernelCore`);
        } catch (ex) {
            traceError('Suite Setup (failed) - Test Restart/Interrupt/Cancel/Errors @kernelCore', ex);
            await captureScreenShot('execution-suite');
            throw ex;
        }
    });
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        sinon.restore();
        notebook.cells.length = 0;
        // Disable the prompt (when attempting to restart kernel).
        dsSettings.askForKernelRestart = false;
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(function () {
        traceInfo(`End Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(async () => {
        if (dsSettings) {
            dsSettings.askForKernelRestart = oldAskForRestart === true;
        }
        await closeNotebooksAndCleanUpAfterTests(disposables.concat(suiteDisposables));
    });

    test('Interrupting kernel with Cancelling token will cancel cell execution', async () => {
        const cell = await notebook.appendCodeCell(
            'import time\nfor i in range(10000):\n  print(i)\n  time.sleep(0.1)'
        );
        const appShell = api.serviceContainer.get<IApplicationShell>(IApplicationShell);
        const showInformationMessage = sinon.stub(appShell, 'showInformationMessage');
        showInformationMessage.resolves(); // Ignore message to restart kernel.
        disposables.push({ dispose: () => showInformationMessage.restore() });
        traceInfo('Step 1');
        const execPromise = kernelExecution.executeCell(cell).catch(noop);
        traceInfo('Step 2');

        await waitForTextOutput(cell, '1', 0, false);
        traceInfo('Step 3');

        // Interrupt the kernel.
        const interruptPromise = kernel.interrupt().catch(noop);
        traceInfo('Step 4');

        // Wait for interruption (cell will fail with errors).
        await Promise.all([
            execPromise,
            interruptPromise,
            waitForCondition(async () => hasErrorOutput(cell.outputs), 30_000, 'No errors')
        ]);
        traceInfo('Step 5');
    });
    test('Restarting kernel will cancel cell execution & we can re-run a cell', async function () {
        if (IS_REMOTE_NATIVE_TEST()) {
            return this.skip();
        }
        traceInfo('Step 1');
        const cell = await notebook.appendCodeCell(
            'import time\nfor i in range(10000):\n  print(i)\n  time.sleep(0.1)'
        );
        // Ensure we click `Yes` when prompted to restart the kernel.
        disposables.push(await clickOKForRestartPrompt());

        traceInfo(`Step 4. Before execute`);
        traceInfo(`Step 5. After execute`);
        const promise = kernelExecution.executeCell(cell).catch(noop);
        await waitForTextOutput(cell, '1', 0, false);

        // Restart the kernel & use event handler to check if it was restarted successfully.
        const waitForKernelToRestart = createEventHandler(kernel, 'onRestarted', disposables);
        traceInfo('Step 9 Wait for restart');
        kernel.restart().catch(noop);
        // Wait for kernel to restart before we execute cells again.
        await waitForKernelToRestart.assertFired(30_000);
        traceInfo('Step 10 Restarted');
        // Wait for cell completed
        await waitForCondition(
            async () => NotebookCellStateTracker.getCellState(cell) === NotebookCellExecutionState.Idle,
            60_000,
            'Cell did not stop running'
        );
        traceInfo('Step 11 Restarted');

        // Clear the cells
        // Clear the outputs.
        cell.outputs.length = 0;

        // Confirm we can execute a cell (using the new kernel session).
        traceInfo('Step 12 Executed');
        kernelExecution.executeCell(cell).catch(noop);
        await waitForTextOutput(cell, '1', 0, false);
        traceInfo(`Step 13. Cell output`);

        // Don't have to wait for interrupt, as sometimes interrupt can timeout & we get a prompt to restart.
        // Stop execution of the cell (if possible) in kernel.
        kernel.interrupt().catch(noop);
        // Stop the cell (cleaner way to tear down this test, else VS Code can hang due to the fact that we delete/close notebooks & rest of the code is trying to access it).

        traceInfo('Step 14');

        // Wait for interruption (cell will fail with errors).
        await Promise.all([promise, waitForCondition(async () => hasErrorOutput(cell.outputs), 30_000, 'No errors')]);
        traceInfo('Step 15');
    });
    test('Restarting kernel during run all will skip the rest of the cells', async function () {
        traceInfo('Step 1');
        await notebook.appendCodeCell('print(1)');
        const cell = await notebook.appendCodeCell('import time\nprint(2)\ntime.sleep(60)');
        const lastCell = await notebook.appendCodeCell('print(3)');

        // Ensure we click `Yes` when prompted to restart the kernel.
        await clickOKForRestartPrompt();
        traceInfo(`Step 4. Before execute`);
        traceInfo(`Step 5. After execute`);
        const executionPromise = Promise.all(
            notebook.cells.map((cell) => kernelExecution.executeCell(cell).catch(noop))
        );
        await waitForTextOutput(cell, '2', 0, false);
        traceInfo(`Step 6. Cell is busy`);

        // Restart the kernel & use event handler to check if it was restarted successfully.
        const waitForKernelToRestart = createEventHandler(kernel, 'onRestarted', disposables);
        const restartPromise = kernel.restart().catch(noop);

        // Wait for kernel to restart before we execute cells again.
        traceInfo('Step 8 Wait for restart');
        await waitForKernelToRestart.assertFired(30_000);
        traceInfo('Step 9 Restarted');

        // Confirm last cell is empty
        await Promise.all([executionPromise, restartPromise]);
        assert.equal(lastCell.outputs.length, 0, 'Last cell should not have run');
    });
    test('Interrupt and running cells again should only run the necessary cells', async function () {
        // No need to test remote as this is a test of status (fewer slower tests is better).
        if (IS_REMOTE_NATIVE_TEST()) {
            return this.skip();
        }

        /*
        Cells 1, 2, 3.
        Ensure cell 2 is a long running cell
        Run all cells, interrupt execution when running cell 2.
        Confirm 1 is a success & 2 has failed (as a result of interrupt)
        Run cell 2 again & confirm cell 3 is NOT running (previously cell 3 would run again).
        Similarly run whole document again & confirm cell 3 is NOT running (previously cell 3 would run again).

        Interrupt & verify cell 3 status has not changed, & cell 2 gets interrupted (this used to fail).
        Ensure we can run cell 3 after we interrupt.
        */
        await notebook.appendCodeCell('1');
        await notebook.appendCodeCell('import time\nfor i in range(10000):\n  print(i)\n  time.sleep(0.2)');
        await notebook.appendCodeCell('3');

        const [cell1, cell2, cell3] = notebook.getCells();
        const appShell = api.serviceContainer.get<IApplicationShell>(IApplicationShell);
        const showInformationMessage = sinon.stub(appShell, 'showInformationMessage');
        showInformationMessage.resolves(); // Ignore message to restart kernel.
        disposables.push({ dispose: () => showInformationMessage.restore() });

        console.log('Step1');
        // Confirm 1 completes, 2 is in progress & 3 is queued.
        let executionPromise: Promise<unknown> = Promise.all(
            notebook.cells.map((cell) => kernelExecution.executeCell(cell).catch(noop))
        );
        await Promise.all([
            waitForExecutionCompletedSuccessfully(cell1),
            waitForTextOutput(cell2, '1', 0, false),
            waitForQueuedForExecution(cell3)
        ]);
        console.log('Step2');

        // Interrupt the kernel & wait for 2 to cancel & 3 to get de-queued.
        let interruptPromise = kernel.interrupt().catch(noop);
        console.log('Step3');

        await Promise.all([
            executionPromise,
            interruptPromise,
            waitForExecutionCompletedWithErrors(cell2),
            waitForCondition(async () => hasErrorOutput(cell2.outputs), 30_000, 'Cell 2 does not have any errors'),
            waitForCondition(async () => assertVSCCellIsNotRunning(cell3), 15_000, 'Cell 3 did not get dequeued')
        ]);
        console.log('Step4');
        assert.equal(cell1.executionSummary?.executionOrder, 1, 'Execution order of cell 1 is incorrect');
        assert.equal(cell2.executionSummary?.executionOrder, 2, 'Execution order of cell 2 is incorrect');

        const message = showInformationMessage.getCalls()[0]?.args[0];
        const cell2Output = getTextOutputValue(cell2.outputs[0]).trim();

        // Run cell 2 again (errors should be cleared and we should start seeing 1,2,3 again)
        console.log('Step5');
        executionPromise = kernelExecution.executeCell(cell2).catch(noop);
        await Promise.all([
            waitForCondition(
                async () => (cell2.executionSummary?.executionOrder || 0) >= 3,
                30_000,
                `Execution order of cell 1 should be greater than previous execution count. Interrupt had this message ${message}`
            ),
            waitForTextOutput(cell2, '1', 0, false),
            waitForCondition(
                async () => getTextOutputValue(cell2.outputs[0]).trim() != cell2Output,
                30_000,
                'Output of cell 2 has not changed after re-running it'
            )
        ]);
        console.log('Step6');
        assertVSCCellIsNotRunning(cell1);
        assertVSCCellIsNotRunning(cell3);
        assert.equal(cell1.executionSummary?.executionOrder, 1, 'Execution order of cell 1 changed');
        assert.equal(cell2.executionSummary?.executionOrder, 3, 'Execution order of cell 2 should be 3');

        // Interrupt the kernel & wait for 2.
        interruptPromise = kernel.interrupt().catch(noop);

        console.log('Step7');
        await Promise.all([
            executionPromise,
            interruptPromise,
            waitForExecutionCompletedWithErrors(cell2),
            waitForCondition(async () => hasErrorOutput(cell2.outputs), 30_000, 'Cell 2 does not have any errors'),
            waitForCondition(
                async () => NotebookCellStateTracker.getCellState(cell3) === NotebookCellExecutionState.Idle,
                30_000,
                'Cell 3 is not idle'
            )
        ]);
        console.log('Step8');

        // Run entire document again & confirm 1 completes again & 2 runs & 3 gets queued.
        // Confirm 1 completes, 2 is in progress & 3 is queued.
        executionPromise = Promise.all(notebook.cells.map((cell) => kernelExecution.executeCell(cell).catch(noop)));
        await Promise.all([
            waitForExecutionCompletedSuccessfully(cell1),
            waitForCondition(
                async () => (cell1.executionSummary?.executionOrder || 0) === 4,
                30_000,
                'Execution order of cell 1 should be 4'
            ),
            waitForCondition(
                async () => (cell2.executionSummary?.executionOrder || 0) === 5,
                30_000,
                'Execution order of cell 2 should be 4'
            ),
            waitForQueuedForExecution(cell3)
        ]);
        console.log('Step9');

        // Interrupt the kernel & wait for 2 to cancel & 3 to get de-queued.
        interruptPromise = kernel.interrupt().catch(noop);
        console.log('Step10');

        await Promise.all([
            executionPromise,
            interruptPromise,
            waitForExecutionCompletedWithErrors(cell2),
            waitForCondition(async () => hasErrorOutput(cell2.outputs), 30_000, 'Cell 2 does not have any errors'),
            waitForCondition(async () => assertVSCCellIsNotRunning(cell3), 15_000, 'Cell 3 did not get dequeued')
        ]);

        console.log('Step11');
        // Run cell 3 now, & confirm we can run it to completion.
        await Promise.all([
            kernelExecution.executeCell(cell3),
            waitForExecutionCompletedSuccessfully(cell3),
            waitForTextOutput(cell3, '3', 0, false)
        ]);
        console.log('Step12');
    });
    test('Can restart a kernel after it dies', async function () {
        if (IS_REMOTE_NATIVE_TEST() || IS_NON_RAW_NATIVE_TEST()) {
            // The kernel will auto start if it fails when using Jupyter.
            // When using Raw we don't use jupyter.
            return this.skip();
        }

        /*
        Run cell 1 - Print some value
        Run Cell 2 with some code that will cause the kernel to die.
        Run cell 1 again, it should fail as the kernel is dead.
        Restart kernel & run cell 1, it should work.
        */
        await notebook.appendCodeCell('1');
        await notebook.appendCodeCell(
            'import IPython\napp = IPython.Application.instance()\napp.kernel.do_shutdown(True)'
        );

        const [cell1, cell2] = notebook.getCells();
        // Ensure we click `Yes` when prompted to restart the kernel.
        disposables.push(await clickOKForRestartPrompt());

        // Confirm 1 completes, 2 is in progress & 3 is queued.
        await Promise.all([
            Promise.all(notebook.cells.map((cell) => kernelExecution.executeCell(cell).catch(noop))),
            waitForExecutionCompletedSuccessfully(cell1),
            waitForExecutionCompletedSuccessfully(cell2),
            waitForTextOutput(cell1, '1', 0, false)
        ]);
        assert.isAtLeast(cell1.executionSummary!.executionOrder!, 1, 'Cell 1 should have an execution order of 1');
        assert.strictEqual(
            cell2.executionSummary?.executionOrder,
            cell1.executionSummary!.executionOrder! + 1,
            'Cell 1 should have an execution order of 2'
        );

        // Clear all outputs
        cell1.outputs.length = 0;

        // Wait a bit to make sure it cleared & for kernel to die.
        await sleep(500);

        // Restart the kernel & use event handler to check if it was restarted successfully.
        const waitForKernelToRestart = createEventHandler(kernel, 'onRestarted', disposables);
        traceInfo('Step 9 Wait for restart');
        await Promise.all([
            kernel.restart(),
            // Wait for kernel to restart before we execute cells again.
            waitForKernelToRestart.assertFired(30_000)
        ]);
        traceInfo('Step 10 Restarted');

        // Run the first cell again & this time it should work.
        // When we re-run the cells, the execution order shoulld start from 1 all over again
        // If its one, then kernel has restarted.
        await Promise.all([
            Promise.all(notebook.cells.map((cell) => kernelExecution.executeCell(cell).catch(noop))),
            waitForExecutionCompletedSuccessfully(cell1),
            waitForExecutionCompletedSuccessfully(cell2),
            waitForTextOutput(cell1, '1', 0, false)
        ]);
        assert.strictEqual(cell1.executionSummary?.executionOrder, 1, 'Cell 1 should have an execution order of 1');
        assert.strictEqual(cell2.executionSummary?.executionOrder, 2, 'Cell 1 should have an execution order of 2');

        // Restart and run the first cell
        await Promise.all([
            kernel.restart(),
            kernelExecution.executeCell(cell1),
            waitForExecutionCompletedSuccessfully(cell1),
            waitForTextOutput(cell1, '1', 0, false)
        ]);
    });
});
