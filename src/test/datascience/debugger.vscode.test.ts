// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import * as sinon from 'sinon';
import { ICommandManager, IVSCodeNotebook } from '../../platform/common/application/types';
import { IDisposable } from '../../platform/common/types';
import { captureScreenShot, IExtensionTestApi, waitForCondition } from '../common';
import { initialize, IS_REMOTE_NATIVE_TEST } from '../initialize';
import {
    closeNotebooks,
    closeNotebooksAndCleanUpAfterTests,
    createEmptyPythonNotebook,
    insertCodeCell,
    prewarmNotebooks,
    workAroundVSCodeNotebookStartPages,
    getCellOutputs,
    defaultNotebookTestTimeout,
    waitForStoppedEvent,
    runCell,
    getDebugSessionAndAdapter
} from './notebook/helper';
import { ITestVariableViewProvider } from './variableView/variableViewTestInterfaces';
import { traceInfo } from '../../platform/common/logger';
import { IDebuggingManager } from '../../platform/debugger/types';
import { assert } from 'chai';
import { debug } from 'vscode';
import { ITestWebviewHost } from './testInterfaces';
import { DebugProtocol } from 'vscode-debugprotocol';
import { waitForVariablesToMatch } from './variableView/variableViewHelpers';
import { Commands } from '../../platform/common/constants';
import { IVariableViewProvider } from '../../webviews/extension-side/variablesView/types';

suite('VSCode Notebook - Run By Line', function () {
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
        // Don't run if we can't use the native notebook interface
        if (IS_REMOTE_NATIVE_TEST) {
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
        if (this.currentTest?.isFailed()) {
            // For a flaky interrupt test.
            await captureScreenShot(`Debugger-Tests-${this.currentTest?.title}`);
        }
        await closeNotebooks(disposables);
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });

    // Cleanup after suite is finished
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));

    test('Stops at end of cell', async function () {
        // See issue: https://github.com/microsoft/vscode-jupyter/issues/9130
        this.skip();
        // Run by line seems to end up on the second line of the function, not the first
        const cell = await insertCodeCell('a=1\na', { index: 0 });
        const doc = vscodeNotebook.activeNotebookEditor?.document!;
        traceInfo(`Inserted cell`);

        await commandManager.executeCommand(Commands.RunByLine, cell);
        traceInfo(`Executed run by line`);
        const { debugAdapter, session } = await getDebugSessionAndAdapter(debuggingManager, doc);

        const stoppedEvent = await waitForStoppedEvent(debugAdapter!);
        const stack = await session!.customRequest('stackTrace', {
            threadId: stoppedEvent.body.threadId
        });
        assert.isTrue(stack.stackFrames.length > 0, 'has frames');
        assert.equal(stack.stackFrames[0].source?.path, cell.document.uri.toString(), 'Stopped at the wrong path');
        traceInfo(`Got past first stop event`);

        const coreVariableView = await variableViewProvider.activeVariableView;
        const variableView = (coreVariableView as unknown) as ITestWebviewHost;

        await commandManager.executeCommand(Commands.RunByLineNext, cell);
        await waitForStoppedEvent(debugAdapter!);
        traceInfo(`Got past second stop event`);

        const expectedVariables = [{ name: 'a', type: 'int', length: '', value: '1' }];
        await waitForVariablesToMatch(expectedVariables, variableView);

        await commandManager.executeCommand(Commands.RunByLineNext, cell);
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
        traceInfo(`Got past third stop event`);

        assert.isTrue(getCellOutputs(cell).includes('1'));
    });

    test('Interrupt during debugging', async function () {
        const cell = await insertCodeCell('a=1\na', { index: 0 });
        const doc = vscodeNotebook.activeNotebookEditor?.document!;

        await commandManager.executeCommand(Commands.RunByLine, cell);
        const { debugAdapter } = await getDebugSessionAndAdapter(debuggingManager, doc);

        await waitForStoppedEvent(debugAdapter!);

        // Interrupt kernel and check we finished
        await commandManager.executeCommand(Commands.InterruptKernel, { notebookEditor: { notebookUri: doc.uri } });
        await waitForCondition(
            async () => !debug.activeDebugSession,
            defaultNotebookTestTimeout,
            'DebugSession should end'
        );
    });

    test('Stops in same-cell function called from last line', async function () {
        // See https://github.com/microsoft/vscode-jupyter/issues/9130
        this.skip();
        const cell = await insertCodeCell('def foo():\n    print(1)\n\nfoo()', { index: 0 });
        const doc = vscodeNotebook.activeNotebookEditor?.document!;

        await commandManager.executeCommand(Commands.RunByLine, cell);
        const { debugAdapter, session } = await getDebugSessionAndAdapter(debuggingManager, doc);

        await waitForStoppedEvent(debugAdapter!); // First line
        await commandManager.executeCommand(Commands.RunByLineNext, cell);
        await waitForStoppedEvent(debugAdapter!); // foo()
        await commandManager.executeCommand(Commands.RunByLineNext, cell);
        await waitForStoppedEvent(debugAdapter!); // def foo
        await commandManager.executeCommand(Commands.RunByLineNext, cell);
        const stoppedEvent = await waitForStoppedEvent(debugAdapter!); // print(1)
        const stack: DebugProtocol.StackTraceResponse['body'] = await session!.customRequest('stackTrace', {
            threadId: stoppedEvent.body.threadId
        });
        assert.isTrue(stack.stackFrames.length > 0, 'has frames');
        assert.equal(stack.stackFrames[0].source?.path, cell.document.uri.toString(), 'Stopped at the wrong path');
        assert.equal(stack.stackFrames[0].line, 2, 'Stopped at the wrong line');

        await commandManager.executeCommand(Commands.RunByLineNext, cell);
        const stoppedEvent2 = await waitForStoppedEvent(debugAdapter!); // foo()
        const stack2: DebugProtocol.StackTraceResponse['body'] = await session!.customRequest('stackTrace', {
            threadId: stoppedEvent2.body.threadId
        });
        assert.isTrue(stack2.stackFrames.length > 0, 'has frames');
        assert.equal(stack2.stackFrames[0].source?.path, cell.document.uri.toString(), 'Stopped at the wrong path');
        assert.equal(stack2.stackFrames[0].line, 4, 'Stopped at the wrong line');
    });

    test.skip('Does not stop in other cell', async function () {
        // https://github.com/microsoft/vscode-jupyter/issues/8757
        const cell0 = await insertCodeCell('def foo():\n    print(1)');
        const cell1 = await insertCodeCell('foo()');
        const doc = vscodeNotebook.activeNotebookEditor?.document!;

        await runCell(cell0);
        await commandManager.executeCommand(Commands.RunByLine, cell1);
        const { debugAdapter } = await getDebugSessionAndAdapter(debuggingManager, doc);

        await waitForStoppedEvent(debugAdapter!); // First line
        await commandManager.executeCommand(Commands.RunByLineNext, cell1);

        await waitForStoppedEvent(debugAdapter!); // Returns after call
        await commandManager.executeCommand(Commands.RunByLineNext, cell1);

        await waitForCondition(
            async () => !debug.activeDebugSession,
            defaultNotebookTestTimeout,
            'DebugSession should end'
        );
    });

    test.skip('Run a second time after interrupt', async function () {
        // https://github.com/microsoft/vscode-jupyter/issues/8753
        await insertCodeCell(
            'import time\nfor i in range(0,50):\n  time.sleep(.1)\n  print("sleepy")\nprint("final output")',
            {
                index: 0
            }
        );
        const doc = vscodeNotebook.activeNotebookEditor?.document!;
        const cell = doc.getCells()[0];

        void commandManager.executeCommand(Commands.RunByLine, cell);
        const { debugAdapter } = await getDebugSessionAndAdapter(debuggingManager, doc);

        await waitForStoppedEvent(debugAdapter!);

        // Interrupt kernel and check that the cell didn't finish running
        await commandManager.executeCommand(Commands.InterruptKernel, { notebookEditor: { notebookUri: doc.uri } });
        await waitForCondition(
            async () => !debug.activeDebugSession,
            defaultNotebookTestTimeout,
            'DebugSession should end1'
        );
        assert.isFalse(getCellOutputs(cell).includes('final output'), `Final line did run even with an interrupt`);

        // Start over and make sure we can execute all lines
        void commandManager.executeCommand(Commands.RunByLine, cell);
        const { debugAdapter: debugAdapter2 } = await getDebugSessionAndAdapter(debuggingManager, doc);
        await waitForStoppedEvent(debugAdapter2!);
        await waitForCondition(
            async () => {
                await commandManager.executeCommand(Commands.RunByLineNext, cell);
                await waitForStoppedEvent(debugAdapter2!);
                return getCellOutputs(cell).includes('sleepy');
            },
            defaultNotebookTestTimeout,
            'Print during time loop is not working'
        );
        await commandManager.executeCommand(Commands.RunByLineStop);
        await waitForCondition(
            async () => !debug.activeDebugSession,
            defaultNotebookTestTimeout,
            'DebugSession should end2'
        );
    });
});
