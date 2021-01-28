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
import { initialize, IS_REMOTE_NATIVE_TEST } from '../../initialize';
import {
    canRunNotebookTests,
    closeNotebooks,
    closeNotebooksAndCleanUpAfterTests,
    deleteAllCellsAndWait,
    executeCell,
    insertCodeCell,
    prewarmNotebooks,
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

const screenshot = require('screenshot-desktop');

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
        if (IS_REMOTE_NATIVE_TEST || !(await canRunNotebookTests())) {
            return this.skip();
        }
        await trustAllNotebooks();
        await prewarmNotebooks();
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
        this.timeout(60_000);
        // Add one simple cell and execute it
        await insertCodeCell('test = "MYTESTVALUE"', { index: 0 });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cells![0]!;
        await executeCell(cell);
        await waitForExecutionCompletedSuccessfully(cell);

        console.log('IANHU Executed Cell 1');

        // Send the command to open the view
        await commandManager.executeCommand(Commands.OpenVariableView);

        // Aquire the variable view from the provider
        const coreVariableView = await variableViewProvider.activeVariableView;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const variableView = (coreVariableView as any) as ITestWebviewHost;

        if (variableView) {
            console.log('IANHU Got Variable View');
        } else {
            console.log('IANHU Failed Variable View');
        }

        // Add our message listener
        const onMessageListener = new OnMessageListener(variableView);

        // Send a second cell
        await insertCodeCell('test2 = "MYTESTVALUE2"', { index: 1 });
        const cell2 = vscodeNotebook.activeNotebookEditor?.document.cells![1]!;
        await executeCell(cell2);

        console.log('IANHU Executed Cell 2');

        // Wait until our VariablesComplete message to see that we have the new variables and have rendered them
        await onMessageListener.waitForMessage(InteractiveWindowMessages.VariablesComplete);

        // Trying a screenshot here
        //const imagePath = await screenshot({ filename: 'testShot.jpg' });
        //if (imagePath) {
        //console.log(`IANHU imagePath ${imagePath}`);
        //}
        const displays = await screenshot.listDisplays();
        for (const display of displays) {
            const fileName = `shot${display.id}.jpg`;
            console.log(`IANHU screenshot file name ${fileName}`);
            const result = await screenshot({ filename: fileName, screen: display.id });
            console.log(`IANHU result ${result}`);
        }
        //displays.forEach((display) => {
        //const fileName = `shot${display.id}`;
        //console.log(`IANHU screenshot file name ${fileName}`);
        //await screenshot({ filename: fileName, screen: display.id });
        //});

        const htmlResult = await variableView?.getHTMLById('variable-view-main-panel');

        if (htmlResult) {
            console.log(`IANHU Got html ${htmlResult}`);
        } else {
            console.log('IANHU Failed html result');
        }

        // Parse the HTML for our expected variables
        const expectedVariables = [
            { name: 'test', type: 'str', length: '11', value: ' MYTESTVALUE' },
            { name: 'test2', type: 'str', length: '12', value: ' MYTESTVALUE2' }
        ];
        verifyViewVariables(expectedVariables, htmlResult);
    });
});
