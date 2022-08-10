// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import * as urlPath from '../../../platform/vscode-path/resources';
import * as sinon from 'sinon';
import { commands, ConfigurationTarget, NotebookCell, Uri, workspace } from 'vscode';
import { IVSCodeNotebook } from '../../../platform/common/application/types';
import { traceInfo } from '../../../platform/logging';
import { IDisposable } from '../../../platform/common/types';
import { IKernelProvider } from '../../../kernels/types';
import { captureScreenShot, IExtensionTestApi, startJupyterServer, waitForCondition } from '../../common';
import { closeActiveWindows, initialize } from '../../initialize';
import { openNotebook } from '../helpers';
import {
    closeNotebooks,
    closeNotebooksAndCleanUpAfterTests,
    createTemporaryNotebookFromFile,
    defaultNotebookTestTimeout,
    prewarmNotebooks,
    runCell,
    waitForCellExecutionToComplete,
    waitForExecutionCompletedSuccessfully,
    waitForKernelToGetAutoSelected,
    waitForTextOutput
} from '../notebook/helper';
import { initializeWidgetComms, Utils } from './commUtils';
import { WidgetRenderingTimeoutForTests } from './constants';
import { getTextOutputValue } from '../../../kernels/execution/helpers';

const templateRootPath: Uri =
    workspace.workspaceFolders && workspace.workspaceFolders.length > 0
        ? urlPath.joinPath(workspace.workspaceFolders[0].uri, 'widgets', 'notebooks')
        : Uri.file('');
export async function initializeNotebookForWidgetTest(
    disposables: IDisposable[],
    options: { templateFile: string } | { notebookFile: Uri }
) {
    const nbUri =
        'templateFile' in options
            ? await createTemporaryNotebookFromFile(
                  urlPath.joinPath(templateRootPath, options.templateFile),
                  disposables
              )
            : options.notebookFile;
    await openNotebook(nbUri);
    await waitForKernelToGetAutoSelected();
    // Widgets get rendered only when the output is in view. If we have a very large notebook
    // and the output is not visible, then it will not get rendered & the tests will fail. The tests inspect the rendered HTML.
    // Solution - maximize available real-estate by hiding the output panels & hiding the input cells.
    await commands.executeCommand('workbench.action.closePanel');
    await commands.executeCommand('workbench.action.maximizeEditor');
    await commands.executeCommand('notebook.cell.collapseAllCellInputs');
    return initializeWidgetComms(disposables);
}
export async function executeCellAndWaitForOutput(cell: NotebookCell, comms: Utils) {
    await Promise.all([
        runCell(cell),
        waitForExecutionCompletedSuccessfully(cell),
        waitForCondition(async () => cell.outputs.length > 0, defaultNotebookTestTimeout, 'Cell output is empty'),
        comms.ready
    ]);
}
export async function executeCellAndDontWaitForOutput(cell: NotebookCell) {
    await Promise.all([runCell(cell), waitForExecutionCompletedSuccessfully(cell)]);
}
export async function assertOutputContainsHtml(
    cell: NotebookCell,
    comms: Utils,
    htmlFragmentsToLookFor: string[],
    selector?: string
) {
    // Verify the widget is created & rendered.
    let html = '';
    await waitForCondition(
        async () => {
            await comms.ready;
            html = await comms.queryHtml(cell, selector);
            htmlFragmentsToLookFor.forEach((fragment) => assert.include(html, fragment));
            return true;
        },
        WidgetRenderingTimeoutForTests,
        () => `Widget did not render or ${htmlFragmentsToLookFor.join(', ')} not in html = ${html}`,
        250 // Default 10ms results in too much logging when tests fail.
    );
}
export async function clickWidget(comms: Utils, cell: NotebookCell, selector: string) {
    await comms.click(cell, selector);
}

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('Standard IPyWidget Tests', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
    let kernelProvider: IKernelProvider;

    this.timeout(120_000);
    const widgetScriptSourcesValue = ['jsdelivr.com', 'unpkg.com'];
    // Retry at least once, because ipywidgets can be flaky (network, comms, etc).
    this.retries(1);
    suiteSetup(async function () {
        traceInfo('Suite Setup VS Code Notebook - Execution');
        this.timeout(120_000);
        api = await initialize();
        const config = workspace.getConfiguration('jupyter', undefined);
        await config.update('widgetScriptSources', widgetScriptSourcesValue, ConfigurationTarget.Global);
        await startJupyterServer();
        await prewarmNotebooks();
        sinon.restore();
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        kernelProvider = api.serviceContainer.get<IKernelProvider>(IKernelProvider);
        traceInfo('Suite Setup (completed)');
    });
    // Use same notebook without starting kernel in every single test (use one for whole suite).
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        sinon.restore();
        await startJupyterServer();
        await closeNotebooks();
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
        // With less realestate, the outputs might not get rendered (VS Code optimization to avoid rendering if not in viewport).
        await commands.executeCommand('workbench.action.closePanel');
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this);
        }
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(async () => closeNotebooksAndCleanUpAfterTests(disposables));
    test('Slider Widget', async function () {
        const comms = await initializeNotebookForWidgetTest(disposables, { templateFile: 'slider_widgets.ipynb' });
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;
        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(cell, comms, ['6519'], '.widget-readout');
    });
    test('Textbox Widget', async () => {
        const comms = await initializeNotebookForWidgetTest(disposables, {
            templateFile: 'standard_widgets.ipynb'
        });
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(1)!;
        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(cell, comms, ['<input type="text', 'Enter your name:'], '.widget-text');
    });
    test('Linking Widgets slider to textbox widget', async function () {
        const comms = await initializeNotebookForWidgetTest(disposables, { templateFile: 'slider_widgets.ipynb' });
        const [, cell1, cell2, cell3] = vscodeNotebook.activeNotebookEditor!.notebook.getCells()!;
        await executeCellAndDontWaitForOutput(cell1);
        await executeCellAndWaitForOutput(cell2, comms);
        await executeCellAndWaitForOutput(cell3, comms);
        await assertOutputContainsHtml(cell2, comms, ['0'], '.widget-readout');
        await assertOutputContainsHtml(cell3, comms, ['<input type="number']);

        // Update the textbox widget.
        await comms.setValue(cell3, '.widget-text input', '60');

        // Verify the slider has changed.
        await assertOutputContainsHtml(cell2, comms, ['60'], '.widget-readout');
    });
    test('Checkbox Widget', async () => {
        const comms = await initializeNotebookForWidgetTest(disposables, {
            templateFile: 'standard_widgets.ipynb'
        });
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(2)!;
        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(cell, comms, ['Check me', '<input type="checkbox'], '.widget-checkbox');
    });
    test('Button Widget (click button)', async () => {
        const comms = await initializeNotebookForWidgetTest(disposables, { templateFile: 'button_widgets.ipynb' });
        const [cell0, cell1, cell2] = vscodeNotebook.activeNotebookEditor!.notebook.getCells();

        await executeCellAndWaitForOutput(cell0, comms);
        await executeCellAndWaitForOutput(cell1, comms);
        await executeCellAndWaitForOutput(cell2, comms);
        await assertOutputContainsHtml(cell0, comms, ['Click Me!', '<button']);
        await assertOutputContainsHtml(cell1, comms, ['Click Me!', '<button']);

        // Click the button and verify we have output in other cells
        await clickWidget(comms, cell0, 'button');
        await assertOutputContainsHtml(cell0, comms, ['Button clicked']);
        await assertOutputContainsHtml(cell1, comms, ['Button clicked']);
        await assertOutputContainsHtml(cell2, comms, ['Button clicked']);
    });
    test('Button Widget (click button in output of another cell)', async () => {
        const comms = await initializeNotebookForWidgetTest(disposables, { templateFile: 'button_widgets.ipynb' });
        const [cell0, cell1, cell2] = vscodeNotebook.activeNotebookEditor!.notebook.getCells();

        await executeCellAndWaitForOutput(cell0, comms);
        await executeCellAndWaitForOutput(cell1, comms);
        await executeCellAndWaitForOutput(cell2, comms);
        await assertOutputContainsHtml(cell0, comms, ['Click Me!', '<button']);
        await assertOutputContainsHtml(cell1, comms, ['Click Me!', '<button']);

        // Click the button and verify we have output in other cells
        await clickWidget(comms, cell1, 'button');
        await assertOutputContainsHtml(cell0, comms, ['Button clicked']);
        await assertOutputContainsHtml(cell1, comms, ['Button clicked']);
        await assertOutputContainsHtml(cell2, comms, ['Button clicked']);
    });
    test('Button Widget with custom comm message', async () => {
        const comms = await initializeNotebookForWidgetTest(disposables, {
            templateFile: 'button_widget_comm_msg.ipynb'
        });
        const [cell0, cell1] = vscodeNotebook.activeNotebookEditor!.notebook.getCells();

        await executeCellAndWaitForOutput(cell0, comms);
        await executeCellAndWaitForOutput(cell1, comms);
        await assertOutputContainsHtml(cell0, comms, ['Click Me!', '<button']);

        // Click the button and verify we have output in the same cell.
        await clickWidget(comms, cell0, 'button');
        await waitForTextOutput(cell0, 'Button clicked.', 1, false);
    });
    test.skip('Widget renders after executing a notebook which was saved after previous execution', async () => {
        // https://github.com/microsoft/vscode-jupyter/issues/8748
        let comms = await initializeNotebookForWidgetTest(disposables, { templateFile: 'standard_widgets.ipynb' });
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;
        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(cell, comms, ['66'], '.widget-readout');

        // Restart the kernel.
        const uri = vscodeNotebook.activeNotebookEditor!.notebook.uri;
        await commands.executeCommand('workbench.action.files.save');
        await closeActiveWindows();

        // Open this notebook again.
        comms = await initializeNotebookForWidgetTest(disposables, { notebookFile: uri });

        // Verify we have output in the first cell.
        assert.isOk(cell.outputs.length, 'No outputs in the cell after saving nb');

        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(cell, comms, ['66'], '.widget-readout');
    });
    test.skip('Widget renders after restarting kernel', async () => {
        const comms = await initializeNotebookForWidgetTest(disposables, {
            templateFile: 'standard_widgets.ipynb'
        });
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;
        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(cell, comms, ['66'], '.widget-readout');

        // Restart the kernel.
        const kernel = kernelProvider.get(vscodeNotebook.activeNotebookEditor!.notebook)!;
        await kernel.restart();
        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(cell, comms, ['66'], '.widget-readout');

        // Clear all cells and restart and test again.
        await kernel.restart();
        await commands.executeCommand('notebook.clearAllCellsOutputs');
        await waitForCondition(async () => cell.outputs.length === 0, 5_000, 'Cell did not get cleared');

        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(cell, comms, ['66'], '.widget-readout');
    });
    test.skip('Widget renders after interrupting kernel', async () => {
        // https://github.com/microsoft/vscode-jupyter/issues/8749
        const comms = await initializeNotebookForWidgetTest(disposables, {
            templateFile: 'standard_widgets.ipynb'
        });
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;
        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(cell, comms, ['66'], '.widget-readout');

        // Restart the kernel.
        const kernel = kernelProvider.get(vscodeNotebook.activeNotebookEditor!.notebook)!;
        await kernel.interrupt();
        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(cell, comms, ['66'], '.widget-readout');

        // Clear all cells and restart and test again.
        await kernel.interrupt();
        await commands.executeCommand('notebook.clearAllCellsOutputs');
        await waitForCondition(async () => cell.outputs.length === 0, 5_000, 'Cell did not get cleared');

        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(cell, comms, ['66'], '.widget-readout');
    });
    test('Nested Output Widgets', async () => {
        const comms = await initializeNotebookForWidgetTest(disposables, {
            templateFile: 'nested_output_widget.ipynb'
        });
        const [cell1, cell2, cell3, cell4] = vscodeNotebook.activeNotebookEditor!.notebook.getCells();
        await executeCellAndWaitForOutput(cell1, comms);

        // Run the second cell & verify we have output in the first cell.
        await Promise.all([runCell(cell2), waitForCellExecutionToComplete(cell1)]);
        await assertOutputContainsHtml(cell1, comms, ['First output widget'], '.widget-output');

        // Run the 3rd cell to add a nested output.
        // Also display the same nested output and the widget in the 3rd cell.
        await Promise.all([runCell(cell3), waitForCellExecutionToComplete(cell3)]);
        await assertOutputContainsHtml(cell1, comms, ['<input type="text', 'Label Widget'], '.widget-output');
        assert.strictEqual(cell3.outputs.length, 0, 'Cell 3 should not have any output');

        // Run the 4th cell & verify we have output in the first nested output & second output.
        await Promise.all([runCell(cell4), waitForCellExecutionToComplete(cell2)]);
        await assertOutputContainsHtml(cell1, comms, ['First output widget', 'Second output widget'], '.widget-output');
        assert.strictEqual(cell3.outputs.length, 0, 'Cell 3 should not have any output');

        // Verify both textbox widgets are linked.
        // I.e. updating one textbox will result in the other getting updated with the same value.
        await comms.setValue(cell1, '.widget-text input', 'Widgets are linked an get updated');
        await assertOutputContainsHtml(cell1, comms, ['>Widgets are linked an get updated<'], '.widget-output');
        assert.strictEqual(cell3.outputs.length, 0, 'Cell 3 should not have any output');
    });
    test('More Nested Output Widgets', async () => {
        const comms = await initializeNotebookForWidgetTest(disposables, {
            templateFile: 'nested_output_widget2.ipynb'
        });
        const [cell1, cell2, cell3, cell4, cell5, cell6] = vscodeNotebook.activeNotebookEditor!.notebook.getCells();
        let html = '';

        const runCellAndTestOutput = async (cell: NotebookCell) => {
            await executeCellAndWaitForOutput(cell, comms);
            await waitForCondition(
                () => cell.outputs.length === 3,
                WidgetRenderingTimeoutForTests,
                () => `Expected 3 outputs, only have ${cell.outputs.length}`
            );

            await comms.ready;
            // We should have Outside, Inside & button rendered.
            await waitForCondition(
                async () => {
                    html = await comms.queryHtml(cell);
                    return html.includes('Outside') && html.includes('Inside') && html.includes('<button');
                },
                WidgetRenderingTimeoutForTests,
                () => `Didn't find expected items, got ${html}`
            );
            // Ensure we have `<random number> Outside` & the exact same random number before the text `Inside`.
            let matches = html.match(/(\d\.\d*) (Outside|Inside)/g)!;
            assert.strictEqual(matches?.length, 2, 'Expected two matches');
            assert.strictEqual(
                matches[0].replace('Outside', '').replace('Inside', '').trim(),
                matches[1].replace('Outside', '').replace('Inside', '').trim()
            );
            const firstRandomNumber = matches[0].replace('Outside', '').trim();

            // Click the button, and we should get two numbers and should match for both outputs.
            await clickWidget(comms, cell, 'button');
            await waitForCondition(
                async () => {
                    html = await comms.queryHtml(cell);
                    return (
                        // Should not contain the old random number.
                        !html.includes(firstRandomNumber) &&
                        html.includes('Outside') &&
                        html.includes('Inside') &&
                        html.includes('<button')
                    );
                },
                WidgetRenderingTimeoutForTests,
                () => `Didn't find expected items, got ${html}`
            );

            // Ensure we have `<random number> Outside` & the exact same random number before the text `Inside`.
            matches = html.match(/(\d\.\d*) (Outside|Inside)/g)!;
            assert.strictEqual(matches?.length, 2, 'Expected two matches');
            assert.strictEqual(matches[0].replace('Outside', '').trim(), matches[1].replace('Inside', '').trim());
            const secondRandomNumber = matches[0].replace('Outside', '').trim();

            // In older versions only one output would get updated.
            // Ensure the second random number is not the same as the first.
            assert.notStrictEqual(firstRandomNumber, secondRandomNumber);
        };

        // Test output in first cell.
        await runCellAndTestOutput(cell1);

        // Test output in second cell.
        await runCellAndTestOutput(cell2);

        // Run the 3rd cell and verify we get the output `Hello`.
        await runCell(cell3);
        await waitForCondition(
            async () => {
                html = await comms.queryHtml(cell2);
                assert.include(html, 'Hello');
                // Verify the text `Hello` is after the text `Outside`.
                assert.isTrue(
                    html.indexOf('Hello') > html.indexOf('Outside'),
                    `Index of Hello should be after Outside, ${html}`
                );
                return true;
            },
            WidgetRenderingTimeoutForTests,
            () => `Output doesn't contain text 'Hello' value is ${html}`
        );

        // Run the 4th cell and verify we get the output `World`.
        await runCell(cell4);
        await waitForCondition(
            async () => {
                html = await comms.queryHtml(cell2);
                assert.include(html, 'World');
                // Verify the text `World` is after the text `Inside`.
                assert.isTrue(
                    html.indexOf('World') > html.indexOf('Inside'),
                    `Index of World should be after Inside, ${html}`
                );
                return true;
            },
            WidgetRenderingTimeoutForTests,
            () => `Output doesn't contain text 'World', html is ${html}`
        );

        // Verify we can clear the output of a nested output widget.
        // Run the 5th cell and verify we get the output `Foo` and the text `Inside` is now cleared.
        await runCell(cell5);
        await waitForCondition(
            async () => {
                html = await comms.queryHtml(cell2);
                return html.includes('Foo') && !html.includes('Inside');
            },
            WidgetRenderingTimeoutForTests,
            () => `Output doesn't contain text 'Foo' or still contains 'Inside', html is ${html}`
        );

        // Verify we can clear the outer output widget.
        // Run the 6th cell and verify we get the output `Bar` and the rest is cleared out.
        await runCell(cell6);
        await waitForCondition(
            async () => {
                html = await comms.queryHtml(cell2);
                assert.notInclude(html, 'Foo');
                assert.notInclude(html, 'Inside');
                assert.notInclude(html, 'Outside');
                assert.include(html, 'Bar');
                return true;
            },
            WidgetRenderingTimeoutForTests,
            () => `Output doesn't contain text 'Bar' or still contains 'Outside, Inside, Foo', html is ${html}`
        );
    });
    test('Interactive Button', async () => {
        const comms = await initializeNotebookForWidgetTest(disposables, {
            templateFile: 'interactive_button.ipynb'
        });
        const cell = vscodeNotebook.activeNotebookEditor!.notebook.cellAt(0);

        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(cell, comms, ['Click Me!', '<button']);

        // Click the button and verify we have output in other cells
        await clickWidget(comms, cell, 'button');
        await waitForCondition(
            () => {
                assert.strictEqual(getTextOutputValue(cell.outputs[1]).trim(), 'Button clicked');
                return true;
            },
            5_000,
            `Expected 'Button clicked' to exist in ${getTextOutputValue(cell.outputs[1])}`
        );
    });
    test('Interactive Function', async () => {
        const comms = await initializeNotebookForWidgetTest(disposables, {
            templateFile: 'interactive_function.ipynb'
        });
        const cell = vscodeNotebook.activeNotebookEditor!.notebook.cellAt(0);

        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(cell, comms, [
            '<input type="text',
            ">Executing do_something with 'Foo'",
            ">'Foo'"
        ]);
        await waitForCondition(() => cell.outputs.length >= 3, 5_000, 'Cell must have 3 outputs');
        assert.strictEqual(getTextOutputValue(cell.outputs[1]).trim(), `Executing do_something with 'Hello World'`);
        assert.strictEqual(getTextOutputValue(cell.outputs[2]).trim(), `'Hello World'`);

        // Update the textbox and confirm the output is updated accordingly.
        await comms.setValue(cell, '.widget-text input', 'Bar');
        await assertOutputContainsHtml(cell, comms, [
            '<input type="text',
            ">Executing do_something with 'Bar'",
            ">'Bar'"
        ]);
        assert.strictEqual(getTextOutputValue(cell.outputs[1]).trim(), `Executing do_something with 'Hello World'`);
        assert.strictEqual(getTextOutputValue(cell.outputs[2]).trim(), `'Hello World'`);
    });
    test('Interactive Plot', async () => {
        const comms = await initializeNotebookForWidgetTest(disposables, {
            templateFile: 'interactive_plot.ipynb'
        });
        const cell = vscodeNotebook.activeNotebookEditor!.notebook.cellAt(0);

        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(cell, comms, ['Text Value is Foo']);
        assert.strictEqual(cell.outputs.length, 4, 'Cell should have 4 outputs');

        // This cannot be displayed by output widget, hence we need to handle this.
        assert.strictEqual(cell.outputs[1].items[0].mime, 'application/vnd.custom');
        assert.strictEqual(Buffer.from(cell.outputs[1].items[0].data).toString(), 'Text Value is Foo');

        assert.strictEqual(getTextOutputValue(cell.outputs[2]).trim(), 'Text Value is Hello World');

        // This cannot be displayed by output widget, hence we need to handle this.
        assert.strictEqual(cell.outputs[3].items[0].mime, 'application/vnd.custom');
        assert.strictEqual(Buffer.from(cell.outputs[3].items[0].data).toString().trim(), 'Text Value is Hello World');

        // Wait for the second output to get updated.
        const outputUpdated = new Promise<boolean>((resolve) => {
            workspace.onDidChangeNotebookDocument(
                (e) => {
                    const currentCellChange = e.cellChanges.find((item) => item.cell === cell);
                    if (!currentCellChange || !currentCellChange.outputs || currentCellChange.outputs.length < 4) {
                        return;
                    }
                    const secondOutput = currentCellChange.outputs[1];
                    if (Buffer.from(secondOutput.items[0].data).toString() === 'Text Value is Bar') {
                        resolve(true);
                    }
                },
                undefined,
                disposables
            );
        });
        // Update the textbox and confirm the output is updated accordingly.
        await comms.setValue(cell, '.widget-text input', 'Bar');

        // Wait for the output to get updated.
        await waitForCondition(() => outputUpdated, 5_000, 'Second output not updated');

        // The first & second outputs should have been updated
        await assertOutputContainsHtml(cell, comms, ['Text Value is Bar']);
        assert.strictEqual(cell.outputs[1].items[0].mime, 'application/vnd.custom');
        assert.strictEqual(Buffer.from(cell.outputs[1].items[0].data).toString().trim(), 'Text Value is Bar');

        // The last two should not have changed.
        assert.strictEqual(getTextOutputValue(cell.outputs[2]).trim(), 'Text Value is Hello World');
        assert.strictEqual(cell.outputs[3].items[0].mime, 'application/vnd.custom');
        assert.strictEqual(Buffer.from(cell.outputs[3].items[0].data).toString().trim(), 'Text Value is Hello World');
    });
});
