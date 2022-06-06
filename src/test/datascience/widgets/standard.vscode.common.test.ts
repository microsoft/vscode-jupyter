// Copyright (c) Microsoft Corporation. All rights reserved.
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
    waitForTextOutput,
    workAroundVSCodeNotebookStartPages
} from '../notebook/helper';
import { initializeWidgetComms, Utils } from './commUtils';
import { WidgetRenderingTimeoutForTests } from './constants';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('IPyWisdget Tests', function () {
    const templateRootPath: Uri =
        workspace.workspaceFolders && workspace.workspaceFolders.length > 0
            ? urlPath.joinPath(workspace.workspaceFolders[0].uri, 'widgets', 'notebooks')
            : Uri.file('');
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
    let kernelProvider: IKernelProvider;

    this.timeout(120_000);
    let previousWidgetScriptSourcesSettingValue: string[] | undefined = undefined;
    const widgetScriptSourcesValue = ['jsdelivr.com', 'unpkg.com'];
    // Retry at least once, because ipywidgets can be flaky (network, comms, etc).
    this.retries(1);
    suiteSetup(async function () {
        traceInfo('Suite Setup VS Code Notebook - Execution');
        this.timeout(120_000);
        api = await initialize();
        const config = workspace.getConfiguration('jupyter', undefined);
        previousWidgetScriptSourcesSettingValue = config.get('widgetScriptSources') as string[];
        if (
            !Array.isArray(previousWidgetScriptSourcesSettingValue) ||
            previousWidgetScriptSourcesSettingValue.join('') !== widgetScriptSourcesValue.join('')
        ) {
            await config.update('widgetScriptSources', widgetScriptSourcesValue, ConfigurationTarget.Global);
        }
        await workAroundVSCodeNotebookStartPages();
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
        await commands.executeCommand('workbench.action.closePanel');
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this.currentTest.title);
        }
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(async () => {
        const config = workspace.getConfiguration('jupyter', undefined);
        if (
            !Array.isArray(previousWidgetScriptSourcesSettingValue) ||
            previousWidgetScriptSourcesSettingValue.join('') !== widgetScriptSourcesValue.join('')
        ) {
            await config.update(
                'widgetScriptSources',
                previousWidgetScriptSourcesSettingValue,
                ConfigurationTarget.Global
            );
        }
        await closeNotebooksAndCleanUpAfterTests(disposables);
    });
    async function initializeNotebook(options: { templateFile: string } | { notebookFile: Uri }) {
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
        return initializeWidgetComms(api.serviceContainer);
    }
    async function executeCellAndWaitForOutput(cell: NotebookCell, comms: Utils) {
        await Promise.all([
            runCell(cell),
            waitForExecutionCompletedSuccessfully(cell),
            waitForCondition(async () => cell.outputs.length > 0, defaultNotebookTestTimeout, 'Cell output is empty'),
            comms.ready
        ]);
    }
    async function executeCellAndDontWaitForOutput(cell: NotebookCell) {
        await Promise.all([runCell(cell), waitForExecutionCompletedSuccessfully(cell)]);
    }
    async function assertOutputContainsHtml(
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
            () => `Widget did not render or ${htmlFragmentsToLookFor.join(', ')} not in html = ${html}`
        );
    }
    async function click(comms: Utils, cell: NotebookCell, selector: string) {
        await comms.click(cell, selector);
    }

    test('Slider Widget', async function () {
        const comms = await initializeNotebook({ templateFile: 'slider_widgets.ipynb' });
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;
        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(cell, comms, ['6519'], '.widget-readout');
    });
    test('Textbox Widget', async () => {
        const comms = await initializeNotebook({ templateFile: 'standard_widgets.ipynb' });
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(1)!;
        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(cell, comms, ['<input type="text', 'Enter your name:'], '.widget-text');
    });
    test('Linking Widgets slider to textbox widget', async function () {
        const comms = await initializeNotebook({ templateFile: 'slider_widgets.ipynb' });
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
        const comms = await initializeNotebook({ templateFile: 'standard_widgets.ipynb' });
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(2)!;
        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(cell, comms, ['Check me', '<input type="checkbox'], '.widget-checkbox');
    });
    test('Button Widget (click button)', async () => {
        const comms = await initializeNotebook({ templateFile: 'button_widgets.ipynb' });
        const [cell0, cell1, cell2] = vscodeNotebook.activeNotebookEditor!.notebook.getCells();

        await executeCellAndWaitForOutput(cell0, comms);
        await executeCellAndWaitForOutput(cell1, comms);
        await executeCellAndWaitForOutput(cell2, comms);
        await assertOutputContainsHtml(cell0, comms, ['Click Me!', '<button']);
        await assertOutputContainsHtml(cell1, comms, ['Click Me!', '<button']);

        // Click the button and verify we have output in other cells
        await click(comms, cell0, 'button');
        await assertOutputContainsHtml(cell0, comms, ['Button clicked']);
        await assertOutputContainsHtml(cell1, comms, ['Button clicked']);
        await assertOutputContainsHtml(cell2, comms, ['Button clicked']);
    });
    test('Button Widget (click button in output of another cell)', async () => {
        const comms = await initializeNotebook({ templateFile: 'button_widgets.ipynb' });
        const [cell0, cell1, cell2] = vscodeNotebook.activeNotebookEditor!.notebook.getCells();

        await executeCellAndWaitForOutput(cell0, comms);
        await executeCellAndWaitForOutput(cell1, comms);
        await executeCellAndWaitForOutput(cell2, comms);
        await assertOutputContainsHtml(cell0, comms, ['Click Me!', '<button']);
        await assertOutputContainsHtml(cell1, comms, ['Click Me!', '<button']);

        // Click the button and verify we have output in other cells
        await click(comms, cell1, 'button');
        await assertOutputContainsHtml(cell0, comms, ['Button clicked']);
        await assertOutputContainsHtml(cell1, comms, ['Button clicked']);
        await assertOutputContainsHtml(cell2, comms, ['Button clicked']);
    });
    test.skip('Button Widget with custom comm message', async () => {
        const comms = await initializeNotebook({ templateFile: 'button_widget_comm_msg.ipynb' });
        const [cell0, cell1] = vscodeNotebook.activeNotebookEditor!.notebook.getCells();

        await executeCellAndWaitForOutput(cell0, comms);
        await executeCellAndWaitForOutput(cell1, comms);
        await assertOutputContainsHtml(cell0, comms, ['Click Me!', '<button']);

        // Click the button and verify we have output in the same cell.
        await click(comms, cell0, 'button');
        await waitForTextOutput(cell0, 'Button clicked.', 1, false);
    });
    test.skip('Button Widget with custom comm message rendering a matplotlib widget', async () => {
        const comms = await initializeNotebook({ templateFile: 'button_widget_comm_msg_matplotlib.ipynb' });
        const [cell0, cell1] = vscodeNotebook.activeNotebookEditor!.notebook.getCells();

        await executeCellAndWaitForOutput(cell0, comms);
        await executeCellAndWaitForOutput(cell1, comms);
        await assertOutputContainsHtml(cell0, comms, ['Click Me!', '<button']);

        // Click the button and verify we have output in the same cell.
        await click(comms, cell0, 'button');
        await assertOutputContainsHtml(cell0, comms, ['>Figure 1<', '<canvas', 'Download plot']);
    });
    test('Render IPySheets', async () => {
        const comms = await initializeNotebook({ templateFile: 'ipySheet_widgets.ipynb' });
        const [, cell1] = vscodeNotebook.activeNotebookEditor!.notebook.getCells();

        await executeCellAndWaitForOutput(cell1, comms);
        await assertOutputContainsHtml(cell1, comms, ['Hello', 'World', '42.000']);
    });
    test('Render IPySheets & search', async () => {
        const comms = await initializeNotebook({ templateFile: 'ipySheet_widgets_search.ipynb' });
        const [, cell1, cell2] = vscodeNotebook.activeNotebookEditor!.notebook.getCells();

        await executeCellAndWaitForOutput(cell1, comms);
        await executeCellAndWaitForOutput(cell2, comms);
        await assertOutputContainsHtml(cell1, comms, ['title="Search:"', '<input type="text']);
        await assertOutputContainsHtml(cell2, comms, ['>train<', '>foo<']);

        // Update the textbox widget.
        await comms.setValue(cell1, '.widget-text input', 'train');
        await assertOutputContainsHtml(cell2, comms, ['class="htSearchResult">train<']);
    });
    test('Render IPySheets & slider', async () => {
        const comms = await initializeNotebook({ templateFile: 'ipySheet_widgets_slider.ipynb' });
        const [, cell1, cell2, cell3] = vscodeNotebook.activeNotebookEditor!.notebook.getCells();

        await executeCellAndWaitForOutput(cell1, comms);
        await executeCellAndWaitForOutput(cell2, comms);
        await executeCellAndWaitForOutput(cell3, comms);
        await assertOutputContainsHtml(cell1, comms, ['Continuous Slider']);
        await assertOutputContainsHtml(cell2, comms, ['Continuous Text', '<input type="number']);
        await assertOutputContainsHtml(cell3, comms, ['Continuous Slider', '>0<', '>123.00']);

        // Update the textbox widget (for slider).
        await comms.setValue(cell2, '.widget-text input', '5255');
        await assertOutputContainsHtml(cell3, comms, ['>5255<', '>5378.0']);
    });
    test.skip('Render ipyvolume (slider, color picker, figure)', async function () {
        const comms = await initializeNotebook({ templateFile: 'ipyvolume_widgets.ipynb' });
        const cell = vscodeNotebook.activeNotebookEditor!.notebook.cellAt(1);

        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(cell, comms, ['<input type="color"', '>Slider1<', '>Slider2<', '<canvas']);
    });
    test.skip('Render pythreejs', async function () {
        const comms = await initializeNotebook({ templateFile: 'pythreejs_widgets.ipynb' });
        const cell = vscodeNotebook.activeNotebookEditor!.notebook.cellAt(1);

        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(cell, comms, ['<canvas']);
    });
    test.skip('Render pythreejs, 2', async function () {
        const comms = await initializeNotebook({ templateFile: 'pythreejs_widgets2.ipynb' });
        const cell = vscodeNotebook.activeNotebookEditor!.notebook.cellAt(1);

        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(cell, comms, ['<canvas']);
    });
    test.skip('Render matplotlib, interactive inline', async function () {
        const comms = await initializeNotebook({ templateFile: 'matplotlib_widgets_interactive.ipynb' });
        const cell = vscodeNotebook.activeNotebookEditor!.notebook.cellAt(1);

        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(cell, comms, ['>m<', '>b<', '<img src="data:image']);
    });
    test('Render matplotlib, non-interactive inline', async function () {
        // Skipping this test as the renderer is not a widget renderer, its an html renderer.
        // Need to modify that code too to add the classes so we can query the html rendered.
        await initializeNotebook({ templateFile: 'matplotlib_widgets_inline.ipynb' });
        const cell = vscodeNotebook.activeNotebookEditor!.notebook.cellAt(2);

        const mimTypes = () => cell.outputs.map((output) => output.items.map((item) => item.mime).join(',')).join(',');
        await executeCellAndDontWaitForOutput(cell);
        await waitForCondition(
            () => mimTypes().toLowerCase().includes('image/'),
            defaultNotebookTestTimeout,
            () => `Timeout waiting for matplotlib inline image, got ${mimTypes()}`
        );
    });
    test.skip('Render matplotlib, widget', async function () {
        const comms = await initializeNotebook({ templateFile: 'matplotlib_widgets_widget.ipynb' });
        const cell = vscodeNotebook.activeNotebookEditor!.notebook.cellAt(3);

        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(cell, comms, ['>Figure 1<', '<canvas', 'Download plot']);
    });
    test.skip('Render matplotlib, widget in multiple cells', async function () {
        const comms = await initializeNotebook({ templateFile: 'matplotlib_multiple_cells_widgets.ipynb' });
        const [, cell1, cell2, cell3, cell4] = vscodeNotebook.activeNotebookEditor!.notebook.getCells();

        await executeCellAndDontWaitForOutput(cell1);
        await executeCellAndDontWaitForOutput(cell2);
        await executeCellAndWaitForOutput(cell3, comms);
        await executeCellAndWaitForOutput(cell4, comms);
        await assertOutputContainsHtml(cell3, comms, ['>Figure 1<', '<canvas', 'Download plot']);
        await assertOutputContainsHtml(cell4, comms, ['>Figure 2<', '<canvas', 'Download plot']);
    });
    test.skip('Widget renders after executing a notebook which was saved after previous execution', async () => {
        // https://github.com/microsoft/vscode-jupyter/issues/8748
        let comms = await initializeNotebook({ templateFile: 'standard_widgets.ipynb' });
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;
        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(cell, comms, ['66'], '.widget-readout');

        // Restart the kernel.
        const uri = vscodeNotebook.activeNotebookEditor!.notebook.uri;
        await commands.executeCommand('workbench.action.files.save');
        await closeActiveWindows();

        // Open this notebook again.
        comms = await initializeNotebook({ notebookFile: uri });

        // Verify we have output in the first cell.
        assert.isOk(cell.outputs.length, 'No outputs in the cell after saving nb');

        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(cell, comms, ['66'], '.widget-readout');
    });
    test.skip('Widget renders after restarting kernel', async () => {
        const comms = await initializeNotebook({ templateFile: 'standard_widgets.ipynb' });
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;
        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(cell, comms, ['66'], '.widget-readout');

        // Restart the kernel.
        const kernel = kernelProvider.get(vscodeNotebook.activeNotebookEditor!.notebook.uri)!;
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
        const comms = await initializeNotebook({ templateFile: 'standard_widgets.ipynb' });
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;
        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(cell, comms, ['66'], '.widget-readout');

        // Restart the kernel.
        const kernel = kernelProvider.get(vscodeNotebook.activeNotebookEditor!.notebook.uri)!;
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
        const comms = await initializeNotebook({ templateFile: 'nested_output_widget.ipynb' });
        const [cell1, cell2, cell3, cell4] = vscodeNotebook.activeNotebookEditor!.notebook.getCells();
        await executeCellAndWaitForOutput(cell1, comms);

        // Run the second cell & verify we have output in the first cell.
        await Promise.all([runCell(cell2), waitForCellExecutionToComplete(cell1)]);
        await assertOutputContainsHtml(cell2, comms, ['First output widget'], '.widget-output');

        // Run the 3rd cell to add a nested output.
        // Also display the same nested output and the widget in the 3rd cell.
        await Promise.all([runCell(cell3), waitForCellExecutionToComplete(cell3)]);
        await assertOutputContainsHtml(cell1, comms, ['<input type="text', 'Label Widget'], '.widget-output');
        await assertOutputContainsHtml(cell3, comms, ['<input type="text', 'Label Widget'], '.widget-output');

        // Run the 4th cell & verify we have output in the first nested output & second output.
        await Promise.all([runCell(cell4), waitForCellExecutionToComplete(cell2)]);
        await assertOutputContainsHtml(cell1, comms, ['First output widget', 'Second output widget'], '.widget-output');
        await assertOutputContainsHtml(cell3, comms, ['Second output widget'], '.widget-output');

        // Verify both textbox widgets are linked.
        // I.e. updating one textbox will result in the other getting updated with the same value.
        await comms.setValue(cell1, '.widget-text input', 'Widgets are linked an get updated');
        await assertOutputContainsHtml(cell1, comms, ['>Widgets are linked an get updated<'], '.widget-output');
        await assertOutputContainsHtml(cell3, comms, ['>Widgets are linked an get updated<'], '.widget-output');
    });
    test('Interactive Button', async () => {
        const comms = await initializeNotebook({ templateFile: 'interactive_button.ipynb' });
        const cell = vscodeNotebook.activeNotebookEditor!.notebook.cellAt(0);

        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(cell, comms, ['Click Me!', '<button']);

        // Click the button and verify we have output in other cells
        await click(comms, cell, 'button');
        await assertOutputContainsHtml(cell, comms, ['Button clicked']);
    });
    test('Interactive Function', async () => {
        const comms = await initializeNotebook({ templateFile: 'interactive_function.ipynb' });
        const cell = vscodeNotebook.activeNotebookEditor!.notebook.cellAt(0);

        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(
            cell,
            comms,
            ['<input type="text', ">Executing do_something with ''<", ">''<"],
            '.widget-output'
        );

        // Update the textbox and confirm the output is updated accordingly.
        await comms.setValue(cell, '.widget-text input', 'Updated First Time');
        await assertOutputContainsHtml(
            cell,
            comms,
            [">Executing do_something with 'Updated First Time'<", ">'Updated First Time'<"],
            '.widget-output'
        );

        // Update the textbox again and confirm the output is updated accordingly (should replace previous output).
        await comms.setValue(cell, '.widget-text input', 'Updated Second Time');
        await assertOutputContainsHtml(
            cell,
            comms,
            [">Executing do_something with 'Updated Second Time'<", ">'Updated Second Time'<"],
            '.widget-output'
        );
    });
});
