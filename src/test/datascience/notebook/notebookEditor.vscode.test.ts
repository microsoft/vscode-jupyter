// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import { CancellationToken } from 'vscode-languageclient';
import { ICommandManager, IVSCodeNotebook } from '../../../client/common/application/types';
import { IDisposable } from '../../../client/common/types';
import { Commands } from '../../../client/datascience/constants';
import { INotebookKernelProvider } from '../../../client/datascience/notebook/types';
import { INotebookEditorProvider } from '../../../client/datascience/types';
import { IExtensionTestApi } from '../../common';
import { initialize } from '../../initialize';
import {
    canRunNotebookTests,
    closeNotebooks,
    closeNotebooksAndCleanUpAfterTests,
    deleteAllCellsAndWait,
    executeCell,
    insertCodeCell,
    selectCell,
    waitForExecutionCompletedSuccessfully,
    waitForKernelToGetAutoSelected
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
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        editorProvider = api.serviceContainer.get<INotebookEditorProvider>(INotebookEditorProvider);
        commandManager = api.serviceContainer.get<ICommandManager>(ICommandManager);
        kernelProvider = api.serviceContainer.get<INotebookKernelProvider>(INotebookKernelProvider);
    });

    setup(async function () {
        // Open a notebook and use this for all tests in this test suite.
        await editorProvider.createNew();
        await waitForKernelToGetAutoSelected();
        await deleteAllCellsAndWait();
        assert.isOk(vscodeNotebook.activeNotebookEditor, 'No active notebook');
    });

    teardown(async function () {
        await closeNotebooks(disposables);
        await closeNotebooksAndCleanUpAfterTests(disposables);
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
        this.skip();
        // Do this after talking with VS code team
        // // add a cell
        // await insertCodeCell('print("0")', { index: 0 });

        // const cell = vscodeNotebook.activeNotebookEditor?.document.cells![0]!;

        // await executeCell(cell);

        // // Wait till execution count changes and status is success.
        // await waitForExecutionCompletedSuccessfully(cell);

        // // Switch kernels to the other kernel
        // const kernels = await kernelProvider.provideKernels(
        //     vscodeNotebook.activeNotebookEditor!.document,
        //     CancellationToken.None
        // );
        // if (kernels?.length && kernels?.length > 0) {
        //     // We have multiple kernels. Try switching
        //     await commandManager.executeCommand(
        //         'notebook.selectKernel',
        //     );
        // }
    });
});
