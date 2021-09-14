// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { assert } from 'chai';
import * as sinon from 'sinon';
import { ICommandManager, IVSCodeNotebook } from '../../../client/common/application/types';
import { IDisposable } from '../../../client/common/types';
import { Commands } from '../../../client/datascience/constants';
import { IVariableViewProvider } from '../../../client/datascience/variablesView/types';
import { IExtensionTestApi } from '../../common';
import { initialize, IS_REMOTE_NATIVE_TEST, IS_WEBVIEW_BUILD_SKIPPED } from '../../initialize';
import {
    canRunNotebookTests,
    closeNotebooksAndCleanUpAfterTests,
    createEmptyPythonNotebook,
    runCell,
    insertCodeCell,
    waitForExecutionCompletedSuccessfully,
    workAroundVSCodeNotebookStartPages,
    startJupyterServer
} from '../notebook/helper';
import { OnMessageListener } from '../vscodeTestHelpers';
import { InteractiveWindowMessages } from '../../../client/datascience/interactive-common/interactiveWindowTypes';
import { verifyViewVariables } from './variableViewHelpers';
import { ITestVariableViewProvider } from './variableViewTestInterfaces';
import { ITestWebviewHost } from '../testInterfaces';
import { traceInfo } from '../../../client/common/logger';

suite('DataScience - VariableView', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
    let commandManager: ICommandManager;
    let variableViewProvider: ITestVariableViewProvider;
    this.timeout(120_000);
    suiteSetup(async function () {
        traceInfo('Suite Setup');
        this.timeout(120_000);
        api = await initialize();

        // We need to have webviews built to run this, so skip if we don't have them
        if (IS_WEBVIEW_BUILD_SKIPPED) {
            console.log('Variable view tests require webview build to be enabled');
            return this.skip();
        }

        // Don't run if we can't use the native notebook interface
        if (IS_REMOTE_NATIVE_TEST || !(await canRunNotebookTests())) {
            return this.skip();
        }

        await workAroundVSCodeNotebookStartPages();
        sinon.restore();
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        commandManager = api.serviceContainer.get<ICommandManager>(ICommandManager);
        const coreVariableViewProvider = api.serviceContainer.get<IVariableViewProvider>(IVariableViewProvider);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        variableViewProvider = (coreVariableViewProvider as any) as ITestVariableViewProvider; // Cast to expose the test interfaces
        traceInfo('Suite Setup (completed)');
    });
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        sinon.restore();
        await startJupyterServer();
        await createEmptyPythonNotebook(disposables);
        assert.isOk(vscodeNotebook.activeNotebookEditor, 'No active notebook');
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));

    // Test for basic variable view functionality with one document
    test('Can show VariableView (webview-test)', async function () {
        // Send the command to open the view
        await commandManager.executeCommand(Commands.OpenVariableView);

        // Aquire the variable view from the provider
        const coreVariableView = await variableViewProvider.activeVariableView;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const variableView = (coreVariableView as any) as ITestWebviewHost;

        // Add our message listener
        const onMessageListener = new OnMessageListener(variableView);

        // We get one initial refresh of the variables, then a refresh for each cell executed
        const variablesPromise = onMessageListener.waitForMessage(InteractiveWindowMessages.VariablesComplete, {
            numberOfTimes: 3
        });

        // Add one simple cell and execute it
        await insertCodeCell('test = "MYTESTVALUE"', { index: 0 });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;
        await runCell(cell);
        await waitForExecutionCompletedSuccessfully(cell);

        // Send a second cell
        await insertCodeCell('test2 = "MYTESTVALUE2"', { index: 1 });
        const cell2 = vscodeNotebook.activeNotebookEditor?.document.getCells()![1]!;
        await runCell(cell2);

        // Wait for the expected variable updates
        await variablesPromise;

        const htmlResult = await variableView?.getHTMLById('variable-view-main-panel');

        // Parse the HTML for our expected variables
        const expectedVariables = [
            { name: 'test', type: 'str', length: '11', value: ' MYTESTVALUE' },
            { name: 'test2', type: 'str', length: '12', value: ' MYTESTVALUE2' }
        ];
        verifyViewVariables(expectedVariables, htmlResult);
    });

    // Test variables switching between documents
    test('VariableView document switching (webview-test)', async function () {
        // Send the command to open the view
        await commandManager.executeCommand(Commands.OpenVariableView);

        // Aquire the variable view from the provider
        const coreVariableView = await variableViewProvider.activeVariableView;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const variableView = (coreVariableView as any) as ITestWebviewHost;

        // Add our message listener
        const onMessageListener = new OnMessageListener(variableView);

        // One intitial refresh, and one cell executed
        let variablesPromise = onMessageListener.waitForMessage(InteractiveWindowMessages.VariablesComplete, {
            numberOfTimes: 2
        });

        // Add one simple cell and execute it
        await insertCodeCell('test = "MYTESTVALUE"', { index: 0 });
        const cell = vscodeNotebook.activeNotebookEditor?.document.getCells()![0]!;
        await Promise.all([runCell(cell), waitForExecutionCompletedSuccessfully(cell)]);

        await variablesPromise;

        const htmlResult = await variableView?.getHTMLById('variable-view-main-panel');

        // Parse the HTML for our expected variables
        const expectedVariables = [{ name: 'test', type: 'str', length: '11', value: ' MYTESTVALUE' }];
        verifyViewVariables(expectedVariables, htmlResult);

        // Expect just a refresh on the next transition
        variablesPromise = onMessageListener.waitForMessage(InteractiveWindowMessages.VariablesComplete, {
            numberOfTimes: 1
        });

        // Now create a second document
        await createEmptyPythonNotebook(disposables);

        await variablesPromise;

        // Verify that the view is empty
        const emptyHtmlResult = await variableView?.getHTMLById('variable-view-main-panel');
        verifyViewVariables([], emptyHtmlResult);

        // We expect two cells to update
        variablesPromise = onMessageListener.waitForMessage(InteractiveWindowMessages.VariablesComplete, {
            numberOfTimes: 2
        });

        // Execute a cell on the second document
        await insertCodeCell('test2 = "MYTESTVALUE2"', { index: 0 });
        const cell2 = vscodeNotebook.activeNotebookEditor?.document.getCells()![0]!;
        await Promise.all([runCell(cell2), waitForExecutionCompletedSuccessfully(cell2)]);

        // Execute a second cell on the second document
        await insertCodeCell('test3 = "MYTESTVALUE3"', { index: 1 });
        const cell3 = vscodeNotebook.activeNotebookEditor?.document.getCells()![1]!;
        await Promise.all([runCell(cell3), waitForExecutionCompletedSuccessfully(cell3)]);

        // Wait until our VariablesComplete message to see that we have the new variables and have rendered them
        await variablesPromise;

        const htmlResult2 = await variableView?.getHTMLById('variable-view-main-panel');

        // Parse the HTML for our expected variables
        const expectedVariables2 = [
            { name: 'test2', type: 'str', length: '12', value: ' MYTESTVALUE2' },
            { name: 'test3', type: 'str', length: '12', value: ' MYTESTVALUE3' }
        ];
        verifyViewVariables(expectedVariables2, htmlResult2);
    });
});
