// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { assert } from 'chai';
import * as sinon from 'sinon';
import { ICommandManager, IVSCodeNotebook } from '../../../client/common/application/types';
import { IDisposable } from '../../../client/common/types';
import { Commands, VSCodeNotebookProvider } from '../../../client/datascience/constants';
import { IVariableViewProvider } from '../../../client/datascience/variablesView/types';
import { IExtensionTestApi } from '../../common';
import { initialize } from '../../initialize';
import {
    canRunNotebookTests,
    closeNotebooks,
    closeNotebooksAndCleanUpAfterTests,
    deleteAllCellsAndWait,
    executeCell,
    insertCodeCell,
    startJupyter,
    trustAllNotebooks,
    waitForExecutionCompletedSuccessfully,
    waitForKernelToGetAutoSelected
} from '../notebook/helper';
import { INotebookEditorProvider } from '../../../client/datascience/types';
import { OnMessageListener } from '../vscodeTestHelpers';
import { InteractiveWindowMessages } from '../../../client/datascience/interactive-common/interactiveWindowTypes';
import { verifyViewVariables } from './variableViewHelpers';
import { ITestVariableViewProvider } from './variableViewTestInterfaces';
import { ITestWebviewHost } from '../testInterfaces';

suite('DataScience - VariableView', () => {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let commandManager: ICommandManager;
    let variableViewProvider: ITestVariableViewProvider;
    let editorProvider: INotebookEditorProvider;
    let vscodeNotebook: IVSCodeNotebook;
    suiteSetup(async function () {
        this.timeout(120_000);
        api = await initialize();

        // Don't run if we can't use the native notebook interface
        if (!(await canRunNotebookTests())) {
            return this.skip();
        }
        await trustAllNotebooks();
        await startJupyter(true);
        sinon.restore();
        commandManager = api.serviceContainer.get<ICommandManager>(ICommandManager);
        const coreVariableViewProvider = api.serviceContainer.get<IVariableViewProvider>(IVariableViewProvider);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        variableViewProvider = (coreVariableViewProvider as any) as ITestVariableViewProvider; // Cast to expose the test interfaces
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        editorProvider = api.serviceContainer.get<INotebookEditorProvider>(VSCodeNotebookProvider);
    });
    setup(async function () {
        sinon.restore();

        // Create an editor to use for our tests
        await editorProvider.createNew();
        await waitForKernelToGetAutoSelected();
        await deleteAllCellsAndWait();
        assert.isOk(vscodeNotebook.activeNotebookEditor, 'No active notebook');
    });
    teardown(async function () {
        await closeNotebooks(disposables);
        await closeNotebooksAndCleanUpAfterTests(disposables);
    });

    // Cleanup after suite is finished
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));

    // Test showing the basic variable view with a value or two
    test('Can show VariableView', async function () {
        this.skip(); // Re-enable in CI when #4412 is fixed
        // Add one simple cell and execute it
        await insertCodeCell('test = "MYTESTVALUE"', { index: 0 });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cells![0]!;
        await executeCell(cell);
        await waitForExecutionCompletedSuccessfully(cell);

        // Send the command to open the view
        await commandManager.executeCommand(Commands.OpenVariableView);

        // Aquire the variable view from the provider
        const coreVariableView = await variableViewProvider.activeVariableView;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const variableView = (coreVariableView as any) as ITestWebviewHost;

        // Add our message listener
        const onMessageListener = new OnMessageListener(variableView);

        // Send a second cell
        await insertCodeCell('test2 = "MYTESTVALUE2"', { index: 1 });
        const cell2 = vscodeNotebook.activeNotebookEditor?.document.cells![1]!;
        await executeCell(cell2);

        // Wait until our VariablesComplete message to see that we have the new variables and have rendered them
        await onMessageListener.waitForMessage(InteractiveWindowMessages.VariablesComplete);

        const htmlResult = await variableView?.getHTMLById('variable-view-main-panel');

        // Parse the HTML for our expected variables
        const expectedVariables = [
            { name: 'test', type: 'str', length: '11', value: ' MYTESTVALUE' },
            { name: 'test2', type: 'str', length: '12', value: ' MYTESTVALUE2' }
        ];
        verifyViewVariables(expectedVariables, htmlResult);
    });
});
