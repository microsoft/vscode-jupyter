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
import { getTextOutputValue, translateCellErrorOutput } from '../../client/datascience/notebook/helpers/helpers';
import { INotebookControllerManager } from '../../client/datascience/notebook/types';
import { IDataScienceCodeLensProvider, IInteractiveWindowProvider } from '../../client/datascience/types';
import { captureScreenShot, IExtensionTestApi, sleep, waitForCondition } from '../common';
import { initialize, IPYTHON_VERSION_CODE, IS_REMOTE_NATIVE_TEST } from '../initialize';
import {
    createStandaloneInteractiveWindow,
    insertIntoInputEditor,
    runCurrentFile,
    submitFromPythonFile,
    submitFromPythonFileUsingCodeWatcher,
    waitForLastCellToComplete
} from './helpers';
import {
    assertHasTextOutputInVSCode,
    clickOKForRestartPrompt,
    closeNotebooksAndCleanUpAfterTests,
    defaultNotebookTestTimeout,
    waitForExecutionCompletedSuccessfully,
    waitForExecutionCompletedWithErrors,
    waitForTextOutput
} from './notebook/helper';

suite('Interactive window', async function () {
    this.timeout(120_000);
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let interactiveWindowProvider: InteractiveWindowProvider;
    let codeWatcherProvider: IDataScienceCodeLensProvider;

    setup(async function () {
        if (IS_REMOTE_NATIVE_TEST) {
            return this.skip();
        }
        traceInfo(`Start Test ${this.currentTest?.title}`);
        api = await initialize();
        interactiveWindowProvider = api.serviceManager.get(IInteractiveWindowProvider);
        codeWatcherProvider = api.serviceManager.get(IDataScienceCodeLensProvider);

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
        const { activeInteractiveWindow } = await submitFromPythonFile(interactiveWindowProvider, text, disposables);
        const cell = await waitForLastCellToComplete(activeInteractiveWindow);
        await waitForTextOutput(cell!, 'Hello World 9!');
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
        const source = '# %%\nprint(1)\n# %%\nimport time\ntime.sleep(1)\nraise Exception("foo")\n# %%\nprint(2)';
        const { activeInteractiveWindow } = await submitFromPythonFileUsingCodeWatcher(
            interactiveWindowProvider,
            codeWatcherProvider,
            source,
            disposables
        );
        const notebookDocument = vscode.workspace.notebookDocuments.find(
            (doc) => doc.uri.toString() === activeInteractiveWindow?.notebookUri?.toString()
        );

        await waitForCondition(
            async () => {
                return notebookDocument?.cellCount == 4;
            },
            defaultNotebookTestTimeout,
            `Cells should be added`
        );
        const secondCell = notebookDocument?.cellAt(2);
        await waitForExecutionCompletedWithErrors(secondCell!);
        await waitForCondition(
            async () => {
                return notebookDocument?.cellCount == 5;
            },
            defaultNotebookTestTimeout,
            `Markdown error didnt appear`
        );
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
        const { activeInteractiveWindow } = await runCurrentFile(
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
        const { activeInteractiveWindow } = await runCurrentFile(
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
        const { activeInteractiveWindow } = await runCurrentFile(
            interactiveWindowProvider,
            '# %%\ndef raiser():\n  raise Exception("error")\n# %%\nraiser()',
            disposables
        );
        const lastCell = await waitForLastCellToComplete(activeInteractiveWindow, 2, true);

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
        assert.equal(hrefs?.length, 3, '3 hrefs not found in traceback');
        assert.ok(hrefs[0].endsWith("line=4'"), 'Wrong first ref line');
        assert.ok(hrefs[1].endsWith("line=1'"), 'Wrong second ref line');
        assert.ok(hrefs[2].endsWith("line=2'"), 'Wrong third ref line');
    });

    test('Raising an exception from system code has a stack trace', async function () {
        const { activeInteractiveWindow } = await runCurrentFile(
            interactiveWindowProvider,
            `# %%\n${IPYTHON_VERSION_CODE}# %%\nimport pathlib as pathlib\nx = pathlib.Path()\ny = None\nx.joinpath(y, "Foo")`,
            disposables
        );
        const lastCell = await waitForLastCellToComplete(activeInteractiveWindow, 2, true);
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
        const { activeInteractiveWindow } = await runCurrentFile(
            interactiveWindowProvider,
            '# %% [markdown]\n# # HEADER\n# **bold**\nprint(1)',
            disposables
        );
        const lastCell = await waitForLastCellToComplete(activeInteractiveWindow, 1, true);

        // Parse the last cell's output
        await waitForTextOutput(lastCell, '1');
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
