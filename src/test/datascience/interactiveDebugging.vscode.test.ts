// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { traceInfo } from '../../client/common/logger';
import { IDisposable } from '../../client/common/types';
import { Commands } from '../../client/datascience/constants';
import { InteractiveWindowProvider } from '../../client/datascience/interactive-window/interactiveWindowProvider';
import { IInteractiveWindowProvider } from '../../client/datascience/types';
import { IVariableViewProvider } from '../../client/datascience/variablesView/types';
import { IExtensionTestApi, waitForCondition } from '../common';
import { initialize, IS_REMOTE_NATIVE_TEST } from '../initialize';
import { submitFromPythonFile, waitForLastCellToComplete } from './helpers';
import { closeNotebooksAndCleanUpAfterTests, defaultNotebookTestTimeout, getCellOutputs } from './notebook/helper';
import { ITestWebviewHost } from './testInterfaces';
import { waitForVariablesToMatch } from './variableView/variableViewHelpers';
import { ITestVariableViewProvider } from './variableView/variableViewTestInterfaces';

suite('Interactive window debugging', async function () {
    this.timeout(120_000);
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let interactiveWindowProvider: InteractiveWindowProvider;
    let variableViewProvider: ITestVariableViewProvider;
    let debugAdapterTracker: vscode.DebugAdapterTracker | undefined;
    const tracker: vscode.DebugAdapterTrackerFactory = {
        createDebugAdapterTracker: function (
            _session: vscode.DebugSession
        ): vscode.ProviderResult<vscode.DebugAdapterTracker> {
            return debugAdapterTracker;
        }
    };

    setup(async function () {
        if (IS_REMOTE_NATIVE_TEST) {
            return this.skip();
        }
        traceInfo(`Start Test ${this.currentTest?.title}`);
        api = await initialize();
        disposables.push(vscode.debug.registerDebugAdapterTrackerFactory('python', tracker));
        interactiveWindowProvider = api.serviceManager.get(IInteractiveWindowProvider);
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
        const coreVariableViewProvider = api.serviceContainer.get<IVariableViewProvider>(IVariableViewProvider);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        variableViewProvider = (coreVariableViewProvider as any) as ITestVariableViewProvider; // Cast to expose the test interfaces
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        sinon.restore();
        debugAdapterTracker = undefined;
        await closeNotebooksAndCleanUpAfterTests(disposables);
    });

    test('Debug a cell from a python file', async () => {
        // Run a cell to get IW open
        const source = 'print(42)';
        const { activeInteractiveWindow, untitledPythonFile } = await submitFromPythonFile(
            interactiveWindowProvider,
            source,
            disposables
        );
        await waitForLastCellToComplete(activeInteractiveWindow);

        // Add some more text
        const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri === untitledPythonFile.uri);
        assert.ok(editor, `Couldn't find python file`);
        await editor?.edit((b) => {
            b.insert(new vscode.Position(1, 0), '\n# %%\n\n\nprint(43)');
        });

        let codeLenses: vscode.CodeLens[] = [];
        // Wait for the debug cell code lens to appear
        await waitForCondition(
            async () => {
                codeLenses = (await vscode.commands.executeCommand(
                    'vscode.executeCodeLensProvider',
                    untitledPythonFile.uri
                )) as vscode.CodeLens[];
                return codeLenses && codeLenses.length == 3;
            },
            defaultNotebookTestTimeout,
            `Invalid number of code lenses returned`
        );

        let stopped = false;
        let stoppedOnLine5 = false;
        debugAdapterTracker = {
            onDidSendMessage: (message) => {
                if (message.event == 'stopped') {
                    stopped = true;
                }
                if (message.command == 'stackTrace' && !stoppedOnLine5) {
                    stoppedOnLine5 = message.body.stackFrames[0].line == 5;
                }
            }
        };

        // Try debugging the cell
        assert.ok(codeLenses, `No code lenses found`);
        assert.equal(codeLenses.length, 3, `Wrong number of code lenses found`);
        const args = codeLenses[2].command!.arguments || [];
        void vscode.commands.executeCommand(codeLenses[2].command!.command, ...args);

        // Wait for breakpoint to be hit
        await waitForCondition(
            async () => {
                return vscode.debug.activeDebugSession != undefined && stopped;
            },
            defaultNotebookTestTimeout,
            `Never hit stop event when waiting for debug cell`
        );

        // Verify we are on the 'print(43)' line (might take a second for UI to update after stop event)
        await waitForCondition(
            async () => {
                return stoppedOnLine5;
            },
            defaultNotebookTestTimeout,
            `Cursor did not move to expected line when hitting breakpoint`
        );
    });

    test('Run a cell and step into breakpoint', async () => {
        // Define the function
        const source = 'def foo():\n  print("foo")';
        const { activeInteractiveWindow, untitledPythonFile } = await submitFromPythonFile(
            interactiveWindowProvider,
            source,
            disposables
        );
        await waitForLastCellToComplete(activeInteractiveWindow);

        // Add some more text
        const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri === untitledPythonFile.uri);
        assert.ok(editor, `Couldn't find python file`);
        await editor?.edit((b) => {
            b.insert(new vscode.Position(2, 0), '\n# %%\nfoo()');
        });

        let codeLenses: vscode.CodeLens[] = [];
        // Wait for the debug cell code lens to appear
        await waitForCondition(
            async () => {
                codeLenses = (await vscode.commands.executeCommand(
                    'vscode.executeCodeLensProvider',
                    untitledPythonFile.uri
                )) as vscode.CodeLens[];
                return codeLenses && codeLenses.length == 3;
            },
            defaultNotebookTestTimeout,
            `Invalid number of code lenses returned`
        );

        // Insert a breakpoint on line 2
        vscode.debug.addBreakpoints([
            new vscode.SourceBreakpoint(new vscode.Location(untitledPythonFile.uri, new vscode.Position(1, 0)), true)
        ]);

        let stopped = false;
        let stoppedOnBreakpoint = false;
        debugAdapterTracker = {
            onDidSendMessage: (message) => {
                if (message.event == 'stopped') {
                    stopped = true;
                }
                if (message.command == 'stackTrace' && !stoppedOnBreakpoint) {
                    stoppedOnBreakpoint = message.body.stackFrames[0].line == 2;
                }
            }
        };

        // Try debugging the cell
        assert.ok(codeLenses, `No code lenses found`);
        assert.equal(codeLenses.length, 3, `Wrong number of code lenses found`);
        let args = codeLenses[2].command!.arguments || [];
        void vscode.commands.executeCommand(codeLenses[2].command!.command, ...args);

        // Wait for breakpoint to be hit
        await waitForCondition(
            async () => {
                return vscode.debug.activeDebugSession != undefined && stopped;
            },
            defaultNotebookTestTimeout,
            `Never hit stop event when waiting for debug cell`
        );

        // Now we should have a continue command (first one)
        await waitForCondition(
            async () => {
                codeLenses = (await vscode.commands.executeCommand(
                    'vscode.executeCodeLensProvider',
                    untitledPythonFile.uri
                )) as vscode.CodeLens[];
                return (
                    codeLenses && codeLenses.length == 3 && codeLenses[0].command?.command == 'jupyter.debugcontinue'
                );
            },
            defaultNotebookTestTimeout,
            `Couldn't find continue command`
        );

        stopped = false;
        // Continue and wait for stopped.
        args = codeLenses[0].command!.arguments || [];
        void vscode.commands.executeCommand(codeLenses[0].command!.command, ...args);
        await waitForCondition(
            async () => {
                return stoppedOnBreakpoint && stopped;
            },
            defaultNotebookTestTimeout,
            `Did not hit breakpoint during continue`
        );
    });

    test('Update variables during stepping', async () => {
        // Define the function
        const source = 'print(42)';
        const { activeInteractiveWindow, untitledPythonFile } = await submitFromPythonFile(
            interactiveWindowProvider,
            source,
            disposables
        );
        await waitForLastCellToComplete(activeInteractiveWindow);

        // Add some more text
        const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri === untitledPythonFile.uri);
        assert.ok(editor, `Couldn't find python file`);
        await editor?.edit((b) => {
            b.insert(new vscode.Position(1, 0), '\n# %%\nx = 1\nx = 2\nx = 3\nx');
        });

        let codeLenses: vscode.CodeLens[] = [];
        // Wait for the debug cell code lens to appear
        await waitForCondition(
            async () => {
                codeLenses = (await vscode.commands.executeCommand(
                    'vscode.executeCodeLensProvider',
                    untitledPythonFile.uri
                )) as vscode.CodeLens[];
                return codeLenses && codeLenses.length == 3;
            },
            defaultNotebookTestTimeout,
            `Invalid number of code lenses returned`
        );

        let stopped = false;
        debugAdapterTracker = {
            onDidSendMessage: (message) => {
                if (message.event == 'stopped') {
                    stopped = true;
                }
            }
        };

        // Try debugging the cell
        assert.ok(codeLenses, `No code lenses found`);
        assert.equal(codeLenses.length, 3, `Wrong number of code lenses found`);
        let args = codeLenses[2].command!.arguments || [];
        void vscode.commands.executeCommand(codeLenses[2].command!.command, ...args);

        // Wait for breakpoint to be hit
        await waitForCondition(
            async () => {
                return vscode.debug.activeDebugSession != undefined && stopped;
            },
            defaultNotebookTestTimeout,
            `Never hit stop event when waiting for debug cell`
        );

        // Wait to get the step over code lens
        await waitForCondition(
            async () => {
                codeLenses = (await vscode.commands.executeCommand(
                    'vscode.executeCodeLensProvider',
                    untitledPythonFile.uri
                )) as vscode.CodeLens[];
                return (
                    codeLenses && codeLenses.length == 3 && codeLenses[2].command?.command == 'jupyter.debugstepover'
                );
            },
            defaultNotebookTestTimeout,
            `Couldn't find continue command`
        );

        // Step once
        stopped = false;
        // Continue and wait for stopped.
        args = codeLenses[2].command!.arguments || [];
        void vscode.commands.executeCommand(codeLenses[2].command!.command, ...args);
        await waitForCondition(
            async () => {
                return stopped;
            },
            defaultNotebookTestTimeout,
            `Did not do first step`
        );

        // Send the command to open the view
        await vscode.commands.executeCommand(Commands.OpenVariableView);

        // Aquire the variable view from the provider
        const coreVariableView = await variableViewProvider.activeVariableView;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const variableView = (coreVariableView as any) as ITestWebviewHost;

        // Parse the HTML for our expected variables
        let expectedVariables = [{ name: 'x', type: 'int', length: '', value: '1' }];
        await waitForVariablesToMatch(expectedVariables, variableView);

        stopped = false;
        // Continue and wait for stopped.
        args = codeLenses[2].command!.arguments || [];
        void vscode.commands.executeCommand(codeLenses[2].command!.command, ...args);
        await waitForCondition(
            async () => {
                return stopped;
            },
            defaultNotebookTestTimeout,
            `Did not do second step`
        );

        expectedVariables = [{ name: 'x', type: 'int', length: '', value: '2' }];
        await waitForVariablesToMatch(expectedVariables, variableView);

        stopped = false;
        // Continue and wait for stopped.
        args = codeLenses[2].command!.arguments || [];
        void vscode.commands.executeCommand(codeLenses[2].command!.command, ...args);
        await waitForCondition(
            async () => {
                return stopped;
            },
            defaultNotebookTestTimeout,
            `Did not do third step`
        );

        expectedVariables = [{ name: 'x', type: 'int', length: '', value: '3' }];
        await waitForVariablesToMatch(expectedVariables, variableView);
    });

    test('Run a cell and stop in the middle', async () => {
        // Define the function
        const source = 'print(42)';
        const { activeInteractiveWindow, untitledPythonFile } = await submitFromPythonFile(
            interactiveWindowProvider,
            source,
            disposables
        );
        await waitForLastCellToComplete(activeInteractiveWindow);

        // Add some more text
        const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri === untitledPythonFile.uri);
        assert.ok(editor, `Couldn't find python file`);
        await editor?.edit((b) => {
            b.insert(
                new vscode.Position(1, 0),
                `\n# %%\nimport time\nwhile(True):\n  print(1)\n  time.sleep(.1)\nprint('finished')`
            );
        });

        let codeLenses: vscode.CodeLens[] = [];
        // Wait for the debug cell code lens to appear
        await waitForCondition(
            async () => {
                codeLenses = (await vscode.commands.executeCommand(
                    'vscode.executeCodeLensProvider',
                    untitledPythonFile.uri
                )) as vscode.CodeLens[];
                return codeLenses && codeLenses.length == 3;
            },
            defaultNotebookTestTimeout,
            `Invalid number of code lenses returned`
        );

        let stopped = false;
        debugAdapterTracker = {
            onDidSendMessage: (message) => {
                if (message.event == 'stopped') {
                    stopped = true;
                }
            }
        };

        // Try debugging the cell
        assert.ok(codeLenses, `No code lenses found`);
        assert.equal(codeLenses.length, 3, `Wrong number of code lenses found`);
        let args = codeLenses[2].command!.arguments || [];
        void vscode.commands.executeCommand(codeLenses[2].command!.command, ...args);

        // Wait for breakpoint to be hit
        await waitForCondition(
            async () => {
                return vscode.debug.activeDebugSession != undefined && stopped;
            },
            defaultNotebookTestTimeout,
            `Never hit stop event when waiting for debug cell`
        );

        // Now we should have a stop command (second one)
        await waitForCondition(
            async () => {
                codeLenses = (await vscode.commands.executeCommand(
                    'vscode.executeCodeLensProvider',
                    untitledPythonFile.uri
                )) as vscode.CodeLens[];
                return codeLenses && codeLenses.length == 3 && codeLenses[1].command?.command == 'jupyter.debugstop';
            },
            defaultNotebookTestTimeout,
            `Couldn't find stop command`
        );
        const lastCell = await waitForLastCellToComplete(activeInteractiveWindow, true);
        const outputs = getCellOutputs(lastCell);
        assert.isFalse(outputs.includes('finished'), 'Cell finished during a stop');
    });
});
