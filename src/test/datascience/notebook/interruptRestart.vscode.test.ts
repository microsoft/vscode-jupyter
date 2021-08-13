// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import * as sinon from 'sinon';
import { commands, NotebookEditor as VSCNotebookEditor } from 'vscode';
import { IApplicationShell, ICommandManager, IVSCodeNotebook } from '../../../client/common/application/types';
import { traceInfo } from '../../../client/common/logger';
import { IConfigurationService, IDisposable, IJupyterSettings, ReadWrite } from '../../../client/common/types';
import { DataScience } from '../../../client/common/utils/localize';
import { noop } from '../../../client/common/utils/misc';
import { Commands } from '../../../client/datascience/constants';
import { IKernelProvider } from '../../../client/datascience/jupyter/kernels/types';
import { hasErrorOutput } from '../../../client/datascience/notebook/helpers/helpers';
import { INotebookEditorProvider } from '../../../client/datascience/types';
import { createEventHandler, getOSType, IExtensionTestApi, OSType, waitForCondition } from '../../common';
import { IS_REMOTE_NATIVE_TEST } from '../../constants';
import { initialize } from '../../initialize';
import {
    assertVSCCellIsNotRunning,
    canRunNotebookTests,
    closeNotebooksAndCleanUpAfterTests,
    createEmptyPythonNotebook,
    runAllCellsInActiveNotebook,
    insertCodeCell,
    startJupyterServer,
    waitForExecutionCompletedWithErrors,
    waitForTextOutput,
    waitForExecutionInProgress,
    waitForExecutionCompletedSuccessfully,
    waitForQueuedForExecution,
    runCell,
    waitForOutputs
} from './helper';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this,  */
/*
 * This test focuses on interrupting, restarting kernels.
 * We will not use actual kernels, just ensure the appropriate methods are invoked on the appropriate classes.
 * This is done by stubbing out some methods.
 */
suite('DataScience - VSCode Notebook - Restart/Interrupt/Cancel/Errors (slow)', function () {
    this.timeout(60_000);

    let api: IExtensionTestApi;
    let editorProvider: INotebookEditorProvider;
    const disposables: IDisposable[] = [];
    let vscEditor: VSCNotebookEditor;
    let vscodeNotebook: IVSCodeNotebook;
    let commandManager: ICommandManager;
    let oldAskForRestart: boolean | undefined;
    let dsSettings: ReadWrite<IJupyterSettings>;
    const suiteDisposables: IDisposable[] = [];
    suiteSetup(async function () {
        traceInfo(`Start Suite Test`);
        api = await initialize();
        if (!(await canRunNotebookTests())) {
            return this.skip();
        }
        await startJupyterServer();
        await closeNotebooksAndCleanUpAfterTests();
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        editorProvider = api.serviceContainer.get<INotebookEditorProvider>(INotebookEditorProvider);
        dsSettings = api.serviceContainer.get<IConfigurationService>(IConfigurationService).getSettings(undefined);
        commandManager = api.serviceContainer.get<ICommandManager>(ICommandManager);
        oldAskForRestart = dsSettings.askForKernelRestart;
        traceInfo(`Start Suite Test Complete`);
    });
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        sinon.restore();
        await startJupyterServer();
        // Open a notebook and use this for all tests in this test suite.
        await createEmptyPythonNotebook(disposables);
        vscEditor = vscodeNotebook.activeNotebookEditor!;
        // Disable the prompt (when attempting to restart kernel).
        dsSettings.askForKernelRestart = false;
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        traceInfo(`End Test ${this.currentTest?.title}`);
        await closeNotebooksAndCleanUpAfterTests(disposables.concat(suiteDisposables));
        traceInfo(`End Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(async () => {
        if (dsSettings) {
            dsSettings.askForKernelRestart = oldAskForRestart === true;
        }
        await closeNotebooksAndCleanUpAfterTests(disposables.concat(suiteDisposables));
    });

    test('Interrupting kernel (Cancelling token) will cancel cell execution', async () => {
        await insertCodeCell('import time\nfor i in range(10000):\n  print(i)\n  time.sleep(0.1)', { index: 0 });
        const cell = vscEditor.document.cellAt(0);
        const appShell = api.serviceContainer.get<IApplicationShell>(IApplicationShell);
        const showInformationMessage = sinon.stub(appShell, 'showInformationMessage');
        showInformationMessage.resolves(); // Ignore message to restart kernel.
        disposables.push({ dispose: () => showInformationMessage.restore() });
        runCell(cell).catch(noop);

        await waitForTextOutput(cell, '1', 0, false);

        // Interrupt the kernel.
        commandManager.executeCommand(Commands.NotebookEditorInterruptKernel, vscEditor.document.uri).then(noop, noop);

        // Wait for interruption (cell will fail with errors).
        await waitForCondition(async () => hasErrorOutput(cell.outputs), 30_000, 'No errors');
    });
    test('Restarting kernel will cancel cell execution & we can re-run a cell', async function () {
        traceInfo('Step 1');
        await insertCodeCell('import time\nfor i in range(10000):\n  print(i)\n  time.sleep(0.1)', { index: 0 });
        const cell = vscEditor.document.cellAt(0);
        // Ensure we click `Yes` when prompted to restart the kernel.
        const appShell = api.serviceContainer.get<IApplicationShell>(IApplicationShell);
        const showInformationMessage = sinon
            .stub(appShell, 'showInformationMessage')
            .callsFake(function (message: string) {
                traceInfo(`Step 2. ShowInformationMessage ${message}`);
                if (message === DataScience.restartKernelMessage()) {
                    traceInfo(`Step 3. ShowInformationMessage & yes to restart`);
                    // User clicked ok to restart it.
                    return DataScience.restartKernelMessageYes();
                }
                return (appShell.showInformationMessage as any).wrappedMethod.apply(appShell, arguments);
            });
        disposables.push({ dispose: () => showInformationMessage.restore() });

        (editorProvider.activeEditor as any).shouldAskForRestart = () => Promise.resolve(false);
        traceInfo(`Step 4. Before execute`);
        traceInfo(`Step 5. After execute`);
        await Promise.all([runAllCellsInActiveNotebook(), waitForTextOutput(cell, '1', 0, false)]);

        // Restart the kernel & use event handler to check if it was restarted successfully.
        const kernel = api.serviceContainer.get<IKernelProvider>(IKernelProvider).get(cell.notebook);
        if (!kernel) {
            throw new Error('Kernel not available');
        }
        const waitForKernelToRestart = createEventHandler(kernel, 'onRestarted', disposables);
        await commands.executeCommand('jupyter.notebookeditor.restartkernel').then(noop, noop);

        // Wait for kernel to restart before we execute cells again.
        traceInfo('Step 9 Wait for restart');
        await waitForKernelToRestart.assertFired(30_000);
        traceInfo('Step 10 Restarted');

        // Clear the cells
        await commands.executeCommand('notebook.clearAllCellsOutputs');
        await waitForOutputs(cell, 0);

        // Confirm we can execute a cell (using the new kernel session).
        traceInfo('Step 11 Executed');
        await Promise.all([runAllCellsInActiveNotebook(), waitForTextOutput(cell, '1', 0, false)]);
        traceInfo(`Step 13. Cell output`);

        // Don't have to wait for interrupt, as sometimes interrupt can timeout & we get a prompt to restart.
        // Stop execution of the cell (if possible) in kernel.
        commandManager.executeCommand(Commands.NotebookEditorInterruptKernel, vscEditor.document.uri).then(noop, noop);
        // Stop the cell (cleaner way to tear down this test, else VS Code can hang due to the fact that we delete/close notebooks & rest of the code is trying to access it).

        // KERNELPUSH
        //await vscEditor.kernel!.interrupt!(vscEditor.document);
    });
    test('Restarting kernel during run all will skip the rest of the cells', async function () {
        traceInfo('Step 1');
        await insertCodeCell('print(1)', { index: 0 });
        await insertCodeCell('import time\nprint(2)\ntime.sleep(60)', { index: 1 });
        await insertCodeCell('print(3)', { index: 2 });
        const cell = vscEditor.document.cellAt(1);
        // Ensure we click `Yes` when prompted to restart the kernel.
        const appShell = api.serviceContainer.get<IApplicationShell>(IApplicationShell);
        const showInformationMessage = sinon
            .stub(appShell, 'showInformationMessage')
            .callsFake(function (message: string) {
                traceInfo(`Step 2. ShowInformationMessage ${message}`);
                if (message === DataScience.restartKernelMessage()) {
                    traceInfo(`Step 3. ShowInformationMessage & yes to restart`);
                    // User clicked ok to restart it.
                    return DataScience.restartKernelMessageYes();
                }
                return (appShell.showInformationMessage as any).wrappedMethod.apply(appShell, arguments);
            });
        disposables.push({ dispose: () => showInformationMessage.restore() });

        (editorProvider.activeEditor as any).shouldAskForRestart = () => Promise.resolve(false);
        traceInfo(`Step 4. Before execute`);
        traceInfo(`Step 5. After execute`);
        await Promise.all([runAllCellsInActiveNotebook(), waitForTextOutput(cell, '2', 0, false)]);
        traceInfo(`Step 6. Cell is busy`);

        // Restart the kernel & use event handler to check if it was restarted successfully.
        const kernel = api.serviceContainer.get<IKernelProvider>(IKernelProvider).get(cell.notebook);
        if (!kernel) {
            throw new Error('Kernel not available');
        }
        const waitForKernelToRestart = createEventHandler(kernel, 'onRestarted', disposables);
        await commands.executeCommand('jupyter.notebookeditor.restartkernel').then(noop, noop);

        // Wait for kernel to restart before we execute cells again.
        traceInfo('Step 8 Wait for restart');
        await waitForKernelToRestart.assertFired(30_000);
        traceInfo('Step 9 Restarted');

        // Confirm last cell is empty
        const lastCell = vscEditor.document.cellAt(2);
        assert.equal(lastCell.outputs.length, 0, 'Last cell should not have run');
    });
    test('Interrupt and running cells again should only run the necessary cells', async function () {
        // Interrupts on windows doesn't work well, not as well as on Unix.
        // This is how Python works, hence this test is better tested on Unix OS.
        // No need to test remote as this is a test of status (fewer slower tests is better).
        if (getOSType() === OSType.Windows || IS_REMOTE_NATIVE_TEST) {
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
        await insertCodeCell('1', { index: 0 });
        await insertCodeCell('import time\nfor i in range(10000):\n  print(i)\n  time.sleep(0.2)', { index: 1 });
        await insertCodeCell('3', { index: 2 });

        const [cell1, cell2, cell3] = vscEditor.document.getCells();
        const appShell = api.serviceContainer.get<IApplicationShell>(IApplicationShell);
        const showInformationMessage = sinon.stub(appShell, 'showInformationMessage');
        showInformationMessage.resolves(); // Ignore message to restart kernel.
        disposables.push({ dispose: () => showInformationMessage.restore() });

        // Confirm 1 completes, 2 is in progress & 3 is queued.
        await Promise.all([
            runAllCellsInActiveNotebook(),
            waitForExecutionCompletedSuccessfully(cell1),
            waitForExecutionInProgress(cell2),
            waitForQueuedForExecution(cell3)
        ]);

        // Interrupt the kernel & wait for 2 to cancel & 3 to get de-queued.
        commandManager.executeCommand(Commands.NotebookEditorInterruptKernel, vscEditor.document.uri).then(noop, noop);

        await Promise.all([
            waitForExecutionCompletedWithErrors(cell2),
            waitForCondition(async () => assertVSCCellIsNotRunning(cell3), 15_000, 'Cell 3 did not get dequeued')
        ]);

        const cell1ExecutionCount = cell1.executionSummary?.executionOrder!;
        await Promise.all([
            runCell(cell2),
            // Confirm 2 is in progress & 3 is queued.
            waitForExecutionInProgress(cell2)
        ]);
        assertVSCCellIsNotRunning(cell1);
        assertVSCCellIsNotRunning(cell3);
        assert.equal(cell1.executionSummary?.executionOrder, cell1ExecutionCount, 'Execution order of cell 1 changed');

        // Interrupt the kernel & wait for 2.
        commandManager.executeCommand(Commands.NotebookEditorInterruptKernel, vscEditor.document.uri).then(noop, noop);
        await waitForExecutionCompletedWithErrors(cell2);

        // Run entire document again & confirm 1 completes again & 2 runs & 3 gets queued.
        // Confirm 1 completes, 2 is in progress & 3 is queued.
        await Promise.all([
            runAllCellsInActiveNotebook(),
            waitForExecutionCompletedSuccessfully(cell1),
            waitForExecutionInProgress(cell2),
            waitForQueuedForExecution(cell3)
        ]);
        assert.isAbove(
            cell1.executionSummary?.executionOrder || 0,
            cell1ExecutionCount,
            'Execution order of cell 1 should be greater than previous execution count'
        );

        // Interrupt the kernel & wait for 2 to cancel & 3 to get de-queued.
        commandManager.executeCommand(Commands.NotebookEditorInterruptKernel, vscEditor.document.uri).then(noop, noop);

        await Promise.all([
            waitForExecutionCompletedWithErrors(cell2),
            waitForCondition(async () => assertVSCCellIsNotRunning(cell3), 15_000, 'Cell 3 did not get dequeued')
        ]);

        // Run cell 3 now, & confirm we can run it to completion.
        await Promise.all([runCell(cell3), waitForExecutionCompletedSuccessfully(cell3)]);
    });
});
