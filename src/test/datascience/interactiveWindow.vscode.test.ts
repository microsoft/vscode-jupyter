// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { IPythonApiProvider } from '../../client/api/types';
import { traceInfo, traceInfoIfCI } from '../../client/common/logger';
import { getDisplayPath } from '../../client/common/platform/fs-paths';
import { IDisposable } from '../../client/common/types';
import { InteractiveWindowProvider } from '../../client/datascience/interactive-window/interactiveWindowProvider';
import { INotebookControllerManager } from '../../client/datascience/notebook/types';
import { IInteractiveWindowProvider } from '../../client/datascience/types';
import { IExtensionTestApi, sleep, waitForCondition } from '../common';
import { initialize, IS_REMOTE_NATIVE_TEST } from '../initialize';
import {
    createStandaloneInteractiveWindow,
    insertIntoInputEditor,
    submitFromPythonFile,
    waitForLastCellToComplete
} from './helpers';
import {
    assertHasTextOutputInVSCode,
    assertNotHasTextOutputInVSCode,
    clickOKForRestartPrompt,
    closeNotebooksAndCleanUpAfterTests,
    defaultNotebookTestTimeout,
    waitForExecutionCompletedSuccessfully
} from './notebook/helper';

suite('Interactive window', async function () {
    this.timeout(120_000);
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let interactiveWindowProvider: InteractiveWindowProvider;

    setup(async function () {
        if (IS_REMOTE_NATIVE_TEST) {
            return this.skip();
        }
        traceInfo(`Start Test ${this.currentTest?.title}`);
        api = await initialize();
        interactiveWindowProvider = api.serviceManager.get(IInteractiveWindowProvider);
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        sinon.restore();
        await closeNotebooksAndCleanUpAfterTests(disposables);
    });

    test('Execute cell from Python file', async () => {
        const source = 'print(42)';
        const { activeInteractiveWindow } = await submitFromPythonFile(interactiveWindowProvider, source, disposables);
        const notebookDocument = vscode.workspace.notebookDocuments.find(
            (doc) => doc.uri.toString() === activeInteractiveWindow?.notebookUri?.toString()
        );
        const notebookControllerManager = api.serviceManager.get<INotebookControllerManager>(
            INotebookControllerManager
        );

        // Ensure we picked up the active interpreter for use as the kernel
        const pythonApi = await api.serviceManager.get<IPythonApiProvider>(IPythonApiProvider).getApi();

        // Give it a bit to warm up
        await sleep(500);

        const controller = notebookDocument
            ? notebookControllerManager.getSelectedNotebookController(notebookDocument)
            : undefined;
        const activeInterpreter = await pythonApi.getActiveInterpreter();
        assert.equal(
            controller?.connection.interpreter?.path,
            activeInterpreter?.path,
            `Controller does not match active interpreter for ${getDisplayPath(notebookDocument?.uri)}`
        );

        // Verify sys info cell
        const firstCell = notebookDocument?.cellAt(0);
        assert.ok(firstCell?.metadata.isInteractiveWindowMessageCell, 'First cell should be sys info cell');
        assert.equal(firstCell?.kind, vscode.NotebookCellKind.Markup, 'First cell should be markdown cell');

        // Verify executed cell input and output
        const secondCell = notebookDocument?.cellAt(1);
        const actualSource = secondCell?.document.getText();
        assert.equal(actualSource, source, `Executed cell has unexpected source code`);
        await waitForExecutionCompletedSuccessfully(secondCell!);
        assertHasTextOutputInVSCode(secondCell!, '42');
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
        const notebookControllerManager = api.serviceManager.get<INotebookControllerManager>(
            INotebookControllerManager
        );
        // Ensure we picked up the active interpreter for use as the kernel
        const pythonApi = await api.serviceManager.get<IPythonApiProvider>(IPythonApiProvider).getApi();

        // Give it a bit to warm up
        await sleep(500);

        const controller = notebookDocument
            ? notebookControllerManager.getSelectedNotebookController(notebookDocument)
            : undefined;
        const activeInterpreter = await pythonApi.getActiveInterpreter();
        assert.equal(
            controller?.connection.interpreter?.path,
            activeInterpreter?.path,
            `Controller does not match active interpreter for ${getDisplayPath(notebookDocument?.uri)}`
        );

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
        await vscode.commands.executeCommand('jupyter.restartkernel');
        // Wait for first cell to get output.
        await waitForCondition(
            async () => notebookDocument.cellCount > 0,
            defaultNotebookTestTimeout,
            'Kernel info not printed'
        );
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

        // Add code to the input box
        await insertIntoInputEditor('print("foo")');

        // Run the code in the input box
        await vscode.commands.executeCommand('interactive.execute');

        // Inspect notebookDocument for output
        const notebook = vscode.workspace.notebookDocuments.find(
            (notebookDocument) => notebookDocument.uri.toString() === activeInteractiveWindow.notebookUri?.toString()
        );
        assert.ok(notebook !== undefined, 'No interactive window found');
        const index = notebook!.cellCount - 1;
        const cell = notebook!.cellAt(index);
        await waitForCondition(async () => assertHasTextOutputInVSCode(cell, 'foo'), 15_000, 'Incorrect output');
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
        const { activeInteractiveWindow } = await submitFromPythonFile(interactiveWindowProvider, text, disposables);
        const cell = await waitForLastCellToComplete(activeInteractiveWindow);
        assertHasTextOutputInVSCode(cell!, 'Hello World 9!');
    });

    test('Clear input box', async () => {
        const text = '42';
        // Create interactive window with no owner
        await createStandaloneInteractiveWindow(interactiveWindowProvider);
        await insertIntoInputEditor(text);

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

    test('Collapse / expand cell', async () => {
        // Cell should initially be collapsed
        const { activeInteractiveWindow, untitledPythonFile } = await submitFromPythonFile(
            interactiveWindowProvider,
            'a=1\na',
            disposables
        );
        const codeCell = await waitForLastCellToComplete(activeInteractiveWindow);
        assert.ok(codeCell.metadata.inputCollapsed === true, 'Cell input not initially collapsed');

        // Expand all cells
        await vscode.commands.executeCommand('jupyter.expandallcells');

        // Verify cell is now expanded
        assert.ok(codeCell?.metadata.inputCollapsed === false, 'Cell input not expanded after expanding all cells');

        // Add a markdown cell
        const markdownSource = `# %% [markdown]
# # Heading
# ## Sub-heading
# *bold*,_italic_
# Horizontal rule
# ---
# Bullet List
# * Apples
# * Pears
# Numbered List
# 1. ???
# 2. Profit
#
# [Link](http://www.microsoft.com)`;
        const edit = new vscode.WorkspaceEdit();
        const line = untitledPythonFile.getText().length;
        edit.insert(untitledPythonFile.uri, new vscode.Position(line, 0), markdownSource);
        await vscode.workspace.applyEdit(edit);
        await activeInteractiveWindow.addCode(markdownSource, untitledPythonFile.uri, line);

        // Verify markdown cell is initially expanded
        const notebookDocument = vscode.workspace.notebookDocuments.find(
            (doc) => doc.uri.toString() === activeInteractiveWindow?.notebookUri?.toString()
        );
        const markdownCell = notebookDocument?.cellAt(notebookDocument.cellCount - 1);
        assert.ok(markdownCell?.metadata.inputCollapsed === false, 'Collapsing all cells should skip markdown cells');

        // Collapse all cells
        await vscode.commands.executeCommand('jupyter.collapseallcells');

        // Verify only the code cell was collapsed, not the markdown
        assert.ok(
            codeCell?.metadata.inputCollapsed === true,
            'Code cell input not collapsed after collapsing all cells'
        );
        assert.ok(markdownCell?.metadata.inputCollapsed === false, 'Collapsing all cells should skip markdown cells');
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
        assertHasTextOutputInVSCode(secondCell!, "'Hello'");

        // Create cell 3
        await insertIntoInputEditor('dh.update("Goodbye")');
        await vscode.commands.executeCommand('interactive.execute');
        // Last cell output is empty
        const thirdCell = await waitForLastCellToComplete(interactiveWindow);
        assert.equal(thirdCell?.outputs.length, 0, 'Third cell should not have any outputs');
        // Second cell output is updated
        assertHasTextOutputInVSCode(secondCell!, "'Goodbye'");
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

    async function runMagicCommandsTest(settingValue: boolean) {
        const settings = vscode.workspace.getConfiguration('jupyter', null);
        await settings.update('magicCommandsAsComments', settingValue);
        const code = `# %%
#!%%time
print('hi')`;
        const { activeInteractiveWindow } = await submitFromPythonFile(interactiveWindowProvider, code, disposables);
        const lastCell = await waitForLastCellToComplete(activeInteractiveWindow);
        assertHasTextOutputInVSCode(lastCell, 'hi', undefined, false);
        return lastCell;
    }

    test('jupyter.magicCommandsAsComments: `true`', async () => {
        const lastCell = await runMagicCommandsTest(true);
        assertHasTextOutputInVSCode(lastCell, 'Wall time:', undefined, false);
    });

    test('jupyter.magicCommandsAsComments: `false`', async () => {
        const lastCell = await runMagicCommandsTest(false);

        // Magic should have remained commented
        for (let outputIndex = 0; outputIndex < lastCell.outputs.length; outputIndex++) {
            assertNotHasTextOutputInVSCode(lastCell, 'Wall time:', outputIndex, false);
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
