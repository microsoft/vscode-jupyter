// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import * as vscode from 'vscode';
import { IPythonApiProvider } from '../../client/api/types';
import { PYTHON_LANGUAGE } from '../../client/common/constants';
import { InteractiveWindow } from '../../client/datascience/interactive-window/interactiveWindow';
import { InteractiveWindowProvider } from '../../client/datascience/interactive-window/interactiveWindowProvider';
import { IInteractiveWindowProvider } from '../../client/datascience/types';
import { IExtensionTestApi, waitForCondition } from '../common';
import { closeActiveWindows, initialize, IS_REMOTE_NATIVE_TEST } from '../initialize';
import {
    assertHasTextOutputInVSCode,
    assertNotHasTextOutputInVSCode,
    waitForExecutionCompletedSuccessfully
} from './notebook/helper';

suite('Interactive window', async () => {
    let api: IExtensionTestApi;
    let interactiveWindowProvider: InteractiveWindowProvider;

    setup(async function () {
        if (IS_REMOTE_NATIVE_TEST) {
            return this.skip();
        }
        api = await initialize();
        interactiveWindowProvider = api.serviceManager.get(IInteractiveWindowProvider);
    });

    teardown(async () => {
        await closeActiveWindows();
    });

    test('Execute cell from Python file', async () => {
        const source = 'print(42)';
        const { activeInteractiveWindow } = await submitFromPythonFile(source);
        const notebookDocument = vscode.workspace.notebookDocuments.find(
            (doc) => doc.uri.toString() === activeInteractiveWindow?.notebookUri?.toString()
        );

        // Ensure we picked up the active interpreter for use as the kernel
        const pythonApi = await api.serviceManager.get<IPythonApiProvider>(IPythonApiProvider).getApi();
        const activeInterpreter = await pythonApi.getActiveInterpreter();
        assert.equal(
            activeInteractiveWindow.notebookController?.connection.interpreter?.path,
            activeInterpreter?.path,
            'Controller does not match active interpreter'
        );
        assert.equal(
            activeInteractiveWindow.notebookController?.connection.interpreter?.envName,
            activeInterpreter?.envName,
            'Controller does not match active interpreter'
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

    test('Execute cell from input box', async () => {
        // Create new interactive window
        const activeInteractiveWindow = (await interactiveWindowProvider.getOrCreate(undefined)) as InteractiveWindow;

        // Add code to the input box
        await vscode.window.activeTextEditor?.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), 'print("foo")');
        });

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

    test('Clear output', async () => {
        const text = `from IPython.display import clear_output
for i in range(10):
    clear_output()
    print("Hello World {0}!".format(i))
`;
        const { activeInteractiveWindow } = await submitFromPythonFile(text);
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
        const { activeInteractiveWindow, untitledPythonFile } = await submitFromPythonFile('a=1\na');
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
        const { activeInteractiveWindow: interactiveWindow } = await submitFromPythonFile(codeWithWhitespace);
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
        const { activeInteractiveWindow } = await submitFromPythonFile(code);
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

async function createStandaloneInteractiveWindow(interactiveWindowProvider: InteractiveWindowProvider) {
    const activeInteractiveWindow = (await interactiveWindowProvider.getOrCreate(undefined)) as InteractiveWindow;
    return activeInteractiveWindow;
}

async function insertIntoInputEditor(source: string) {
    // Add code to the input box
    await vscode.window.activeTextEditor?.edit((editBuilder) => {
        editBuilder.insert(new vscode.Position(0, 0), source);
    });
}

export async function submitFromPythonFile(source: string) {
    const api = await initialize();
    const interactiveWindowProvider = api.serviceManager.get<InteractiveWindowProvider>(IInteractiveWindowProvider);
    const untitledPythonFile = await vscode.workspace.openTextDocument({
        language: PYTHON_LANGUAGE,
        content: source
    });
    await vscode.window.showTextDocument(untitledPythonFile);
    const activeInteractiveWindow = (await interactiveWindowProvider.getOrCreate(
        untitledPythonFile.uri
    )) as InteractiveWindow;
    await activeInteractiveWindow.addCode(source, untitledPythonFile.uri, 0);
    return { activeInteractiveWindow, untitledPythonFile };
}

async function waitForLastCellToComplete(interactiveWindow: InteractiveWindow) {
    const notebookDocument = vscode.workspace.notebookDocuments.find(
        (doc) => doc.uri.toString() === interactiveWindow?.notebookUri?.toString()
    );
    const cells = notebookDocument?.getCells();
    assert.ok(notebookDocument !== undefined, 'Interactive window notebook document not found');
    let codeCell: vscode.NotebookCell | undefined;
    for (let i = cells!.length - 1; i >= 0; i -= 1) {
        if (cells![i].kind === vscode.NotebookCellKind.Code) {
            codeCell = cells![i];
            break;
        }
    }
    assert.ok(codeCell !== undefined, 'No code cell found in interactive window notebook document');
    await waitForExecutionCompletedSuccessfully(codeCell!);
    return codeCell!;
}
