// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import * as sinon from 'sinon';
import { ICommandManager, IVSCodeNotebook } from '../../../client/common/application/types';
import { IDisposable } from '../../../client/common/types';
import { Commands } from '../../../client/datascience/constants';
import { IVariableViewProvider } from '../../../client/datascience/variablesView/types';
import { IExtensionTestApi } from '../../common';
import { initialize, IS_REMOTE_NATIVE_TEST, IS_WEBVIEW_BUILD_SKIPPED } from '../../initialize';
import {
    canRunNotebookTests,
    closeNotebooks,
    closeNotebooksAndCleanUpAfterTests,
    createEmptyPythonNotebook,
    runCell,
    insertCodeCell,
    prewarmNotebooks,
    trustAllNotebooks,
    waitForExecutionCompletedSuccessfully
} from '../notebook/helper';
import { OnMessageListener } from '../vscodeTestHelpers';
import { InteractiveWindowMessages } from '../../../client/datascience/interactive-common/interactiveWindowTypes';
import { verifyViewVariables } from './variableViewHelpers';
import { ITestVariableViewProvider } from './variableViewTestInterfaces';
import { ITestWebviewHost } from '../testInterfaces';
import { traceInfo } from '../../../client/common/logger';

suite('DataScience - VariableView', () => {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let commandManager: ICommandManager;
    let variableViewProvider: ITestVariableViewProvider;
    let vscodeNotebook: IVSCodeNotebook;
    suiteSetup(async function () {
        this.skip();
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
        await trustAllNotebooks();
        await prewarmNotebooks();
        sinon.restore();
        commandManager = api.serviceContainer.get<ICommandManager>(ICommandManager);
        const coreVariableViewProvider = api.serviceContainer.get<IVariableViewProvider>(IVariableViewProvider);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        variableViewProvider = (coreVariableViewProvider as any) as ITestVariableViewProvider; // Cast to expose the test interfaces
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
    });
    setup(async function () {
        this.skip();
        traceInfo(`Start Test ${this.currentTest?.title}`);
        sinon.restore();

        // Create an editor to use for our tests
        await createEmptyPythonNotebook(disposables);
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        this.skip();
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        await closeNotebooks(disposables);
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });

    // Cleanup after suite is finished
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));

    // Test showing the basic variable view with a value or two
    test('Can show VariableView (webview-test)', async function () {
        this.skip();
        // Add one simple cell and execute it
        await insertCodeCell('test = "MYTESTVALUE"', { index: 0 });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cells![0]!;
        await runCell(cell);
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
        await runCell(cell2);

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
