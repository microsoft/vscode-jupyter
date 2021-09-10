// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import * as sinon from 'sinon';
import { ICommandManager, IVSCodeNotebook } from '../../client/common/application/types';
import { IDisposable } from '../../client/common/types';
import { Commands } from '../../client/datascience/constants';
import { IVariableViewProvider } from '../../client/datascience/variablesView/types';
import { IExtensionTestApi, waitForCondition } from '../common';
import { initialize, IS_REMOTE_NATIVE_TEST, IS_WEBVIEW_BUILD_SKIPPED } from '../initialize';
import {
    canRunNotebookTests,
    closeNotebooks,
    closeNotebooksAndCleanUpAfterTests,
    createEmptyPythonNotebook,
    insertCodeCell,
    prewarmNotebooks,
    workAroundVSCodeNotebookStartPages,
    getCellOutputs,
    defaultNotebookTestTimeout,
    waitForStoppedEvent
} from './notebook/helper';
import { verifyViewVariables } from './variableView/variableViewHelpers';
import { ITestVariableViewProvider } from './variableView/variableViewTestInterfaces';
import { traceInfo } from '../../client/common/logger';
import { IDebuggingManager } from '../../client/debugger/types';
import { assert } from 'chai';
import { debug } from 'vscode';
import { OnMessageListener } from './vscodeTestHelpers';
import { KernelDebugAdapter } from '../../client/debugger/jupyter/kernelDebugAdapter';
import { ITestWebviewHost } from './testInterfaces';
import { InteractiveWindowMessages } from '../../client/datascience/interactive-common/interactiveWindowTypes';

suite('VSCode Notebook - Debugging', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let commandManager: ICommandManager;
    let variableViewProvider: ITestVariableViewProvider;
    let vscodeNotebook: IVSCodeNotebook;
    let debuggingManager: IDebuggingManager;
    this.timeout(120_000);
    suiteSetup(async function () {
        traceInfo(`Start Test Suite`);
        this.timeout(120_000);

        // We need to have webviews built to run this, so skip if we don't have them
        if (IS_WEBVIEW_BUILD_SKIPPED) {
            console.log('Debugging tests require webview build to be enabled (for the variable view)');
            return this.skip();
        }

        // Don't run if we can't use the native notebook interface
        if (IS_REMOTE_NATIVE_TEST || !(await canRunNotebookTests())) {
            return this.skip();
        }

        api = await initialize();
        await workAroundVSCodeNotebookStartPages();
        await closeNotebooksAndCleanUpAfterTests(disposables);
        await prewarmNotebooks();
        sinon.restore();
        commandManager = api.serviceContainer.get<ICommandManager>(ICommandManager);
        const coreVariableViewProvider = api.serviceContainer.get<IVariableViewProvider>(IVariableViewProvider);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        variableViewProvider = (coreVariableViewProvider as any) as ITestVariableViewProvider; // Cast to expose the test interfaces
        debuggingManager = api.serviceContainer.get<IDebuggingManager>(IDebuggingManager);
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        traceInfo(`Start Test Suite (completed)`);
    });
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        sinon.restore();

        // Create an editor to use for our tests
        await createEmptyPythonNotebook(disposables);
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        await closeNotebooks(disposables);
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });

    // Cleanup after suite is finished
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));

    test('Run by Line - Full Workflow (webview-test)', async function () {
        await insertCodeCell('a=1\na', { index: 0 });
        const doc = vscodeNotebook.activeNotebookEditor?.document!;
        const cell = doc.getCells()[0];

        void commandManager.executeCommand(Commands.RunByLine, cell);

        await waitForCondition(
            async () => !!debuggingManager.getDebugSession(doc),
            defaultNotebookTestTimeout,
            'DebugSession should start'
        );
        const session = debuggingManager.getDebugSession(doc);

        const debugAdapter = debuggingManager.getDebugAdapter(doc);
        assert.isOk<KernelDebugAdapter | undefined>(debugAdapter, 'DebugAdapter not started');

        const stoppedEvent = await waitForStoppedEvent(debugAdapter!);
        const stack = await session!.customRequest('stackTrace', {
            threadId: stoppedEvent.body.threadId
        });
        assert.isTrue(stack.stackFrames.length > 0, 'has frames');
        assert.equal(stack.stackFrames[0].source?.path, cell.document.uri.toString(), 'Stopped at the wrong path');

        const coreVariableView = await variableViewProvider.activeVariableView;
        const variableView = coreVariableView as unknown as ITestWebviewHost;
        const onMessageListener = new OnMessageListener(variableView);

        void commandManager.executeCommand(Commands.RunByLineContinue, cell);
        await waitForStoppedEvent(debugAdapter!);
        await onMessageListener.waitForMessage(InteractiveWindowMessages.VariablesComplete);

        const htmlResult = await variableView?.getHTMLById('variable-view-main-panel');
        const expectedVariables = [{ name: 'a', type: 'int', length: '', value: '1' }];
        verifyViewVariables(expectedVariables, htmlResult);

        await commandManager.executeCommand(Commands.RunByLineContinue, cell);
        await waitForCondition(
            async () => !debug.activeDebugSession,
            defaultNotebookTestTimeout,
            'DebugSession should end'
        );
        await waitForCondition(
            async () => !!cell.outputs.length,
            defaultNotebookTestTimeout,
            'Cell should have output'
        );
        assert.isTrue(getCellOutputs(cell).includes('1'));
    });

    test('Run by Line - Interrupt', async function () {
        await insertCodeCell('a=1\na', { index: 0 });
        const doc = vscodeNotebook.activeNotebookEditor?.document!;
        const cell = doc.getCells()[0];

        void commandManager.executeCommand(Commands.RunByLine, cell);

        await waitForCondition(
            async () => !!debuggingManager.getDebugSession(doc),
            defaultNotebookTestTimeout,
            'DebugSession should start'
        );

        const debugAdapter = debuggingManager.getDebugAdapter(doc);
        assert.isOk<KernelDebugAdapter | undefined>(debugAdapter, 'DebugAdapter not started');

        await waitForStoppedEvent(debugAdapter!);

        // Interrupt kernel and check that the cell didn't finish running
        await commandManager.executeCommand(Commands.InterruptKernel, { notebookEditor: { notebookUri: doc.uri } });
        await waitForCondition(
            async () => !debug.activeDebugSession,
            defaultNotebookTestTimeout,
            'DebugSession should end'
        );
        await waitForCondition(
            async () => getCellOutputs(cell).includes('KeyboardInterrupt'),
            defaultNotebookTestTimeout,
            'Cell should have KeyboardInterrupt output'
        );
    });
});
