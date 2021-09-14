// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { assert } from 'chai';
import * as sinon from 'sinon';
import { IVSCodeNotebook } from '../../../client/common/application/types';
import { IDisposable } from '../../../client/common/types';
import { IExtensionTestApi } from '../../common';
import { initialize } from '../../initialize';
import {
    canRunNotebookTests,
    closeNotebooksAndCleanUpAfterTests,
    createEmptyPythonNotebook,
    workAroundVSCodeNotebookStartPages,
    startJupyterServer
} from '../notebook/helper';
import { traceInfo } from '../../../client/common/logger';

// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
'use strict';
// import { assert } from 'chai';
// import * as sinon from 'sinon';
// import { ICommandManager, IVSCodeNotebook } from '../../../client/common/application/types';
// import { IDisposable, Product } from '../../../client/common/types';
// import { Commands } from '../../../client/datascience/constants';
// import { IVariableViewProvider } from '../../../client/datascience/variablesView/types';
// import { IExtensionTestApi } from '../../common';
// import { initialize, IS_REMOTE_NATIVE_TEST, IS_WEBVIEW_BUILD_SKIPPED } from '../../initialize';
// import {
// canRunNotebookTests,
// closeNotebooks,
// closeNotebooksAndCleanUpAfterTests,
// createEmptyPythonNotebook,
// runCell,
// insertCodeCell,
// prewarmNotebooks,
// waitForExecutionCompletedSuccessfully,
// workAroundVSCodeNotebookStartPages,
// hijackPrompt,
// startJupyterServer
// } from '../notebook/helper';
// import { OnMessageListener } from '../vscodeTestHelpers';
// import { InteractiveWindowMessages } from '../../../client/datascience/interactive-common/interactiveWindowTypes';
// import { verifyViewVariables } from './variableViewHelpers';
// import { ITestVariableViewProvider } from './variableViewTestInterfaces';
// import { ITestWebviewHost } from '../testInterfaces';
// import { traceInfo } from '../../../client/common/logger';
// import { ProductNames } from '../../../client/common/installer/productNames';
// import { Common } from '../../../client/common/utils/localize';

// // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
// const expectedPromptMessageSuffix = `requires ${ProductNames.get(Product.ipykernel)!} to be installed.`;

suite('DataScience - VariableView', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
    this.timeout(120_000);
    suiteSetup(async function () {
        traceInfo('Suite Setup');
        this.timeout(120_000);
        api = await initialize();
        if (!(await canRunNotebookTests())) {
            return this.skip();
        }
        await workAroundVSCodeNotebookStartPages();
        // await hijackPrompt(
        // 'showErrorMessage',
        // { endsWith: expectedPromptMessageSuffix },
        // { text: Common.install(), clickImmediately: true },
        // disposables
        // );

        // await startJupyterServer();
        // await prewarmNotebooks();
        sinon.restore();
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
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
        // Added temporarily to identify why tests are failing.
        process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT = undefined;
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));
    test('IANHU Can show VariableView (webview-test)', async function () {
        assert.isFalse(true, 'Should Fail');
    });
});

// suite('DataScience - VariableView', function () {
// let api: IExtensionTestApi;
// const disposables: IDisposable[] = [];
// let commandManager: ICommandManager;
// let variableViewProvider: ITestVariableViewProvider;
// let vscodeNotebook: IVSCodeNotebook;
// this.timeout(240_000);
// suiteSetup(async function () {
// traceInfo('Start Test Suite');
// this.timeout(240_000);
// api = await initialize();

// // We need to have webviews built to run this, so skip if we don't have them
// if (IS_WEBVIEW_BUILD_SKIPPED) {
// console.log('Variable view tests require webview build to be enabled');
// return this.skip();
// }

// console.log('IANHU a');

// // Don't run if we can't use the native notebook interface
// if (IS_REMOTE_NATIVE_TEST || !(await canRunNotebookTests())) {
// return this.skip();
// }
// await workAroundVSCodeNotebookStartPages();
// await hijackPrompt(
// 'showErrorMessage',
// { endsWith: expectedPromptMessageSuffix },
// { text: Common.install(), clickImmediately: true },
// disposables
// );
// //await closeNotebooksAndCleanUpAfterTests(disposables);
// console.log('IANHU b');
// //await sleep(5_000);
// await startJupyterServer();
// await prewarmNotebooks();
// console.log('IANHU c');
// sinon.restore();
// commandManager = api.serviceContainer.get<ICommandManager>(ICommandManager);
// const coreVariableViewProvider = api.serviceContainer.get<IVariableViewProvider>(IVariableViewProvider);
// // eslint-disable-next-line @typescript-eslint/no-explicit-any
// variableViewProvider = (coreVariableViewProvider as any) as ITestVariableViewProvider; // Cast to expose the test interfaces
// vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
// console.log('IANHU d');
// traceInfo(`Start Test Suite (completed)`);
// });
// setup(async function () {
// traceInfo(`Start Test ${this.currentTest?.title}`);
// console.log('IANHU e');
// sinon.restore();

// // Create an editor to use for our tests
// await startJupyterServer();
// await createEmptyPythonNotebook(disposables);
// console.log('IANHU f');
// traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
// });
// teardown(async function () {
// traceInfo(`Ended Test ${this.currentTest?.title}`);
// await closeNotebooks(disposables);
// await closeNotebooksAndCleanUpAfterTests(disposables);
// traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
// });

// // Cleanup after suite is finished
// suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));

// test('Can show VariableView (webview-test)', async function () {
// console.log('IANHU g');
// // Send the command to open the view
// await commandManager.executeCommand(Commands.OpenVariableView);

// // Aquire the variable view from the provider
// const coreVariableView = await variableViewProvider.activeVariableView;
// // eslint-disable-next-line @typescript-eslint/no-explicit-any
// const variableView = (coreVariableView as any) as ITestWebviewHost;

// // Add our message listener
// const onMessageListener = new OnMessageListener(variableView);

// // We get one initial refresh of the variables, then a refresh for each cell executed
// const variablesPromise = onMessageListener.waitForMessage(InteractiveWindowMessages.VariablesComplete, {
// numberOfTimes: 3
// });

// // Add one simple cell and execute it
// await insertCodeCell('test = "MYTESTVALUE"', { index: 0 });
// const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;
// await runCell(cell);
// await waitForExecutionCompletedSuccessfully(cell);

// // Send a second cell
// await insertCodeCell('test2 = "MYTESTVALUE2"', { index: 1 });
// const cell2 = vscodeNotebook.activeNotebookEditor?.document.getCells()![1]!;
// await runCell(cell2);

// // Wait for the expected variable updates
// await variablesPromise;

// const htmlResult = await variableView?.getHTMLById('variable-view-main-panel');

// // Parse the HTML for our expected variables
// const expectedVariables = [
// { name: 'test', type: 'str', length: '11', value: ' MYTESTVALUE' },
// { name: 'test2', type: 'str', length: '12', value: ' MYTESTVALUE2' }
// ];
// verifyViewVariables(expectedVariables, htmlResult);
// });

// test('VariableView document switching (webview-test)', async function () {
// // Send the command to open the view
// await commandManager.executeCommand(Commands.OpenVariableView);

// // Aquire the variable view from the provider
// const coreVariableView = await variableViewProvider.activeVariableView;
// // eslint-disable-next-line @typescript-eslint/no-explicit-any
// const variableView = (coreVariableView as any) as ITestWebviewHost;

// // Add our message listener
// const onMessageListener = new OnMessageListener(variableView);

// // One intitial refresh, and one cell executed
// let variablesPromise = onMessageListener.waitForMessage(InteractiveWindowMessages.VariablesComplete, {
// numberOfTimes: 2
// });

// // Add one simple cell and execute it
// await insertCodeCell('test = "MYTESTVALUE"', { index: 0 });
// const cell = vscodeNotebook.activeNotebookEditor?.document.getCells()![0]!;
// await Promise.all([runCell(cell), waitForExecutionCompletedSuccessfully(cell)]);

// await variablesPromise;

// const htmlResult = await variableView?.getHTMLById('variable-view-main-panel');

// // Parse the HTML for our expected variables
// const expectedVariables = [{ name: 'test', type: 'str', length: '11', value: ' MYTESTVALUE' }];
// verifyViewVariables(expectedVariables, htmlResult);

// // Expect just a refresh on the next transition
// variablesPromise = onMessageListener.waitForMessage(InteractiveWindowMessages.VariablesComplete, {
// numberOfTimes: 1
// });

// // Now create a second document
// await createEmptyPythonNotebook(disposables);

// await variablesPromise;

// // Verify that the view is empty
// const emptyHtmlResult = await variableView?.getHTMLById('variable-view-main-panel');
// verifyViewVariables([], emptyHtmlResult);

// // We expect two cells to update
// variablesPromise = onMessageListener.waitForMessage(InteractiveWindowMessages.VariablesComplete, {
// numberOfTimes: 2
// });

// // Execute a cell on the second document
// await insertCodeCell('test2 = "MYTESTVALUE2"', { index: 0 });
// const cell2 = vscodeNotebook.activeNotebookEditor?.document.getCells()![0]!;
// await Promise.all([runCell(cell2), waitForExecutionCompletedSuccessfully(cell2)]);

// // Execute a second cell on the second document
// await insertCodeCell('test3 = "MYTESTVALUE3"', { index: 1 });
// const cell3 = vscodeNotebook.activeNotebookEditor?.document.getCells()![1]!;
// await Promise.all([runCell(cell3), waitForExecutionCompletedSuccessfully(cell3)]);

// // Wait until our VariablesComplete message to see that we have the new variables and have rendered them
// await variablesPromise;

// const htmlResult2 = await variableView?.getHTMLById('variable-view-main-panel');

// // Parse the HTML for our expected variables
// const expectedVariables2 = [
// { name: 'test2', type: 'str', length: '12', value: ' MYTESTVALUE2' },
// { name: 'test3', type: 'str', length: '12', value: ' MYTESTVALUE3' }
// ];
// verifyViewVariables(expectedVariables2, htmlResult2);
// });
// });
