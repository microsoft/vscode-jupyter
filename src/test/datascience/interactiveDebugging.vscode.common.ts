// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { traceInfo } from '../../platform/logging';
import { IDisposable } from '../../platform/common/types';
import { InteractiveWindowProvider } from '../../interactive-window/interactiveWindowProvider';
import { initialize, IExtensionTestApi, waitForCondition, startJupyterServer, captureScreenShot } from '../common';
import { IS_REMOTE_NATIVE_TEST } from '../constants';
import {
    submitFromPythonFile,
    submitFromPythonFileUsingCodeWatcher,
    waitForCodeLenses,
    waitForLastCellToComplete
} from './helpers';
import { closeNotebooksAndCleanUpAfterTests, defaultNotebookTestTimeout, getCellOutputs } from './notebook/helper';
import { ITestWebviewHost } from './testInterfaces';
import { waitForVariablesToMatch } from './variableView/variableViewHelpers';
import { ITestVariableViewProvider } from './variableView/variableViewTestInterfaces';
import { IInteractiveWindowProvider } from '../../interactive-window/types';
import { Commands } from '../../platform/common/constants';
import { IVariableViewProvider } from '../../webviews/extension-side/variablesView/types';
import { pythonIWKernelDebugAdapter } from '../../notebooks/debugger/constants';
import { isWeb, noop } from '../../platform/common/utils/misc';
import { IControllerDefaultService } from '../../notebooks/controllers/types';

export type DebuggerType = 'VSCodePythonDebugger' | 'JupyterProtocolDebugger';

export function sharedIWDebuggerTests(
    this: Mocha.Suite,
    options?: {
        suiteSetup?: (debuggerType: DebuggerType) => Promise<void>;
    }
) {
    const debuggerTypes: DebuggerType[] = ['VSCodePythonDebugger', 'JupyterProtocolDebugger'];
    debuggerTypes.forEach((debuggerType) => {
        suite(`Debugging with ${debuggerType} @debugger`, async function () {
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
            suiteSetup(async function () {
                if ((IS_REMOTE_NATIVE_TEST() || isWeb()) && debuggerType === 'VSCodePythonDebugger') {
                    return this.skip();
                }
                if (options?.suiteSetup) {
                    await options?.suiteSetup(debuggerType);
                }
            });
            suiteTeardown(() => vscode.commands.executeCommand('workbench.debug.viewlet.action.removeAllBreakpoints'));
            setup(async function () {
                traceInfo(`Start Test ${this.currentTest?.title}`);
                api = await initialize();
                if (isWeb() || (IS_REMOTE_NATIVE_TEST() && debuggerType === 'VSCodePythonDebugger')) {
                    await startJupyterServer();
                }
                if (!isWeb() && !IS_REMOTE_NATIVE_TEST()) {
                    await api.serviceContainer
                        .get<IControllerDefaultService>(IControllerDefaultService)
                        .computeDefaultController(undefined, 'interactive');
                }
                await vscode.commands.executeCommand('workbench.debug.viewlet.action.removeAllBreakpoints');
                disposables.push(vscode.debug.registerDebugAdapterTrackerFactory('python', tracker));
                disposables.push(vscode.debug.registerDebugAdapterTrackerFactory(pythonIWKernelDebugAdapter, tracker));
                interactiveWindowProvider = api.serviceManager.get(IInteractiveWindowProvider);
                traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
                const coreVariableViewProvider = api.serviceContainer.get<IVariableViewProvider>(IVariableViewProvider);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                variableViewProvider = coreVariableViewProvider as any as ITestVariableViewProvider; // Cast to expose the test interfaces
            });
            teardown(async function () {
                traceInfo(`Ended Test ${this.currentTest?.title}`);
                if (this.currentTest?.isFailed()) {
                    await captureScreenShot(this);
                }
                sinon.restore();
                debugAdapterTracker = undefined;
                await closeNotebooksAndCleanUpAfterTests(disposables);
            });

            // TODO: This should be a testMandatory
            test.skip('Debug a cell from a python file @mandatory', async () => {
                // #11917
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

                let codeLenses = await waitForCodeLenses(untitledPythonFile.uri, Commands.DebugCell);
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
                vscode.commands.executeCommand(codeLenses[2].command!.command, ...args).then(noop, noop);

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

            test('Run a cell and step into breakpoint', async function () {
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

                let codeLenses = await waitForCodeLenses(untitledPythonFile.uri, Commands.DebugCell);

                // Insert a breakpoint on line 2
                vscode.debug.addBreakpoints([
                    new vscode.SourceBreakpoint(
                        new vscode.Location(untitledPythonFile.uri, new vscode.Position(1, 0)),
                        true
                    )
                ]);

                let stopped = false;
                let stoppedOnBreakpoint = false;
                debugAdapterTracker = {
                    onDidSendMessage: (message) => {
                        if (message.event == 'stopped') {
                            stopped = true;
                        }
                        if (
                            message.command == 'stackTrace' &&
                            !stoppedOnBreakpoint &&
                            message.body.stackFrames.length
                        ) {
                            stoppedOnBreakpoint = message.body.stackFrames[0].line == 2;
                        }
                    }
                };

                // Try debugging the cell
                assert.ok(codeLenses, `No code lenses found`);
                assert.equal(codeLenses.length, 3, `Wrong number of code lenses found`);
                let args = codeLenses[2].command!.arguments || [];
                vscode.commands.executeCommand(codeLenses[2].command!.command, ...args).then(noop, noop);

                // Wait for breakpoint to be hit
                await waitForCondition(
                    async () => {
                        return vscode.debug.activeDebugSession != undefined && stopped;
                    },
                    defaultNotebookTestTimeout,
                    `Never hit stop event when waiting for debug cell`
                );

                codeLenses = await waitForCodeLenses(untitledPythonFile.uri, Commands.DebugContinue);
                stopped = false;
                // Continue and wait for stopped.
                args = codeLenses[0].command!.arguments || [];
                vscode.commands.executeCommand(codeLenses[0].command!.command, ...args).then(noop, noop);
                await waitForCondition(
                    async () => {
                        return stoppedOnBreakpoint && stopped;
                    },
                    defaultNotebookTestTimeout,
                    `Did not hit breakpoint during continue`
                );
            });

            test('Update variables during stepping', async function () {
                if (isWeb()) {
                    return this.skip();
                }
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

                let codeLenses = await waitForCodeLenses(untitledPythonFile.uri, Commands.DebugCell);
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
                vscode.commands.executeCommand(codeLenses[2].command!.command, ...args).then(noop, noop);

                // Wait for breakpoint to be hit
                await waitForCondition(
                    async () => {
                        return vscode.debug.activeDebugSession != undefined && stopped;
                    },
                    defaultNotebookTestTimeout,
                    `Never hit stop event when waiting for debug cell`
                );

                // Wait to get the step over code lens
                codeLenses = await waitForCodeLenses(untitledPythonFile.uri, Commands.DebugStepOver);
                // Step once
                stopped = false;
                // Continue and wait for stopped.
                args = codeLenses[2].command!.arguments || [];
                vscode.commands.executeCommand(codeLenses[2].command!.command, ...args).then(noop, noop);
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
                const variableView = coreVariableView as unknown as ITestWebviewHost;

                // Parse the HTML for our expected variables
                let expectedVariables = [{ name: 'x', type: 'int', length: '', value: '1' }];
                await waitForVariablesToMatch(expectedVariables, variableView);

                stopped = false;
                // Continue and wait for stopped.
                args = codeLenses[2].command!.arguments || [];
                vscode.commands.executeCommand(codeLenses[2].command!.command, ...args).then(noop, noop);
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
                vscode.commands.executeCommand(codeLenses[2].command!.command, ...args).then(noop, noop);
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

                let codeLenses = await waitForCodeLenses(untitledPythonFile.uri, Commands.DebugCell);
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
                vscode.commands.executeCommand(codeLenses[2].command!.command, ...args).then(noop, noop);

                // Wait for breakpoint to be hit
                await waitForCondition(
                    async () => {
                        return vscode.debug.activeDebugSession != undefined && stopped;
                    },
                    defaultNotebookTestTimeout,
                    `Never hit stop event when waiting for debug cell`
                );

                // Now we should have a stop command (second one)
                codeLenses = await waitForCodeLenses(untitledPythonFile.uri, Commands.DebugStop);
                const lastCell = await waitForLastCellToComplete(activeInteractiveWindow, -1, true);
                const outputs = getCellOutputs(lastCell);
                assert.isFalse(outputs.includes('finished'), 'Cell finished during a stop');
            });

            test('Correctly handle leading spaces in a code cell we are debugging', async () => {
                // First just get our window up and started
                const source = 'c = 50\n';
                const { activeInteractiveWindow, untitledPythonFile } = await submitFromPythonFile(
                    interactiveWindowProvider,
                    source,
                    disposables
                );
                await waitForLastCellToComplete(activeInteractiveWindow);

                // Next add some code lines with leading spaces, we are going to debug this cell and we want to end up on the
                // correct starting line
                const leadingSpacesSource = `# %%




a = 100
b = 200
`;
                const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri === untitledPythonFile.uri);
                assert.ok(editor, `Couldn't find python file`);
                await editor?.edit((edit) => {
                    edit.insert(new vscode.Position(2, 0), leadingSpacesSource);
                });

                let codeLenses = await waitForCodeLenses(untitledPythonFile.uri, Commands.DebugCell);
                let stopped = false;
                let stoppedOnLine = false;
                debugAdapterTracker = {
                    onDidSendMessage: (message) => {
                        if (message.event == 'stopped') {
                            stopped = true;
                        }
                        if (message.command == 'stackTrace' && !stoppedOnLine) {
                            stoppedOnLine = message.body.stackFrames[0].line == 7;
                        }
                    }
                };

                // Try debugging the cell
                assert.ok(codeLenses, `No code lenses found`);
                assert.equal(codeLenses.length, 3, `Wrong number of code lenses found`);
                let args = codeLenses[2].command!.arguments || [];
                vscode.commands.executeCommand(codeLenses[2].command!.command, ...args).then(noop, noop);

                // Wait for breakpoint to be hit
                await waitForCondition(
                    async () => {
                        return vscode.debug.activeDebugSession != undefined && stopped;
                    },
                    defaultNotebookTestTimeout,
                    `Never hit stop event when waiting for debug cell`
                );

                // Verify we are on the 'a = 100' line (might take a second for UI to update after stop event)
                await waitForCondition(
                    async () => {
                        return stoppedOnLine;
                    },
                    defaultNotebookTestTimeout,
                    `Cursor did not move to expected line when hitting breakpoint`
                );
            });
            test('Correctly handle leading spaces in a previously run code cell', async () => {
                // Define the function with some leading spaces and run it (don't debug it)
                const source = `




def foo():
    x = 10`;
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
                    b.insert(new vscode.Position(8, 0), '\n# %%\nfoo()');
                });

                let codeLenses = await waitForCodeLenses(untitledPythonFile.uri, Commands.DebugCell);
                let stopped = false;
                let stoppedOnLine = false;
                let targetLine = 9;
                debugAdapterTracker = {
                    onDidSendMessage: (message) => {
                        if (message.event == 'stopped') {
                            stopped = true;
                        }
                        if (message.command == 'stackTrace' && !stoppedOnLine) {
                            stoppedOnLine = message.body.stackFrames[0].line == targetLine;
                        }
                    }
                };

                assert.ok(codeLenses, `No code lenses found`);
                assert.equal(codeLenses.length, 3, `Wrong number of code lenses found`);
                let args = codeLenses[2].command!.arguments || [];
                vscode.commands.executeCommand(codeLenses[2].command!.command, ...args).then(noop, noop);

                // Wait for breakpoint to be hit
                await waitForCondition(
                    async () => {
                        return vscode.debug.activeDebugSession != undefined && stopped;
                    },
                    defaultNotebookTestTimeout,
                    `Never hit stop event when waiting for debug cell`
                );

                // Verify that we hit the correct line
                await waitForCondition(
                    async () => {
                        return stoppedOnLine;
                    },
                    defaultNotebookTestTimeout,
                    `Cursor did not move to expected line when hitting breakpoint`
                );

                // Perform a step into
                stopped = false;
                stoppedOnLine = false;
                targetLine = 7;

                vscode.commands.executeCommand('workbench.action.debug.stepInto').then(noop, noop);
                await waitForCondition(
                    async () => {
                        return stopped;
                    },
                    defaultNotebookTestTimeout,
                    `Did not stop on step into`
                );

                // Verify that we hit the correct line
                await waitForCondition(
                    async () => {
                        return stoppedOnLine;
                    },
                    defaultNotebookTestTimeout,
                    `Cursor did not move to expected line when hitting stepping into`
                );
            });

            test('Step into a previous cell', async () => {
                // Need a function and a call to the function
                const source = `
# %%
def foo():
    x = 10

# %%
foo()
`;
                const { activeInteractiveWindow, untitledPythonFile } = await submitFromPythonFileUsingCodeWatcher(
                    source,
                    disposables
                );
                await waitForLastCellToComplete(activeInteractiveWindow, 2);

                let codeLenses = await waitForCodeLenses(untitledPythonFile.uri, Commands.DebugCell);
                let stopped = false;
                let stoppedOnLine = false;
                let targetLine = 7;
                debugAdapterTracker = {
                    onDidSendMessage: (message) => {
                        if (message.event == 'stopped') {
                            stopped = true;
                        }
                        if (message.command == 'stackTrace' && !stoppedOnLine) {
                            stoppedOnLine = message.body.stackFrames[0].line == targetLine;
                        }
                    }
                };

                const debugCellCodeLenses = codeLenses.filter((c) => c.command?.command === Commands.DebugCell);
                const debugCellCodeLens = debugCellCodeLenses[1];
                let args = debugCellCodeLens.command!.arguments || [];
                vscode.commands.executeCommand(debugCellCodeLens.command!.command, ...args).then(noop, noop);

                // Wait for breakpoint to be hit
                await waitForCondition(
                    async () => {
                        return vscode.debug.activeDebugSession != undefined && stopped;
                    },
                    defaultNotebookTestTimeout,
                    `Never hit stop event when waiting for debug cell`
                );

                // Verify that we hit the correct line
                await waitForCondition(
                    async () => {
                        return stoppedOnLine;
                    },
                    defaultNotebookTestTimeout,
                    `Cursor did not move to expected line when hitting breakpoint`
                );

                // Perform a step into
                stopped = false;
                stoppedOnLine = false;
                targetLine = 4;

                vscode.commands.executeCommand('workbench.action.debug.stepInto').then(noop, noop);
                await waitForCondition(
                    async () => {
                        return stopped;
                    },
                    defaultNotebookTestTimeout,
                    `Did not stop on step into`
                );

                // Verify that we hit the correct line
                await waitForCondition(
                    async () => {
                        return stoppedOnLine;
                    },
                    defaultNotebookTestTimeout,
                    `Cursor did not move to expected line when hitting stepping into`
                );
            });
        });
    });
}
