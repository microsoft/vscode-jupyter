// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { assert } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as sinon from 'sinon';
import { debug } from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { IControllerDefaultService } from '../../notebooks/controllers/types';
import { IDebuggingManager, INotebookDebuggingManager } from '../../notebooks/debugger/debuggingTypes';
import { ICommandManager, IVSCodeNotebook } from '../../platform/common/application/types';
import { Commands } from '../../platform/common/constants';
import { IDisposable } from '../../platform/common/types';
import { isWeb } from '../../platform/common/utils/misc';
import { traceInfo } from '../../platform/logging';
import * as path from '../../platform/vscode-path/path';
import { IVariableViewProvider } from '../../webviews/extension-side/variablesView/types';
import { captureScreenShot, IExtensionTestApi, waitForCondition } from '../common.node';
import { noop, sleep } from '../core';
import { initialize, IS_REMOTE_NATIVE_TEST } from '../initialize.node';
import {
    closeNotebooks,
    closeNotebooksAndCleanUpAfterTests,
    createEmptyPythonNotebook,
    defaultNotebookTestTimeout,
    getCellOutputs,
    getDebugSessionAndAdapter,
    insertCodeCell,
    prewarmNotebooks,
    runCell,
    waitForStoppedEvent
} from './notebook/helper.node';
import { ITestWebviewHost } from './testInterfaces';
import { waitForVariablesToMatch } from './variableView/variableViewHelpers';
import { ITestVariableViewProvider } from './variableView/variableViewTestInterfaces';

suite('Run By Line @debugger', function () {
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
        if (IS_REMOTE_NATIVE_TEST()) {
            return this.skip();
        }

        api = await initialize();
        await closeNotebooksAndCleanUpAfterTests(disposables);
        await prewarmNotebooks();
        sinon.restore();
        commandManager = api.serviceContainer.get<ICommandManager>(ICommandManager);
        const coreVariableViewProvider = api.serviceContainer.get<IVariableViewProvider>(IVariableViewProvider);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        variableViewProvider = coreVariableViewProvider as any as ITestVariableViewProvider; // Cast to expose the test interfaces
        debuggingManager = api.serviceContainer.get<IDebuggingManager>(INotebookDebuggingManager);
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        traceInfo(`Start Test Suite (completed)`);
    });
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        sinon.restore();

        if (!isWeb() && !IS_REMOTE_NATIVE_TEST()) {
            await api.serviceContainer
                .get<IControllerDefaultService>(IControllerDefaultService)
                .computeDefaultController(undefined, 'jupyter-notebook');
        }

        // Create an editor to use for our tests
        await createEmptyPythonNotebook(disposables);
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        if (this.currentTest?.isFailed()) {
            // For a flaky interrupt test.
            await captureScreenShot(this);
        }
        await closeNotebooks(disposables);
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });

    // Cleanup after suite is finished
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));

    test('Delete temp debugging files', async function () {
        let tempWatcher;
        let folderName;
        try {
            tempWatcher = fs.watch(os.tmpdir(), (_event, filename) => {
                // The folder ipykernel creates is always in tmp starting with ipykernel_
                if (filename.startsWith('ipykernel_')) {
                    folderName = filename;
                }
            });

            const cell = await insertCodeCell('a=1\na', { index: 0 });
            const doc = vscodeNotebook.activeNotebookEditor?.notebook!;
            traceInfo(`Inserted cell`);

            await commandManager.executeCommand(Commands.RunByLine, cell);
            traceInfo(`Executed run by line`);
            const { debugAdapter } = await getDebugSessionAndAdapter(debuggingManager, doc);

            // Make sure that we stop to dump the files
            await waitForStoppedEvent(debugAdapter!);

            // Go head and run to the end now
            await commandManager.executeCommand(Commands.RunByLineStop, cell);

            // Wait until we have finished and have output
            await waitForCondition(
                async () => !!cell.outputs.length,
                defaultNotebookTestTimeout,
                'Cell should have output'
            );

            // Give the files a quick chance to clean up
            await sleep(3000);

            // Now that we have finished the temp directory should be empty
            assert.isDefined(folderName, 'Failed to create an ipykernel debug temp folder');
            if (folderName) {
                const tempFiles = fs.readdirSync(path.join(os.tmpdir(), folderName));
                assert.isEmpty(tempFiles, 'Failed to delete temp debugging files');
            }
        } finally {
            // Close off our file watcher
            tempWatcher && tempWatcher.close();
        }
    });

    test.skip('Stops at end of cell', async function () {
        // Run by line seems to end up on the second line of the function, not the first
        const cell = await insertCodeCell('a=1\na', { index: 0 });
        const doc = vscodeNotebook.activeNotebookEditor?.notebook!;
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
        const variableView = coreVariableView as unknown as ITestWebviewHost;

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
        const doc = vscodeNotebook.activeNotebookEditor?.notebook!;

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
        const cell = await insertCodeCell('def foo():\n    print(1)\n\nfoo()', { index: 0 });
        const doc = vscodeNotebook.activeNotebookEditor?.notebook!;

        await commandManager.executeCommand(Commands.RunByLine, cell);
        const { debugAdapter, session } = await getDebugSessionAndAdapter(debuggingManager, doc);

        await waitForStoppedEvent(debugAdapter!); // First line
        await commandManager.executeCommand(Commands.RunByLineNext, cell);
        await waitForStoppedEvent(debugAdapter!); // foo()
        await commandManager.executeCommand(Commands.RunByLineNext, cell);
        const stoppedEvent = await waitForStoppedEvent(debugAdapter!); // print(1) inside def foo
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

    test('Restart while debugging', async function () {
        const cell = await insertCodeCell('def foo():\n    print(1)\n\nfoo()', { index: 0 });
        const doc = vscodeNotebook.activeNotebookEditor?.notebook!;

        await commandManager.executeCommand(Commands.RunByLine, cell);
        const { debugAdapter, session } = await getDebugSessionAndAdapter(debuggingManager, doc);
        await waitForStoppedEvent(debugAdapter!); // First line
        await commandManager.executeCommand('workbench.action.debug.restart');
        const { debugAdapter: debugAdapter2, session: session2 } = await getDebugSessionAndAdapter(
            debuggingManager,
            doc,
            session.id
        );
        const stoppedEvent = await waitForStoppedEvent(debugAdapter2!); // First line
        const stack: DebugProtocol.StackTraceResponse['body'] = await session2!.customRequest('stackTrace', {
            threadId: stoppedEvent.body.threadId
        });
        assert.isTrue(stack.stackFrames.length > 0, 'has frames');
        assert.equal(stack.stackFrames[0].source?.path, cell.document.uri.toString(), 'Stopped at the wrong path');
        assert.equal(stack.stackFrames[0].line, 1, 'Stopped at the wrong line');
    });

    test.skip('Does not stop in other cell', async function () {
        // https://github.com/microsoft/vscode-jupyter/issues/8757
        const cell0 = await insertCodeCell('def foo():\n    print(1)');
        const cell1 = await insertCodeCell('foo()');
        const doc = vscodeNotebook.activeNotebookEditor?.notebook!;

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
        // https://github.com/microsoft/vscode-jupyter/issues/11245
        await insertCodeCell(
            'import time\nfor i in range(0,50):\n  time.sleep(.1)\n  print("sleepy")\nprint("final " + "output")',
            {
                index: 0
            }
        );
        const doc = vscodeNotebook.activeNotebookEditor?.notebook!;
        const cell = doc.getCells()[0];

        commandManager.executeCommand(Commands.RunByLine, cell).then(noop, noop);
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
        commandManager.executeCommand(Commands.RunByLine, cell).then(noop, noop);
        const { debugAdapter: debugAdapter2 } = await getDebugSessionAndAdapter(debuggingManager, doc);
        await waitForStoppedEvent(debugAdapter2!);
        await waitForCondition(
            async () => {
                await commandManager.executeCommand(Commands.RunByLineNext, cell);
                await waitForStoppedEvent(debugAdapter2!);
                return getCellOutputs(cell).includes('sleepy');
            },
            defaultNotebookTestTimeout,
            `Print during time loop is not working. Outputs: ${getCellOutputs(cell)}}`,
            1000
        );
        await commandManager.executeCommand(Commands.RunByLineStop, cell);
        await waitForCondition(
            async () => !debug.activeDebugSession,
            defaultNotebookTestTimeout,
            'DebugSession should end2'
        );
    });
});
