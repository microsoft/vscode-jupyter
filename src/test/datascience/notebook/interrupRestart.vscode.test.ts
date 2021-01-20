// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import * as sinon from 'sinon';
import { commands } from 'vscode';
import { NotebookEditor as VSCNotebookEditor } from '../../../../typings/vscode-proposed';
import { IApplicationShell, IVSCodeNotebook } from '../../../client/common/application/types';
import { traceInfo } from '../../../client/common/logger';
import { IConfigurationService, IDisposable, IJupyterSettings, ReadWrite } from '../../../client/common/types';
import { createDeferredFromPromise } from '../../../client/common/utils/async';
import { DataScience } from '../../../client/common/utils/localize';
import { noop } from '../../../client/common/utils/misc';
import { IKernelProvider } from '../../../client/datascience/jupyter/kernels/types';
import { INotebookEditorProvider } from '../../../client/datascience/types';
import { IExtensionTestApi, waitForCondition } from '../../common';
import { IS_REMOTE_NATIVE_TEST } from '../../constants';
import { initialize } from '../../initialize';
import {
    assertVSCCellIsNotRunning,
    assertVSCCellIsRunning,
    canRunNotebookTests,
    closeNotebooksAndCleanUpAfterTests,
    executeActiveDocument,
    insertCodeCell,
    startJupyterServer,
    trustAllNotebooks,
    waitForExecutionCompletedWithErrors,
    waitForKernelToGetAutoSelected,
    waitForTextOutputInVSCode
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
    let kernelProvider: IKernelProvider;
    let vscEditor: VSCNotebookEditor;
    let vscodeNotebook: IVSCodeNotebook;
    let oldAskForRestart: boolean | undefined;
    let dsSettings: ReadWrite<IJupyterSettings>;
    const suiteDisposables: IDisposable[] = [];
    suiteSetup(async function () {
        traceInfo(`Start Suite Test`);
        api = await initialize();
        if (IS_REMOTE_NATIVE_TEST || !(await canRunNotebookTests())) {
            return this.skip();
        }
        await startJupyterServer();
        await closeNotebooksAndCleanUpAfterTests();
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        editorProvider = api.serviceContainer.get<INotebookEditorProvider>(INotebookEditorProvider);
        kernelProvider = api.serviceContainer.get<IKernelProvider>(IKernelProvider);
        dsSettings = api.serviceContainer.get<IConfigurationService>(IConfigurationService).getSettings(undefined);
        oldAskForRestart = dsSettings.askForKernelRestart;
        traceInfo(`Start Suite Test Complete`);
    });
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        sinon.restore();
        await startJupyterServer();
        await trustAllNotebooks();
        // Open a notebook and use this for all tests in this test suite.
        await editorProvider.createNew();
        await waitForKernelToGetAutoSelected();
        assert.isOk(vscodeNotebook.activeNotebookEditor, 'No active notebook');
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
        const cell = vscEditor.document.cells[0];
        const appShell = api.serviceContainer.get<IApplicationShell>(IApplicationShell);
        const showInformationMessage = sinon.stub(appShell, 'showInformationMessage');
        showInformationMessage.resolves(); // Ignore message to restart kernel.
        disposables.push({ dispose: () => showInformationMessage.restore() });
        await waitForCondition(async () => kernelProvider.get(cell.notebook.uri) !== undefined, 5_000, 'No kernel');
        const promise = kernelProvider.get(cell.notebook.uri)!.executeCell(cell);
        const deferred = createDeferredFromPromise(promise);

        // Wait for cell to get busy.
        await waitForCondition(async () => assertVSCCellIsRunning(cell), 15_000, 'Cell not being executed');

        // Wait for ?s, and verify cell is still running.
        assert.isFalse(deferred.completed);
        assertVSCCellIsRunning(cell);
        // Wait for some output.
        await waitForTextOutputInVSCode(cell, '1', 0, false, 15_000); // Wait for 15 seconds for it to start (possibly kernel is still starting).

        // Interrupt the kernel.
        kernelProvider.get(cell.notebook.uri)!.interruptAllCells(vscEditor.document).catch(noop);

        // Wait for interruption or message prompting to restart kernel to be displayed.
        // Interrupt can fail sometimes and then we display message prompting user to restart kernel.
        await waitForCondition(
            async () => deferred.completed || showInformationMessage.called,
            30_000, // Wait for completion or interrupt timeout.
            'Execution not cancelled'
        );
        if (deferred.completed) {
            await waitForExecutionCompletedWithErrors(cell);
        }
    });
    test('Restarting kernel will cancel cell execution & we can re-run a cell', async function () {
        traceInfo('Step 1');
        await insertCodeCell('import time\nfor i in range(10000):\n  print(i)\n  time.sleep(0.1)', { index: 0 });
        const cell = vscEditor.document.cells[0];
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
        await executeActiveDocument();
        traceInfo(`Step 5. After execute`);

        // Wait for cell to get busy.
        await waitForCondition(async () => assertVSCCellIsRunning(cell), 15_000, 'Cell not being executed');
        traceInfo(`Step 6. Cell is busy`);

        // Wait for ?s, and verify cell is still running.
        assertVSCCellIsRunning(cell);
        // Wait for some output.
        await waitForTextOutputInVSCode(cell, '1', 0, false, 15_000); // Wait for 15 seconds for it to start (possibly kernel is still starting).
        traceInfo(`Step 7. Cell output`);

        // Restart the kernel.
        const restartPromise = commands.executeCommand('jupyter.notebookeditor.restartkernel');

        await waitForCondition(
            async () => {
                traceInfo(`Step 8 Cell Status = ${cell.metadata.runState}`);
                return assertVSCCellIsNotRunning(cell);
            },
            15_000,
            'Execution not cancelled first time.'
        );

        // Wait before we execute cells again.
        traceInfo('Step 9 Wait for restart');
        await restartPromise;
        traceInfo('Step 10 Restarted');

        // Confirm we can execute a cell (using the new kernel session).
        await executeActiveDocument();
        traceInfo('Step 11 Executed');

        // Wait for cell to get busy.
        await waitForCondition(async () => assertVSCCellIsRunning(cell), 15_000, 'Cell not being executed');
        traceInfo('Step 12 Cells executed after restart');
        // Wait for some output.
        await waitForTextOutputInVSCode(cell, '1', 0, false, 15_000); // Wait for 15 seconds for it to start (possibly kernel is still starting).
        traceInfo(`Step 13. Cell output`);

        // Stop the cell (cleaner way to tear down this test, else VS Code can hang due to the fact that we delete/close notebooks & rest of the code is trying to access it).
        const interruptPromise = commands.executeCommand('jupyter.notebookeditor.interruptkernel');
        traceInfo('Step 14 Executed interrupt');
        await waitForCondition(
            async () => assertVSCCellIsNotRunning(cell),
            15_000,
            'Execution not cancelled second time.'
        );
        traceInfo('Step 15 execution cancelled');
        await interruptPromise;
        traceInfo('Step 16 Interrupted');
    });
});
