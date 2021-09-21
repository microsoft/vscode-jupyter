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
import { waitForVariablesToMatch } from './variableViewHelpers';
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

        // Add one simple cell and execute it
        await insertCodeCell('test = "MYTESTVALUE"', { index: 0 });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;
        await runCell(cell);
        await waitForExecutionCompletedSuccessfully(cell);

        // Send a second cell
        await insertCodeCell('test2 = "MYTESTVALUE2"', { index: 1 });
        const cell2 = vscodeNotebook.activeNotebookEditor?.document.getCells()![1]!;
        await runCell(cell2);

        // Parse the HTML for our expected variables
        const expectedVariables = [
            { name: 'test', type: 'str', length: '11', value: ' MYTESTVALUE' },
            { name: 'test2', type: 'str', length: '12', value: ' MYTESTVALUE2' }
        ];
        await waitForVariablesToMatch(expectedVariables, variableView);
    });

    // Test variables switching between documents
    test('VariableView document switching (webview-test)', async function () {
        // Send the command to open the view
        await commandManager.executeCommand(Commands.OpenVariableView);

        // Aquire the variable view from the provider
        const coreVariableView = await variableViewProvider.activeVariableView;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const variableView = (coreVariableView as any) as ITestWebviewHost;

        // Add one simple cell and execute it
        await insertCodeCell('test = "MYTESTVALUE"', { index: 0 });
        const cell = vscodeNotebook.activeNotebookEditor?.document.getCells()![0]!;
        await Promise.all([runCell(cell), waitForExecutionCompletedSuccessfully(cell)]);

        // Parse the HTML for our expected variables
        const expectedVariables = [{ name: 'test', type: 'str', length: '11', value: ' MYTESTVALUE' }];
        await waitForVariablesToMatch(expectedVariables, variableView);

        // Now create a second document
        await createEmptyPythonNotebook(disposables);

        // Verify that the view is empty
        await waitForVariablesToMatch([], variableView);

        // Execute a cell on the second document
        await insertCodeCell('test2 = "MYTESTVALUE2"', { index: 0 });
        const cell2 = vscodeNotebook.activeNotebookEditor?.document.getCells()![0]!;
        await Promise.all([runCell(cell2), waitForExecutionCompletedSuccessfully(cell2)]);

        // Execute a second cell on the second document
        await insertCodeCell('test3 = "MYTESTVALUE3"', { index: 1 });
        const cell3 = vscodeNotebook.activeNotebookEditor?.document.getCells()![1]!;
        await Promise.all([runCell(cell3), waitForExecutionCompletedSuccessfully(cell3)]);

        // Parse the HTML for our expected variables
        const expectedVariables2 = [
            { name: 'test2', type: 'str', length: '12', value: ' MYTESTVALUE2' },
            { name: 'test3', type: 'str', length: '12', value: ' MYTESTVALUE3' }
        ];
        await waitForVariablesToMatch(expectedVariables2, variableView);
    });
});
