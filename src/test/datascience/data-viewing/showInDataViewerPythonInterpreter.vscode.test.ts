// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import * as vscode from 'vscode';
import * as path from '../../../platform/vscode-path/path';
import * as sinon from 'sinon';
import { traceInfo } from '../../../platform/logging';
import { IDisposable } from '../../../platform/common/types';
import { captureScreenShot, openFile } from '../../common.node';
import { initialize } from '../../initialize.node';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../constants.node';
import { waitForCondition } from '../../common.node';
import { defaultNotebookTestTimeout } from '../notebook/helper';
import { createDeferred } from '../../../platform/common/utils/async';
import { dispose } from '../../../platform/common/utils/lifecycle';
import { IShowDataViewerFromVariablePanel } from '../../../messageTypes';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataViewer @webview', function () {
    const disposables: IDisposable[] = [];
    const testPythonFile = path.join(
        EXTENSION_ROOT_DIR_FOR_TESTS,
        'src',
        'test',
        'datascience',
        'data-viewing',
        'dataViewing.py'
    );
    this.timeout(120_000);
    suiteSetup(async function () {
        traceInfo('Suite Setup');
        this.timeout(120_000);
        try {
            await initialize();
            sinon.restore();
            traceInfo('Suite Setup (completed)');
        } catch (e) {
            await captureScreenShot('data-viewer-suite');
            throw e;
        }
    });
    // Cleanup after suite is finished
    suiteTeardown(() => {
        dispose(disposables);
    });
    setup(async () => {
        // Close documents and stop debugging
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        await vscode.commands.executeCommand('workbench.action.closeAllGroups');
        await vscode.commands.executeCommand('workbench.debug.viewlet.action.removeAllBreakpoints');
    });
    teardown(async () => {
        // Close documents and stop debugging
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        await vscode.commands.executeCommand('workbench.action.closeAllGroups');
        await vscode.commands.executeCommand('workbench.action.debug.stop');
        await vscode.commands.executeCommand('workbench.debug.viewlet.action.removeAllBreakpoints');
    });
    // Start debugging using the python extension
    test.only('Open from Python debug variables', async () => {
        // First off, open up our python test file and make sure editor and groups are how we want them
        const textDocument = await openFile(testPythonFile);

        // Wait for it to be opened and active, then get the editor
        await waitForCondition(
            async () => {
                return vscode.window.activeTextEditor?.document === textDocument;
            },
            defaultNotebookTestTimeout,
            `Waiting for editor to switch`
        );
        const textEditor = vscode.window.activeTextEditor!;

        // Next, place a breakpoint on the second line
        const bpPosition = new vscode.Position(1, 0);
        textEditor.selection = new vscode.Selection(bpPosition, bpPosition);

        await vscode.commands.executeCommand('editor.debug.action.toggleBreakpoint');

        // Prep to see when we are stopped
        const stoppedDef = createDeferred<void>();
        let variablesReference = -1;

        // Keep an eye on debugger messages to see when we stop
        disposables.push(
            vscode.debug.registerDebugAdapterTrackerFactory('*', {
                createDebugAdapterTracker(_session: vscode.DebugSession) {
                    return {
                        onWillReceiveMessage: (m) => {
                            if (m.command && m.command === 'variables') {
                                // When we get the variables event track the reference and release the code
                                variablesReference = m.arguments.variablesReference;
                                stoppedDef.resolve();
                            }
                        }
                    };
                }
            })
        );

        // Now start the debugger
        await vscode.commands.executeCommand('python.debugInTerminal');

        // Wait until we stop
        await stoppedDef.promise;

        // Properties that we want to show the data viewer with
        const props: IShowDataViewerFromVariablePanel = {
            container: {},
            variable: {
                evaluateName: 'my_list',
                name: 'my_list',
                value: '[1, 2, 3]',
                variablesReference
            }
        };

        // Run our command to actually open the variable view
        await vscode.commands.executeCommand('jupyter.showDataViewer', props);

        // Wait until a new tab group opens with the right name
        await waitForCondition(
            async () => {
                // return vscode.window.tabGroups.all[1].activeTab?.label === 'Data Viewer - my_list';
                let tabFound = false;
                vscode.window.tabGroups.all.forEach((tg) => {
                    if (
                        tg.tabs.some((tab) => {
                            return tab.label === 'Data Viewer - my_list';
                        })
                    ) {
                        tabFound = true;
                    }
                });
                return tabFound;
            },
            40_000,
            'Failed to open the data viewer from python variables'
        );
    });
});
