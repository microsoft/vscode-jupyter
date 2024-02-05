// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as vscode from 'vscode';
import { traceInfo, traceInfoIfCI } from '../../platform/logging';
import { getDisplayPath } from '../../platform/common/platform/fs-paths';
import { IDisposable, InteractiveWindowMode } from '../../platform/common/types';
import { InteractiveWindowProvider } from '../../interactive-window/interactiveWindowProvider';
import { IKernelProvider } from '../../kernels/types';
import {
    captureScreenShot,
    createEventHandler,
    createTemporaryFile,
    IExtensionTestApi,
    initialize,
    startJupyterServer,
    waitForCondition
} from '../common';
import {
    createStandaloneInteractiveWindow,
    insertIntoInputEditor,
    runInteractiveWindowInput,
    runNewPythonFile,
    submitFromPythonFile,
    submitFromPythonFileUsingCodeWatcher,
    waitForCodeLenses,
    waitForInteractiveWindow,
    waitForLastCellToComplete
} from './helpers';
import {
    assertHasTextOutputInVSCode,
    clickOKForRestartPrompt,
    closeNotebooksAndCleanUpAfterTests,
    defaultNotebookTestTimeout,
    generateTemporaryFilePath,
    hijackSavePrompt,
    waitForExecutionCompletedSuccessfully,
    waitForExecutionCompletedWithErrors,
    waitForTextOutput,
    WindowPromptStubButtonClickOptions
} from './notebook/helper';
import { IInteractiveWindowProvider } from '../../interactive-window/types';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { areInterpreterPathsSame } from '../../platform/pythonEnvironments/info/interpreter';
import { IS_REMOTE_NATIVE_TEST } from '../constants';
import { sleep } from '../core';
import { IPYTHON_VERSION_CODE } from '../constants';
import { translateCellErrorOutput, getTextOutputValue } from '../../kernels/execution/helpers';
import dedent from 'dedent';
import { generateCellRangesFromDocument } from '../../interactive-window/editor-integration/cellFactory';
import { Commands } from '../../platform/common/constants';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import { format } from 'util';
import { InteractiveWindow } from '../../interactive-window/interactiveWindow';
import { isSysInfoCell } from '../../interactive-window/systemInfoCell';
import { getNotebookUriFromInputBoxUri } from '../../standalone/intellisense/notebookPythonPathService';

suite(`Interactive window execution @iw`, async function () {
    this.timeout(120_000);
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let interactiveWindowProvider: InteractiveWindowProvider;
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        api = await initialize();
        if (IS_REMOTE_NATIVE_TEST()) {
            await startJupyterServer();
        }
        interactiveWindowProvider = api.serviceManager.get(IInteractiveWindowProvider);
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        if (this.currentTest?.isFailed()) {
            // For a flaky interrupt test.
            await captureScreenShot(this);
        }
        await closeNotebooksAndCleanUpAfterTests(disposables);
        // restore the default value
        const settings = vscode.workspace.getConfiguration('jupyter', null);
        await settings.update('interactiveWindow.creationMode', 'multiple');
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    test('__file__ exists even after restarting a kernel', async function () {
        // https://github.com/microsoft/vscode-jupyter/issues/12251
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
        const controllerRegistration = api.serviceManager.get<IControllerRegistration>(IControllerRegistration);
        // Ensure we picked up the active interpreter for use as the kernel
        const interpreterService = await api.serviceManager.get<IInterpreterService>(IInterpreterService);

        // Give it a bit to warm up
        await sleep(500);

        const controller = notebookDocument ? controllerRegistration.getSelected(notebookDocument) : undefined;
        if (!IS_REMOTE_NATIVE_TEST()) {
            const activeInterpreter = await interpreterService.getActiveInterpreter();
            assert.ok(
                areInterpreterPathsSame(controller?.connection.interpreter?.uri, activeInterpreter?.uri),
                `Controller does not match active interpreter for ${getDisplayPath(
                    notebookDocument?.uri
                )}, active interpreter is ${getDisplayPath(
                    activeInterpreter?.uri
                )} and controller is ${controller?.id} with interpreter ${getDisplayPath(
                    controller?.connection?.interpreter?.uri
                )}`
            );
        }
        async function verifyCells() {
            // Verify sys info cell
            const firstCell = notebookDocument.cellAt(0);
            assert.ok(isSysInfoCell(firstCell), 'First cell should be sys info cell');
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
        const kernel = kernelProvider.get(notebookDocument);
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

        await runInteractiveWindowInput('print("foo")', activeInteractiveWindow, 1);

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

    test('Clear input box', async () => {
        const text = '42';
        // Create interactive window with no owner
        let interactiveWindow = await createStandaloneInteractiveWindow(interactiveWindowProvider);
        await insertIntoInputEditor(text, interactiveWindow);

        // Clear input and verify
        assert.ok(vscode.window.activeTextEditor?.document.getText() === text, 'Text not inserted into input editor');
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
        await settings.update('interactiveWindow.creationMode', 'multiple');
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

    test.only('Leading and trailing empty lines in #%% cell are trimmed', async () => {
        const actualCode = `    print('foo')



    print('bar')`;
        const dedentedCode = `print('foo')



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
        assert.equal(actualCellText, dedentedCode);
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
        let lastErrorMessage = 'No output found';
        await waitForCondition(
            async () => {
                try {
                    notebookDocument?.getCells().forEach((c, i) => {
                        if (
                            c.document.uri.scheme === 'vscode-notebook-cell' &&
                            c.kind == vscode.NotebookCellKind.Code
                        ) {
                            assertHasTextOutputInVSCode(c, `${i}`);
                        }
                    });
                    return true;
                } catch (ex) {
                    lastErrorMessage = format(ex);
                    return false;
                }
            },
            defaultNotebookTestTimeout,
            () => lastErrorMessage
        );
    });

    test('Run a latex cell with a cell marker', async () => {
        const { activeInteractiveWindow } = await runNewPythonFile(
            interactiveWindowProvider,
            dedent`
                # %%
                %%latex
                \begin{align}
                \nabla \cdot \vec{\mathbf{E}} & = 4 \pi \rho \\
                \nabla \times \vec{\mathbf{E}}\, +\, \frac1c\, \frac{\partial\vec{\mathbf{B}}}{\partial t} & = \vec{\mathbf{0}} \\
                \nabla \cdot \vec{\mathbf{B}} & = 0
                \end{align}
                `,
            disposables
        );

        await waitForLastCellToComplete(activeInteractiveWindow);

        const notebookDocument = vscode.workspace.notebookDocuments.find(
            (doc) => doc.uri.toString() === activeInteractiveWindow?.notebookUri?.toString()
        );
        const lastCell = notebookDocument!.cellAt(notebookDocument!.cellCount - 1)!;
        await waitForCondition(
            () => lastCell.outputs[0].items[0].mime === 'text/latex',
            defaultNotebookTestTimeout,
            () => `Output should be markdown, but is ${lastCell.outputs[0].items[0].mime}`
        );
        await waitForCondition(
            () => lastCell.executionSummary?.executionOrder === 1,
            defaultNotebookTestTimeout,
            `Cell should have an execution order of 1, but has ${lastCell.executionSummary?.executionOrder}`
        );
        await waitForCondition(
            () => lastCell.executionSummary?.success === true,
            defaultNotebookTestTimeout,
            'Cell should have executed successfully'
        );
    });

    test('Run current file in interactive window (without cells)', async () => {
        const source = 'a=1\nprint(a)';
        const { activeInteractiveWindow } = await runNewPythonFile(
            interactiveWindowProvider,
            'a=1\nprint(a)',
            disposables
        );

        await waitForLastCellToComplete(activeInteractiveWindow, 1);

        const notebookDocument = vscode.workspace.notebookDocuments.find(
            (doc) => doc.uri.toString() === activeInteractiveWindow?.notebookUri?.toString()
        );

        // Ensure we picked up the active interpreter for use as the kernel
        if (!IS_REMOTE_NATIVE_TEST()) {
            const interpreterService = api.serviceManager.get<IInterpreterService>(IInterpreterService);
            const controllerSelection = api.serviceManager.get<IControllerRegistration>(IControllerRegistration);
            const controller = notebookDocument ? controllerSelection.getSelected(notebookDocument) : undefined;
            const activeInterpreter = await interpreterService.getActiveInterpreter();
            assert.ok(
                areInterpreterPathsSame(controller?.connection.interpreter?.uri, activeInterpreter?.uri),
                `Controller does not match active interpreter for ${getDisplayPath(
                    notebookDocument?.uri
                )}, active interpreter is ${getDisplayPath(
                    activeInterpreter?.uri
                )} and controller is ${controller?.id} with interpreter ${getDisplayPath(
                    controller?.connection?.interpreter?.uri
                )}`
            );
        }

        // Verify sys info cell
        const firstCell = notebookDocument?.cellAt(0);
        assert.ok(firstCell, 'cell not added');
        assert.ok(isSysInfoCell(firstCell!), 'First cell should be sys info cell');
        assert.equal(firstCell?.kind, vscode.NotebookCellKind.Markup, 'First cell should be markdown cell');

        // Verify executed cell input and output
        const secondCell = notebookDocument?.cellAt(1);
        const actualSource = secondCell?.document.getText();
        assert.equal(actualSource, source, `Executed cell has unexpected source code`);
        await waitForExecutionCompletedSuccessfully(secondCell!);
        await waitForTextOutput(secondCell!, '1');
    });

    test('Error stack traces have correct line hrefs with mix of cell sources', async function () {
        const settings = vscode.workspace.getConfiguration('jupyter', null);
        await settings.update('interactiveWindow.creationMode', 'single');

        const interactiveWindow = await createStandaloneInteractiveWindow(interactiveWindowProvider);
        await runInteractiveWindowInput('print(1)', interactiveWindow, 1);

        await runNewPythonFile(interactiveWindowProvider, '# %%\nx = 1\nNotDefined\nx = 2', disposables);
        const lastCell = await waitForLastCellToComplete(interactiveWindow, 2, true);

        // Wait for the outputs to be available.
        await waitForCondition(
            async () => lastCell.outputs.length > 0 && lastCell.outputs[0].items.length > 0,
            defaultNotebookTestTimeout,
            'Outputs not available'
        );

        // Parse the last cell's error output
        const errorOutput = translateCellErrorOutput(lastCell.outputs[0]);
        assert.ok(errorOutput, 'No error output found');
        assert.equal(errorOutput.traceback.length, 4, 'Traceback wrong size');

        // Convert to html for easier parsing
        const ansiToHtml = require('ansi-to-html') as typeof import('ansi-to-html');
        const converter = new ansiToHtml();
        const html = converter.toHtml(errorOutput.traceback.join('\n')) as string;

        assert.ok(html.includes('Traceback (most recent call last)'), 'traceback not found in output');
        assert.ok(/tmp-[^\.]*\.py:3/.test(html), 'link to file not found');
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
        const html = converter.toHtml(errorOutput.traceback.join('\n')) as string;

        const text = html.replace(/<[^>]+>/g, '');
        assert.ok(text.includes('Traceback (most recent call last)'), 'traceback not found in output');
        assert.ok(text.includes('def raiser():'), 'function definition not found in stack trace');
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

        // Parse the last cell's error output
        const errorOutput = translateCellErrorOutput(lastCell.outputs[0]);
        assert.ok(errorOutput, 'No error output found');

        // Convert to html for easier parsing
        const ansiToHtml = require('ansi-to-html') as typeof import('ansi-to-html');
        const converter = new ansiToHtml();
        const html = converter.toHtml(errorOutput.traceback.join('\n'));

        const text = html.replace(/<[^>]+>/g, '');
        assert.ok(text.includes('Traceback (most recent call last)'), 'traceback not found in output');
        assert.ok(/pathlib\.py:\d+, in PurePath\.joinpath/.test(text), 'library frame not found');
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

    test('Export Interactive window to Python file', async () => {
        const activeInteractiveWindow = await createStandaloneInteractiveWindow(interactiveWindowProvider);
        await waitForInteractiveWindow(activeInteractiveWindow);

        // Add a few cells from the input box
        await runInteractiveWindowInput('print("first")', activeInteractiveWindow, 1);
        await runInteractiveWindowInput('print("second")', activeInteractiveWindow, 2);
        await runInteractiveWindowInput('print("third")', activeInteractiveWindow, 3);

        await waitForLastCellToComplete(activeInteractiveWindow, 3, false);

        // the file is only saved on web, so handle the prompt if it appears, but don't wait for it
        let notebookFile = await generateTemporaryFilePath('py', disposables);
        const promptOptions: WindowPromptStubButtonClickOptions = {
            result: notebookFile,
            clickImmediately: true
        };
        await hijackSavePrompt('Export', promptOptions, disposables);

        await vscode.commands.executeCommand(Commands.ExportAsPythonScript, activeInteractiveWindow.notebookDocument);

        await waitForCondition(
            () => {
                // open document is python file with 3 "cells"
                let exportedDocument = vscode.window.visibleTextEditors.find((editor) => {
                    const cells = generateCellRangesFromDocument(editor.document);
                    return editor.document.languageId === 'python' && cells.length == 3;
                });

                return exportedDocument !== undefined;
            },
            60_000,
            'Exported python file was not opened'
        );
    });

    test('Cells from python files and the input box are executed in correct order', async () => {
        const source = ['# %%', 'x = 1', '# %%', 'import time', 'time.sleep(3)', '# %%', 'print(x)', ''].join('\n');
        const tempFile = await createTemporaryFile({ contents: 'print(42)', extension: '.py' });
        await vscode.window.showTextDocument(tempFile.file);
        await vscode.commands.executeCommand(Commands.RunAllCells);

        const edit = new vscode.WorkspaceEdit();
        const textEdit = vscode.TextEdit.replace(new vscode.Range(0, 0, 0, 9), source);
        edit.set(tempFile.file, [textEdit]);
        await vscode.workspace.applyEdit(edit);
        await waitForCodeLenses(tempFile.file, Commands.DebugCell);

        let runFilePromise = vscode.commands.executeCommand(Commands.RunAllCells);

        const settings = vscode.workspace.getConfiguration('jupyter', null);
        const mode = (await settings.get('interactiveWindow.creationMode')) as InteractiveWindowMode;
        const interactiveWindow = interactiveWindowProvider.getExisting(tempFile.file, mode) as InteractiveWindow;
        await runInteractiveWindowInput('x = 5', interactiveWindow, 5);
        await runFilePromise;
        await waitForLastCellToComplete(interactiveWindow, 5, false);

        const cells = interactiveWindow
            .notebookDocument!.getCells()
            .filter((c) => c.kind === vscode.NotebookCellKind.Code);
        const printCell = cells[cells.length - 2];

        const output = getTextOutputValue(printCell.outputs[0]);
        assert.equal(output.trim(), '1', 'original value should have been printed');
    });

    test('Get the notebook resource for the IW input box', async () => {
        const { activeInteractiveWindow, untitledPythonFile } = await runNewPythonFile(
            interactiveWindowProvider,
            'print(1)',
            disposables
        );

        const notebookUri = getNotebookUriFromInputBoxUri(activeInteractiveWindow.inputUri);
        assert.ok(notebookUri?.path.endsWith('.interactive'));

        const badUri = getNotebookUriFromInputBoxUri(untitledPythonFile.uri);
        assert.notOk(badUri);
    });
});
