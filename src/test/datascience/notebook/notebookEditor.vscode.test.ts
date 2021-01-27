// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import { CellDisplayOutput } from 'vscode';
import { CancellationToken } from 'vscode-jsonrpc';
import { ICommandManager, IVSCodeNotebook } from '../../../client/common/application/types';
import { traceInfo } from '../../../client/common/logger';
import { IDisposable } from '../../../client/common/types';
import { Commands } from '../../../client/datascience/constants';
import { INotebookKernelProvider } from '../../../client/datascience/notebook/types';
import { INotebookEditorProvider } from '../../../client/datascience/types';
import { IExtensionTestApi } from '../../common';
import { initialize } from '../../initialize';
import {
    canRunNotebookTests,
    closeNotebooksAndCleanUpAfterTests,
    deleteAllCellsAndWait,
    executeCell,
    insertCodeCell,
    selectCell,
    startJupyterServer,
    trustAllNotebooks,
    waitForExecutionCompletedSuccessfully,
    waitForKernelToGetAutoSelected,
    waitForKernelToGetSelected
} from './helper';
const vscodeNotebookEnums = require('vscode') as typeof import('vscode-proposed');

suite('Notebook Editor tests', () => {
    let api: IExtensionTestApi;
    let vscodeNotebook: IVSCodeNotebook;
    let editorProvider: INotebookEditorProvider;
    let commandManager: ICommandManager;
    let kernelProvider: INotebookKernelProvider;
    const disposables: IDisposable[] = [];

    suiteSetup(async function () {
        api = await initialize();
        if (!(await canRunNotebookTests())) {
            return this.skip();
        }
        await startJupyterServer();
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        editorProvider = api.serviceContainer.get<INotebookEditorProvider>(INotebookEditorProvider);
        commandManager = api.serviceContainer.get<ICommandManager>(ICommandManager);
        kernelProvider = api.serviceContainer.get<INotebookKernelProvider>(INotebookKernelProvider);

        // On conda these take longer for some reason.
        this.timeout(30_000);
    });

    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        await startJupyterServer();
        await trustAllNotebooks();
        // Open a notebook and use this for all tests in this test suite.
        await editorProvider.createNew();
        await waitForKernelToGetAutoSelected();
        await deleteAllCellsAndWait();
        assert.isOk(vscodeNotebook.activeNotebookEditor, 'No active notebook');
        traceInfo(`Start Test Completed ${this.currentTest?.title}`);
    });

    teardown(async function () {
        traceInfo(`End Test ${this.currentTest?.title}`);
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`End Test Completed ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));

    test('Run cells above', async function () {
        // add some cells
        await insertCodeCell('print("0")', { index: 0 });
        await insertCodeCell('print("1")', { index: 1 });
        await insertCodeCell('print("2")', { index: 2 });

        // select second cell
        await selectCell(vscodeNotebook.activeNotebookEditor?.document!, 1, 1);

        // run command
        await commandManager.executeCommand(
            Commands.NativeNotebookRunAllCellsAbove,
            vscodeNotebook.activeNotebookEditor?.document.uri!
        );

        const firstCell = vscodeNotebook.activeNotebookEditor?.document.cells![0]!;
        await waitForExecutionCompletedSuccessfully(firstCell);
        const thirdCell = vscodeNotebook.activeNotebookEditor?.document.cells![2]!;

        // The first cell should have a runState of Success
        assert.strictEqual(firstCell?.metadata.runState, vscodeNotebookEnums.NotebookCellRunState.Success);

        // The third cell should have an undefined runState
        assert.strictEqual(thirdCell?.metadata.runState, undefined);
    });

    test('Run cells below', async function () {
        // add some cells
        await insertCodeCell('print("0")', { index: 0 });
        await insertCodeCell('print("1")', { index: 1 });
        await insertCodeCell('print("2")', { index: 2 });

        // select second cell
        await selectCell(vscodeNotebook.activeNotebookEditor?.document!, 1, 1);

        // run command
        await commandManager.executeCommand(
            Commands.NativeNotebookRunCellAndAllBelow,
            vscodeNotebook.activeNotebookEditor?.document.uri!
        );

        const firstCell = vscodeNotebook.activeNotebookEditor?.document.cells![0]!;
        const thirdCell = vscodeNotebook.activeNotebookEditor?.document.cells![2]!;
        await waitForExecutionCompletedSuccessfully(thirdCell);

        // The first cell should have an undefined runState
        assert.strictEqual(firstCell?.metadata.runState, undefined);

        // The third cell should have a runState of Success
        assert.strictEqual(thirdCell?.metadata.runState, vscodeNotebookEnums.NotebookCellRunState.Success);
    });

    test('Switch kernels', async function () {
        // add a cell
        await insertCodeCell('import sys\nprint(sys.executable)', { index: 0 });

        const cell = vscodeNotebook.activeNotebookEditor?.document.cells![0]!;

        await executeCell(cell);
        const originalSysPath = (cell.outputs[0] as CellDisplayOutput).data['text/plain'].toString();

        // Wait till execution count changes and status is success.
        await waitForExecutionCompletedSuccessfully(cell);

        // Switch kernels to the other kernel
        const kernels = await kernelProvider.provideKernels(
            vscodeNotebook.activeNotebookEditor!.document,
            CancellationToken.None
        );
        traceInfo(`Kernels found for switch kernel: ${kernels?.map((k) => k.label).join('\n')}`);
        if (kernels?.length && kernels?.length > 1) {
            // We have multiple kernels. Try switching
            await waitForKernelToGetSelected(kernels[1].label);
        }

        // Execute cell and verify output
        await executeCell(cell);
        assert.strictEqual(cell?.outputs.length, 1);
        assert.strictEqual(cell?.metadata.runState, vscodeNotebookEnums.NotebookCellRunState.Success);

        if (kernels?.length && kernels?.length > 1) {
            const newSysPath = (cell.outputs[0] as CellDisplayOutput).data['text/plain'].toString();
            assert.notEqual(
                newSysPath,
                originalSysPath,
                `Kernel did not switch. New sys path is same as old ${newSysPath} for kernels ${kernels[0].label} && ${kernels[1].label}`
            );
        }
    });
});
