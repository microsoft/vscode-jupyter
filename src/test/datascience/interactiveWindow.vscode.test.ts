// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as path from '../../platform/vscode-path/path';
import * as fs from 'fs-extra';
import { assert } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { traceInfo, traceInfoIfCI } from '../../platform/logging';
import { getDisplayPath, getFilePath } from '../../platform/common/platform/fs-paths';
import { IDisposable } from '../../platform/common/types';
import { InteractiveWindowProvider } from '../../interactive-window/interactiveWindowProvider';
import { IKernelProvider } from '../../platform/../kernels/types';
import { captureScreenShot, createEventHandler, IExtensionTestApi, sleep, waitForCondition } from '../common.node';
import { initialize, IPYTHON_VERSION_CODE, IS_REMOTE_NATIVE_TEST, IS_CONDA_TEST } from '../initialize.node';
import {
    closeInteractiveWindow,
    createStandaloneInteractiveWindow,
    insertIntoInputEditor,
    installIPyKernel,
    runCurrentFile,
    runNewPythonFile,
    setActiveInterpreter,
    submitFromPythonFile,
    submitFromPythonFileUsingCodeWatcher,
    uninstallIPyKernel,
    waitForInteractiveWindow,
    waitForLastCellToComplete
} from './helpers.node';
import {
    assertHasTextOutputInVSCode,
    clickOKForRestartPrompt,
    closeNotebooksAndCleanUpAfterTests,
    defaultNotebookTestTimeout,
    startJupyterServer,
    waitForExecutionCompletedSuccessfully,
    waitForExecutionCompletedWithErrors,
    waitForTextOutput
} from './notebook/helper.node';
import { translateCellErrorOutput, getTextOutputValue } from '../../notebooks/helpers';
import { INotebookControllerManager } from '../../notebooks/types';
import { IInteractiveWindowProvider } from '../../interactive-window/types';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { areInterpreterPathsSame } from '../../platform/pythonEnvironments/info/interpreter';
import { IPythonApiProvider } from '../../platform/api/types';
import { isEqual } from '../../platform/vscode-path/resources';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { EXTENSION_ROOT_DIR } from '../../platform/constants.node';

type DebuggerType = 'VSCodePythonDebugger' | 'JupyterProtocolDebugger';
const debuggerTypes: DebuggerType[] = ['JupyterProtocolDebugger', 'VSCodePythonDebugger'];
debuggerTypes.forEach((debuggerType) => {
    suite(`Interactive window debugger using ${debuggerType}`, async function () {
        this.timeout(120_000);
        let api: IExtensionTestApi;
        const disposables: IDisposable[] = [];
        let interactiveWindowProvider: InteractiveWindowProvider;
        let venNoKernelPath: vscode.Uri;
        let venvKernelPath: vscode.Uri;
        let pythonApiProvider: IPythonApiProvider;
        let originalActiveInterpreter: PythonEnvironment | undefined;
        const settingsFile = path.join(EXTENSION_ROOT_DIR, 'src', 'test', 'datascience', '.vscode', 'settings.json');
        function enableJupyterDebugger(enable: boolean) {
            const settingFileContents = fs.readFileSync(settingsFile).toString();
            if (enable && settingFileContents.includes(`"jupyter.forceIPyKernelDebugger": true`)) {
                return;
            } else if (enable && settingFileContents.includes(`"jupyter.forceIPyKernelDebugger": false`)) {
                fs.writeFileSync(
                    settingsFile,
                    settingFileContents.replace(
                        `"jupyter.forceIPyKernelDebugger": false`,
                        `"jupyter.forceIPyKernelDebugger": true`
                    )
                );
                return;
            } else if (enable && !settingFileContents.includes(`"jupyter.forceIPyKernelDebugger": true`)) {
                throw new Error('Unable to update settings file');
            } else if (!enable && settingFileContents.includes(`"jupyter.forceIPyKernelDebugger": true`)) {
                fs.writeFileSync(
                    settingsFile,
                    settingFileContents.replace(
                        `"jupyter.forceIPyKernelDebugger": true`,
                        `"jupyter.forceIPyKernelDebugger": false`
                    )
                );
                return;
            } else if (!enable && settingFileContents.includes(`"jupyter.forceIPyKernelDebugger": false`)) {
                return;
            } else if (!enable && !settingFileContents.includes(`"jupyter.forceIPyKernelDebugger": true`)) {
                throw new Error('Unable to update settings file');
            }
        }
        suiteSetup(function () {
            if (IS_REMOTE_NATIVE_TEST() && debuggerType === 'VSCodePythonDebugger') {
                return this.skip();
            }
            enableJupyterDebugger(debuggerType === 'JupyterProtocolDebugger');
        });
        suiteTeardown(() => enableJupyterDebugger(false));
        setup(async function () {
            if (IS_REMOTE_NATIVE_TEST() && debuggerType === 'VSCodePythonDebugger') {
                return this.skip();
            }
            traceInfo(`Start Test ${this.currentTest?.title}`);
            api = await initialize();
            if (IS_REMOTE_NATIVE_TEST() && debuggerType === 'VSCodePythonDebugger') {
                await startJupyterServer();
            }
            interactiveWindowProvider = api.serviceManager.get(IInteractiveWindowProvider);
            pythonApiProvider = api.serviceManager.get<IPythonApiProvider>(IPythonApiProvider);
            traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
        });
        teardown(async function () {
            traceInfo(`Ended Test ${this.currentTest?.title}`);
            if (this.currentTest?.isFailed()) {
                // For a flaky interrupt test.
                await captureScreenShot(`Interactive-Tests-${this.currentTest?.title}`);
            }
            sinon.restore();
            await closeNotebooksAndCleanUpAfterTests(disposables);
        });

        test('Execute cell from Python file', async () => {
            const source = 'print(42)';
            const { activeInteractiveWindow } = await submitFromPythonFile(
                interactiveWindowProvider,
                source,
                disposables
            );
            const notebookDocument = vscode.workspace.notebookDocuments.find(
                (doc) => doc.uri.toString() === activeInteractiveWindow?.notebookUri?.toString()
            );
            const notebookControllerManager =
                api.serviceManager.get<INotebookControllerManager>(INotebookControllerManager);

            // Ensure we picked up the active interpreter for use as the kernel
            const interpreterService = await api.serviceManager.get<IInterpreterService>(IInterpreterService);

            // Give it a bit to warm up
            await sleep(500);

            const controller = notebookDocument
                ? notebookControllerManager.getSelectedNotebookController(notebookDocument)
                : undefined;
            if (!IS_REMOTE_NATIVE_TEST()) {
                const activeInterpreter = await interpreterService.getActiveInterpreter();
                assert.ok(
                    areInterpreterPathsSame(controller?.connection.interpreter?.uri, activeInterpreter?.uri),
                    `Controller does not match active interpreter for ${getDisplayPath(notebookDocument?.uri)}`
                );
            }

            // Verify sys info cell
            const firstCell = notebookDocument?.cellAt(0);
            assert.ok(firstCell?.metadata.isInteractiveWindowMessageCell, 'First cell should be sys info cell');
            assert.equal(firstCell?.kind, vscode.NotebookCellKind.Markup, 'First cell should be markdown cell');

            // Verify executed cell input and output
            const secondCell = notebookDocument?.cellAt(1);
            const actualSource = secondCell?.document.getText();
            assert.equal(actualSource, source, `Executed cell has unexpected source code`);
            await waitForExecutionCompletedSuccessfully(secondCell!);
            await waitForTextOutput(secondCell!, '42');
        });
        test('__file__ exists even after restarting a kernel', async function () {
            // Ensure we click `Yes` when prompted to restart the kernel.
            disposables.push(await clickOKForRestartPrompt());

            const source = 'print(__file__)';
            const { activeInteractiveWindow, untitledPythonFile } = await submitFromPythonFile(
                interactiveWindowProvider,
                source,
                disposables
            );
            const notebookDocument = vscode.workspace.notebookDocuments.find(
                (doc) => doc.uri.toString() === activeInteractiveWindow?.notebookUri?.toString()
            )!;
            const notebookControllerManager =
                api.serviceManager.get<INotebookControllerManager>(INotebookControllerManager);
            // Ensure we picked up the active interpreter for use as the kernel
            const interpreterService = await api.serviceManager.get<IInterpreterService>(IInterpreterService);

            // Give it a bit to warm up
            await sleep(500);

            const controller = notebookDocument
                ? notebookControllerManager.getSelectedNotebookController(notebookDocument)
                : undefined;
            if (!IS_REMOTE_NATIVE_TEST()) {
                const activeInterpreter = await interpreterService.getActiveInterpreter();
                assert.ok(
                    areInterpreterPathsSame(controller?.connection.interpreter?.uri, activeInterpreter?.uri),
                    `Controller does not match active interpreter for ${getDisplayPath(notebookDocument?.uri)}`
                );
            }
            async function verifyCells() {
                // Verify sys info cell
                const firstCell = notebookDocument.cellAt(0);
                assert.ok(firstCell?.metadata.isInteractiveWindowMessageCell, 'First cell should be sys info cell');
                assert.equal(firstCell?.kind, vscode.NotebookCellKind.Markup, 'First cell should be markdown cell');

                // Verify executed cell input and output
                const secondCell = notebookDocument.cellAt(1);
                const actualSource = secondCell.document.getText();
                assert.equal(actualSource, source, `Executed cell has unexpected source code`);
                await waitForExecutionCompletedSuccessfully(secondCell!);
            }

            await verifyCells();

            // CLear all cells
            await vscode.commands.executeCommand('jupyter.interactive.clearAllCells');
            await waitForCondition(async () => notebookDocument.cellCount === 0, 5_000, 'Cells not cleared');

            // Restart kernel
            const kernelProvider = api.serviceContainer.get<IKernelProvider>(IKernelProvider);
            const kernel = kernelProvider.get(notebookDocument.uri);
            const handler = createEventHandler(kernel!, 'onRestarted', disposables);
            await vscode.commands.executeCommand('jupyter.restartkernel');
            // Wait for restart to finish
            await handler.assertFiredExactly(1, defaultNotebookTestTimeout);
            await activeInteractiveWindow.addCode(source, untitledPythonFile.uri, 0);
            await waitForCondition(
                async () => notebookDocument.cellCount > 1,
                defaultNotebookTestTimeout,
                'Code not executed'
            );

            await verifyCells();
        });
        test('Execute cell from input box', async () => {
            // Create new interactive window
            const activeInteractiveWindow = await createStandaloneInteractiveWindow(interactiveWindowProvider);
            const notebook = await waitForInteractiveWindow(activeInteractiveWindow);

            // Add code to the input box
            await insertIntoInputEditor('print("foo")');

            // Run the code in the input box
            await vscode.commands.executeCommand('interactive.execute');

            assert.ok(notebook !== undefined, 'No interactive window found');
            await waitForCondition(
                async () => {
                    return notebook.cellCount > 1;
                },
                defaultNotebookTestTimeout,
                'Cell never added'
            );

            // Inspect notebookDocument for output
            const index = notebook!.cellCount - 1;
            const cell = notebook!.cellAt(index);
            await waitForTextOutput(cell, 'foo');
        });

        test('Clear output', async function () {
            // Test failing after using python insiders. Not getting expected
            // output
            // https://github.com/microsoft/vscode-jupyter/issues/7580
            this.skip();
            const text = `from IPython.display import clear_output
for i in range(10):
    clear_output()
    print("Hello World {0}!".format(i))
`;
            const { activeInteractiveWindow } = await submitFromPythonFile(
                interactiveWindowProvider,
                text,
                disposables
            );
            const cell = await waitForLastCellToComplete(activeInteractiveWindow);
            await waitForTextOutput(cell!, 'Hello World 9!');
        });

        test('Clear input box', async () => {
            const text = '42';
            // Create interactive window with no owner
            await createStandaloneInteractiveWindow(interactiveWindowProvider);
            await insertIntoInputEditor(text);

            // Clear input and verify
            assert.ok(
                vscode.window.activeTextEditor?.document.getText() === text,
                'Text not inserted into input editor'
            );
            await vscode.commands.executeCommand('interactive.input.clear');
            assert.ok(vscode.window.activeTextEditor?.document.getText() === '', 'Text not cleared from input editor');

            // Undo
            await vscode.commands.executeCommand('undo');

            // Verify input box contents were restored
            assert.ok(
                vscode.window.activeTextEditor?.document.getText() === text,
                'Text not restored to input editor after undo'
            );
        });

        test('LiveLossPlot', async () => {
            const code = `from time import sleep
import numpy as np

from livelossplot import PlotLosses
liveplot = PlotLosses()

for i in range(10):
    liveplot.update({
        'accuracy': 1 - np.random.rand() / (i + 2.),
        'val_accuracy': 1 - np.random.rand() / (i + 0.5),
        'mse': 1. / (i + 2.),
        'val_mse': 1. / (i + 0.5)
    })
    liveplot.draw()
    sleep(0.1)`;
            const interactiveWindow = await createStandaloneInteractiveWindow(interactiveWindowProvider);
            await insertIntoInputEditor(code);
            await vscode.commands.executeCommand('interactive.execute');
            const codeCell = await waitForLastCellToComplete(interactiveWindow);
            const output = codeCell?.outputs[0];
            assert.ok(output?.items[0].mime === 'image/png', 'No png output found');
            assert.ok(
                output?.metadata?.outputType === 'display_data',
                `Expected metadata.outputType to be 'display_data' but got ${output?.metadata?.outputType}`
            );
        });

        // Create 3 cells. Last cell should update the second
        test('Update display data', async () => {
            // Create cell 1
            const interactiveWindow = await createStandaloneInteractiveWindow(interactiveWindowProvider);
            await insertIntoInputEditor('dh = display(display_id=True)');
            await vscode.commands.executeCommand('interactive.execute');

            // Create cell 2
            await insertIntoInputEditor('dh.display("Hello")');
            await vscode.commands.executeCommand('interactive.execute');
            const secondCell = await waitForLastCellToComplete(interactiveWindow);
            await waitForTextOutput(secondCell!, "'Hello'");

            // Create cell 3
            await insertIntoInputEditor('dh.update("Goodbye")');
            await vscode.commands.executeCommand('interactive.execute');
            // Last cell output is empty
            const thirdCell = await waitForLastCellToComplete(interactiveWindow);
            assert.equal(thirdCell?.outputs.length, 0, 'Third cell should not have any outputs');
            // Second cell output is updated
            await waitForTextOutput(secondCell!, "'Goodbye'");
        });

        test('Cells with errors cancel execution for others', async () => {
            const source =
                '# %%\nprint(1)\n# %%\nimport time\ntime.sleep(1)\nraise Exception("foo")\n# %%\nprint(2)\n# %%\nprint(3)';
            const { activeInteractiveWindow } = await submitFromPythonFileUsingCodeWatcher(source, disposables);
            const notebookDocument = vscode.workspace.notebookDocuments.find(
                (doc) => doc.uri.toString() === activeInteractiveWindow?.notebookUri?.toString()
            );

            await waitForCondition(
                async () => {
                    return notebookDocument?.cellCount == 5;
                },
                defaultNotebookTestTimeout,
                `Cells should be added`
            );
            const [, , secondCell, thirdCell, fourthCell] = notebookDocument!.getCells();
            // Other remaining cells will also fail with errors.
            await Promise.all([
                waitForExecutionCompletedWithErrors(secondCell!),
                waitForExecutionCompletedWithErrors(thirdCell!, undefined, false),
                waitForExecutionCompletedWithErrors(fourthCell!, undefined, false)
            ]);
        });

        test('Multiple interactive windows', async () => {
            const settings = vscode.workspace.getConfiguration('jupyter', null);
            await settings.update('interactiveWindowMode', 'multiple');
            const window1 = await interactiveWindowProvider.getOrCreate(undefined);
            const window2 = await interactiveWindowProvider.getOrCreate(undefined);
            assert.notEqual(
                window1.notebookUri?.toString(),
                window2.notebookUri?.toString(),
                'Two windows were not created in multiple mode'
            );
        });

        test('Dispose test', async () => {
            const interactiveWindow = await interactiveWindowProvider.getOrCreate(undefined);
            await interactiveWindow.dispose();
            const interactiveWindow2 = await interactiveWindowProvider.getOrCreate(undefined);
            assert.ok(
                interactiveWindow.notebookUri?.toString() !== interactiveWindow2.notebookUri?.toString(),
                'Disposing is not removing the active interactive window'
            );
        });

        test('Leading and trailing empty lines in #%% cell are trimmed', async () => {
            const actualCode = `    print('foo')



    print('bar')`;
            const codeWithWhitespace = `    # %%



${actualCode}




`;
            traceInfoIfCI('Before submitting');
            const { activeInteractiveWindow: interactiveWindow } = await submitFromPythonFile(
                interactiveWindowProvider,
                codeWithWhitespace,
                disposables
            );
            traceInfoIfCI('After submitting');
            const lastCell = await waitForLastCellToComplete(interactiveWindow);
            const actualCellText = lastCell.document.getText();
            assert.equal(actualCellText, actualCode);
        });

        test('Run current file in interactive window (with cells)', async () => {
            const { activeInteractiveWindow } = await runNewPythonFile(
                interactiveWindowProvider,
                '#%%\na=1\nprint(a)\n#%%\nb=2\nprint(b)\n',
                disposables
            );

            await waitForLastCellToComplete(activeInteractiveWindow);

            const notebookDocument = vscode.workspace.notebookDocuments.find(
                (doc) => doc.uri.toString() === activeInteractiveWindow?.notebookUri?.toString()
            );

            // Should have two cells in the interactive window
            assert.equal(notebookDocument?.cellCount, 3, `Running a whole file did not split cells`);

            // Make sure it output something
            notebookDocument?.getCells().forEach((c, i) => {
                if (c.document.uri.scheme === 'vscode-notebook-cell' && c.kind == vscode.NotebookCellKind.Code) {
                    assertHasTextOutputInVSCode(c, `${i}`);
                }
            });
        });

        test('Run current file in interactive window (without cells)', async () => {
            const { activeInteractiveWindow } = await runNewPythonFile(
                interactiveWindowProvider,
                'a=1\nprint(a)\nb=2\nprint(b)\n',
                disposables
            );

            await waitForLastCellToComplete(activeInteractiveWindow);

            const notebookDocument = vscode.workspace.notebookDocuments.find(
                (doc) => doc.uri.toString() === activeInteractiveWindow?.notebookUri?.toString()
            );

            // Should have two cells in the interactive window
            assert.equal(notebookDocument?.cellCount, 2, `Running a file should use one cell`);

            // Wait for output to appear
            await waitForTextOutput(notebookDocument!.cellAt(1), '1\n2');
        });

        test('Raising an exception from within a function has a stack trace', async function () {
            const { activeInteractiveWindow } = await runNewPythonFile(
                interactiveWindowProvider,
                '# %%\ndef raiser():\n  raise Exception("error")\n# %%\nraiser()',
                disposables
            );
            const lastCell = await waitForLastCellToComplete(activeInteractiveWindow, 2, true);

            // Wait for the outputs to be available.
            await waitForCondition(
                async () => lastCell.outputs.length > 0 && lastCell.outputs[0].items.length > 0,
                defaultNotebookTestTimeout,
                'Outputs not available'
            );

            // Parse the last cell's error output
            const errorOutput = translateCellErrorOutput(lastCell.outputs[0]);
            assert.ok(errorOutput, 'No error output found');
            assert.equal(errorOutput.traceback.length, 5, 'Traceback wrong size');

            // Convert to html for easier parsing
            const ansiToHtml = require('ansi-to-html') as typeof import('ansi-to-html');
            const converter = new ansiToHtml();
            const html = converter.toHtml(errorOutput.traceback.join('\n'));

            // Should be three hrefs for the two lines in the call stack
            const hrefs = html.match(/<a\s+href='.*\?line=(\d+)'/gm);
            assert.equal(hrefs?.length, 4, '4 hrefs not found in traceback');
            assert.ok(hrefs[0].endsWith("line=4'"), `Wrong first ref line : ${hrefs[0]}`);
            assert.ok(hrefs[1].endsWith("line=5'"), `Wrong second ref line : ${hrefs[1]}`);
            assert.ok(hrefs[2].endsWith("line=2'"), `Wrong last ref line : ${hrefs[2]}`);
        });

        test('Raising an exception from system code has a stack trace', async function () {
            const { activeInteractiveWindow } = await runNewPythonFile(
                interactiveWindowProvider,
                `# %%\n${IPYTHON_VERSION_CODE}# %%\nimport pathlib as pathlib\nx = pathlib.Path()\ny = None\nx.joinpath(y, "Foo")`,
                disposables
            );
            const lastCell = await waitForLastCellToComplete(activeInteractiveWindow, 2, true);

            // Wait for the outputs to be available.
            await waitForCondition(
                async () => lastCell.outputs.length > 0 && lastCell.outputs[0].items.length > 0,
                defaultNotebookTestTimeout,
                'Outputs not available'
            );

            const ipythonVersionCell = activeInteractiveWindow.notebookDocument?.cellAt(lastCell.index - 1);
            const ipythonVersion = parseInt(getTextOutputValue(ipythonVersionCell!.outputs[0]));

            // Parse the last cell's error output
            const errorOutput = translateCellErrorOutput(lastCell.outputs[0]);
            assert.ok(errorOutput, 'No error output found');

            // Convert to html for easier parsing
            const ansiToHtml = require('ansi-to-html') as typeof import('ansi-to-html');
            const converter = new ansiToHtml();
            const html = converter.toHtml(errorOutput.traceback.join('\n'));

            // Should be more than 3 hrefs if ipython 8 or not
            const hrefs = html.match(/<a\s+href='.*\?line=(\d+)'/gm);
            if (ipythonVersion >= 8) {
                assert.isAtLeast(hrefs?.length, 4, 'Wrong number of hrefs found in traceback for IPython 8');
            } else {
                assert.isAtLeast(hrefs?.length, 1, 'Wrong number of hrefs found in traceback for IPython 7 or earlier');
            }
        });

        test('Running a cell with markdown and code runs two cells', async () => {
            const { activeInteractiveWindow } = await runNewPythonFile(
                interactiveWindowProvider,
                '# %% [markdown]\n# # HEADER\n# **bold**\nprint(1)',
                disposables
            );
            const lastCell = await waitForLastCellToComplete(activeInteractiveWindow, 1, true);

            // Wait for the outputs to be available.
            await waitForCondition(
                async () => lastCell.outputs.length > 0 && lastCell.outputs[0].items.length > 0,
                defaultNotebookTestTimeout,
                'Outputs not available'
            );

            // Parse the last cell's output
            await waitForTextOutput(lastCell, '1');
        });

        async function preSwitch() {
            const pythonApi = await pythonApiProvider.getApi();
            await pythonApi.refreshInterpreters({ clearCache: true });
            const interpreterService = api.serviceContainer.get<IInterpreterService>(IInterpreterService);
            const interpreters = await interpreterService.getInterpreters();
            const venvNoKernelInterpreter = interpreters.find((i) => getFilePath(i.uri).includes('.venvnokernel'));
            const venvKernelInterpreter = interpreters.find((i) => getFilePath(i.uri).includes('.venvkernel'));

            if (!venvNoKernelInterpreter || !venvKernelInterpreter) {
                throw new Error(
                    `Unable to find matching kernels. List of kernels is ${interpreters
                        .map((i) => getFilePath(i.uri))
                        .join('\n')}`
                );
            }
            venNoKernelPath = venvNoKernelInterpreter.uri;
            venvKernelPath = venvKernelInterpreter.uri;
            originalActiveInterpreter = await interpreterService.getActiveInterpreter();

            // No kernel should not have ipykernel in it yet, but we need two, so install it.
            await installIPyKernel(venNoKernelPath.fsPath);
            assert.ok(originalActiveInterpreter, `No active interpreter when running switch test`);
        }
        async function postSwitch() {
            await uninstallIPyKernel(venNoKernelPath.fsPath);
            await setActiveInterpreter(pythonApiProvider, undefined, originalActiveInterpreter?.uri);
        }
        test('Switching active interpreter on a python file changes kernel in use', async function () {
            // Virtual environments are not available in conda
            if (IS_CONDA_TEST() || IS_REMOTE_NATIVE_TEST()) {
                this.skip();
            }
            await preSwitch();

            try {
                const interpreterService = await api.serviceManager.get<IInterpreterService>(IInterpreterService);
                const activeInterpreter = await interpreterService.getActiveInterpreter();
                const { activeInteractiveWindow, untitledPythonFile } = await runNewPythonFile(
                    interactiveWindowProvider,
                    'import sys\nprint(sys.executable)',
                    disposables
                );
                await waitForLastCellToComplete(activeInteractiveWindow, 1, true);
                let notebookDocument = vscode.workspace.notebookDocuments.find(
                    (doc) => doc.uri.toString() === activeInteractiveWindow?.notebookUri?.toString()
                )!;
                const notebookControllerManager =
                    api.serviceManager.get<INotebookControllerManager>(INotebookControllerManager);
                // Ensure we picked up the active interpreter for use as the kernel

                let controller = notebookDocument
                    ? notebookControllerManager.getSelectedNotebookController(notebookDocument)
                    : undefined;
                assert.ok(
                    areInterpreterPathsSame(controller?.connection.interpreter?.uri, activeInterpreter?.uri),
                    `Controller does not match active interpreter for ${getDisplayPath(
                        notebookDocument?.uri
                    )} - active: ${activeInterpreter?.uri} controller: ${controller?.connection.interpreter?.uri}`
                );

                // Now switch the active interpreter to the other path
                if (isEqual(activeInterpreter?.uri, venNoKernelPath)) {
                    await setActiveInterpreter(pythonApiProvider, untitledPythonFile.uri, venvKernelPath);
                } else {
                    await setActiveInterpreter(pythonApiProvider, untitledPythonFile.uri, venNoKernelPath);
                }

                // Close the interactive window and recreate it
                await closeInteractiveWindow(activeInteractiveWindow);

                // Run again and make sure it uses the new interpreter
                const newIW = await runCurrentFile(interactiveWindowProvider, untitledPythonFile);
                await waitForLastCellToComplete(newIW, 1, true);

                // Make sure it's a new window
                assert.notEqual(newIW, activeInteractiveWindow, `New IW was not created`);

                // Get the controller
                notebookDocument = vscode.workspace.notebookDocuments.find(
                    (doc) => doc.uri.toString() === newIW?.notebookUri?.toString()
                )!;
                controller = notebookDocument
                    ? notebookControllerManager.getSelectedNotebookController(notebookDocument)
                    : undefined;

                // Controller path should not be the same as the old active interpreter
                assert.isFalse(
                    areInterpreterPathsSame(controller?.connection.interpreter?.uri, activeInterpreter?.uri),
                    `Controller should not match active interpreter for ${getDisplayPath(
                        notebookDocument?.uri
                    )} after changing active interpreter`
                );
            } finally {
                await postSwitch();
            }
        });

        // todo@joyceerhl
        // test('Verify CWD', () => { });
        // test('Multiple executes go to last active window', async () => { });
        // test('Per file', async () => { });
        // test('Per file asks and changes titles', async () => { });
        // test('Debug cell with leading newlines', () => { });
        // test('Debug cell with multiple function definitions', () => { });
        // test('Should skip empty cells from #%% file or input box', () => { });
        // test('Export', () => { });
    });
});
