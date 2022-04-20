// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import * as path from '../../../platform/vscode-path/path';
import * as sinon from 'sinon';
import { commands, NotebookCell, Uri } from 'vscode';
import { IVSCodeNotebook } from '../../../platform/common/application/types';
import { traceInfo } from '../../../platform/logging';
import { IDisposable } from '../../../platform/common/types';
import { IKernelProvider } from '../../../platform/../kernels/types';
import { captureScreenShot, IExtensionTestApi, waitForCondition } from '../../common.node';
import { closeActiveWindows, EXTENSION_ROOT_DIR_FOR_TESTS, initialize } from '../../initialize.node';
import { openNotebook } from '../helpers.node';
import {
    closeNotebooks,
    closeNotebooksAndCleanUpAfterTests,
    createTemporaryNotebookFromFile,
    defaultNotebookTestTimeout,
    prewarmNotebooks,
    runCell,
    startJupyterServer,
    waitForExecutionCompletedSuccessfully,
    waitForKernelToGetAutoSelected,
    workAroundVSCodeNotebookStartPages
} from '../notebook/helper.node';
import { initializeWidgetComms, Utils } from './commUtils';
import { WidgetRenderingTimeoutForTests } from './constants';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite.only('Standard IPyWidget (Execution) (slow) (WIDGET_TEST)', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
    let kernelProvider: IKernelProvider;
    const notebookPath = path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'test', 'datascience', 'widgets', 'notebooks');

    this.timeout(120_000);
    suiteSetup(async function () {
        traceInfo('Suite Setup VS Code Notebook - Execution');
        this.timeout(120_000);
        api = await initialize();
        await workAroundVSCodeNotebookStartPages();
        await startJupyterServer();
        await prewarmNotebooks();
        sinon.restore();
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        kernelProvider = api.serviceContainer.get<IKernelProvider>(IKernelProvider);
        traceInfo('Suite Setup (completed)');
        // eslint-disable-next-line local-rules/dont-use-process
        process.env.IS_WIDGET_TEST = 'true';
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
            await captureScreenShot(this.currentTest?.title);
        }
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => {
        // eslint-disable-next-line local-rules/dont-use-process
        delete process.env.IS_WIDGET_TEST;
        return closeNotebooksAndCleanUpAfterTests(disposables);
    });
    async function initializeNotebook(options: { templateFile: string } | { notebookFile: string }) {
        const nbUri =
            'templateFile' in options
                ? await createTemporaryNotebookFromFile(path.join(notebookPath, options.templateFile), disposables)
                : Uri.file(options.notebookFile);
        await openNotebook(nbUri);
        await waitForKernelToGetAutoSelected();
        await commands.executeCommand('workbench.action.closePanel');
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
        comms: Utils,
        cell: NotebookCell,
        htmlFragmentsToLookFor: string[],
        selector?: string
    ) {
        // Verify the widget is created & rendered.
        await waitForCondition(
            async () => {
                await comms.ready;
                const html = await comms.queryHtml(cell, selector);
                htmlFragmentsToLookFor.forEach((fragment) => assert.include(html, fragment));
                return true;
            },
            WidgetRenderingTimeoutForTests * 10,
            'Widget did not render'
        );
    }
    async function click(comms: Utils, cell: NotebookCell, selector: string) {
        await comms.click(cell, selector);
    }

    test('Slider Widget', async function () {
        const comms = await initializeNotebook({ templateFile: 'slider_widgets.ipynb' });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;
        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(comms, cell, ['6519'], '.widget-readout');
    });
    test('Textbox Widget', async () => {
        const comms = await initializeNotebook({ templateFile: 'standard_widgets.ipynb' });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(1)!;
        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(comms, cell, ['<input type="text', 'Enter your name:'], '.widget-text');
    });
    test('Linking Widgets slider to textbox widget', async function () {
        const comms = await initializeNotebook({ templateFile: 'slider_widgets.ipynb' });
        const [, cell1, cell2, cell3] = vscodeNotebook.activeNotebookEditor!.document.getCells()!;
        await executeCellAndDontWaitForOutput(cell1);
        await executeCellAndWaitForOutput(cell2, comms);
        await executeCellAndWaitForOutput(cell3, comms);
        await assertOutputContainsHtml(comms, cell2, ['0'], '.widget-readout');
        await assertOutputContainsHtml(comms, cell3, ['<input type="number']);

        // Update the textbox widget.
        await comms.setValue(cell3, '.widget-text input', '60');

        // Verify the slider has changed.
        await assertOutputContainsHtml(comms, cell2, ['60'], '.widget-readout');
    });
    test('Checkbox Widget', async () => {
        const comms = await initializeNotebook({ templateFile: 'standard_widgets.ipynb' });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(2)!;
        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(comms, cell, ['Check me', '<input type="checkbox'], '.widget-checkbox');
    });
    test('Button Widget (click button)', async () => {
        const comms = await initializeNotebook({ templateFile: 'button_widgets.ipynb' });
        const [cell0, cell1, cell2] = vscodeNotebook.activeNotebookEditor!.document.getCells();

        await executeCellAndWaitForOutput(cell0, comms);
        await executeCellAndWaitForOutput(cell1, comms);
        await executeCellAndWaitForOutput(cell2, comms);
        await assertOutputContainsHtml(comms, cell0, ['Click Me!', '<button']);
        await assertOutputContainsHtml(comms, cell1, ['Click Me!', '<button']);

        // Click the button and verify we have output in other cells
        await click(comms, cell0, 'button');
        await assertOutputContainsHtml(comms, cell0, ['Button clicked']);
        await assertOutputContainsHtml(comms, cell1, ['Button clicked']);
        await assertOutputContainsHtml(comms, cell2, ['Button clicked']);
    });
    test('Button Widget (click button in output of another cell)', async () => {
        const comms = await initializeNotebook({ templateFile: 'button_widgets.ipynb' });
        const [cell0, cell1, cell2] = vscodeNotebook.activeNotebookEditor!.document.getCells();

        await executeCellAndWaitForOutput(cell0, comms);
        await executeCellAndWaitForOutput(cell1, comms);
        await executeCellAndWaitForOutput(cell2, comms);
        await assertOutputContainsHtml(comms, cell0, ['Click Me!', '<button']);
        await assertOutputContainsHtml(comms, cell1, ['Click Me!', '<button']);

        // Click the button and verify we have output in other cells
        await click(comms, cell1, 'button');
        await assertOutputContainsHtml(comms, cell0, ['Button clicked']);
        await assertOutputContainsHtml(comms, cell1, ['Button clicked']);
        await assertOutputContainsHtml(comms, cell2, ['Button clicked']);
    });
    test('Render IPySheets', async () => {
        const comms = await initializeNotebook({ templateFile: 'ipySheet_widgets.ipynb' });
        const [, cell1, , cell3] = vscodeNotebook.activeNotebookEditor!.document.getCells();

        await executeCellAndDontWaitForOutput(cell1);
        await executeCellAndWaitForOutput(cell3, comms);
        await assertOutputContainsHtml(comms, cell3, ['Hello', 'World', '42.000']);
    });
    test('Render IPySheets & search', async () => {
        const comms = await initializeNotebook({ templateFile: 'ipySheet_widgets_search.ipynb' });
        const [, cell1, , cell3, cell4, cell5] = vscodeNotebook.activeNotebookEditor!.document.getCells();

        await executeCellAndDontWaitForOutput(cell1);
        await executeCellAndDontWaitForOutput(cell3);
        await executeCellAndWaitForOutput(cell4, comms);
        await executeCellAndWaitForOutput(cell5, comms);
        await assertOutputContainsHtml(comms, cell4, ['title="Search:"', '<input type="text']);
        await assertOutputContainsHtml(comms, cell5, ['>train<', '>foo<']);

        // Update the textbox widget.
        await comms.setValue(cell4, '.widget-text input', 'train');
        await assertOutputContainsHtml(comms, cell5, ['class="htSearchResult">train<']);
    });
    test('Render IPySheets & slider', async () => {
        const comms = await initializeNotebook({ templateFile: 'ipySheet_widgets_slider.ipynb' });
        const [, cell1, , cell3, cell4, , cell6, cell7] = vscodeNotebook.activeNotebookEditor!.document.getCells();

        await executeCellAndDontWaitForOutput(cell1);
        await executeCellAndDontWaitForOutput(cell3);
        await executeCellAndWaitForOutput(cell4, comms);
        await executeCellAndWaitForOutput(cell6, comms);
        await executeCellAndWaitForOutput(cell7, comms);
        await assertOutputContainsHtml(comms, cell4, ['Continuous Slider', '<input type="text']);
        await assertOutputContainsHtml(comms, cell6, ['Continuous Text', '<input type="number']);
        await assertOutputContainsHtml(comms, cell7, ['Continuous Slider', '>0<', '>123.00']);

        // Update the textbox widget (for slider).
        await comms.setValue(cell4, '.widget-text input', '5255');
        await assertOutputContainsHtml(comms, cell7, ['>5255<', '>5378.0']);
    });
    test('Render ipyvolume (slider, color picker, figure)', async function () {
        const comms = await initializeNotebook({ templateFile: 'ipyvolume_widgets.ipynb' });
        const cell = vscodeNotebook.activeNotebookEditor!.document.cellAt(1);

        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(comms, cell, ['<input type="color"', '>Slider1<', '>Slider2<', '<canvas']);
    });
    test('Render pythreejs', async function () {
        const comms = await initializeNotebook({ templateFile: 'pythreejs_widgets.ipynb' });
        const cell = vscodeNotebook.activeNotebookEditor!.document.cellAt(1);

        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(comms, cell, ['<canvas']);
    });
    test('Render pythreejs, 2', async function () {
        const comms = await initializeNotebook({ templateFile: 'pythreejs_widgets2.ipynb' });
        const cell = vscodeNotebook.activeNotebookEditor!.document.cellAt(1);

        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(comms, cell, ['<canvas']);
    });
    test('Render matplotlib, interactive inline', async function () {
        const comms = await initializeNotebook({ templateFile: 'matplotlib_widgets.ipynb' });
        const cell = vscodeNotebook.activeNotebookEditor!.document.cellAt(1);

        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(comms, cell, ['>m<', '>b<', '<img src="data:image/png;base64,']);
        await assertOutputContainsHtml(comms, cell, ['<img src="data:image/png;base64,'], '.jp-OutputArea-output');
    });
    test('Render matplotlib, non-interactive inline', async function () {
        const comms = await initializeNotebook({ templateFile: 'matplotlib_widgets.ipynb' });
        const cell = vscodeNotebook.activeNotebookEditor!.document.cellAt(2);

        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(comms, cell, ['<img src="blob:vscode']);
    });
    test('Render matplotlib, widget', async function () {
        const comms = await initializeNotebook({ templateFile: 'matplotlib_widgets.ipynb' });
        const cell = vscodeNotebook.activeNotebookEditor!.document.cellAt(3);

        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(comms, cell, ['>Figure 1<', '<canvas', 'Download plot']);
        await assertOutputContainsHtml(comms, cell, ['<canvas'], '.jupyter-matplotlib-canvas-div');
    });
    test('Render matplotlib, widget in multiple cells', async function () {
        const comms = await initializeNotebook({ templateFile: 'matplotlib_multiple_cells_widgets.ipynb' });
        const [, cell1, cell2, cell3, cell4] = vscodeNotebook.activeNotebookEditor!.document.getCells();

        await executeCellAndDontWaitForOutput(cell1);
        await executeCellAndDontWaitForOutput(cell2);
        await executeCellAndWaitForOutput(cell3, comms);
        await executeCellAndWaitForOutput(cell4, comms);
        await assertOutputContainsHtml(comms, cell3, ['>Figure 1<', '<canvas', 'Download plot']);
        await assertOutputContainsHtml(comms, cell3, ['<canvas'], '.jupyter-matplotlib-canvas-div');
        await assertOutputContainsHtml(comms, cell4, ['>Figure 2<', '<canvas', 'Download plot']);
        await assertOutputContainsHtml(comms, cell4, ['<canvas'], '.jupyter-matplotlib-canvas-div');
    });
    test.skip('Widget renders after executing a notebook which was saved after previous execution', async () => {
        // https://github.com/microsoft/vscode-jupyter/issues/8748
        let comms = await initializeNotebook({ templateFile: 'standard_widgets.ipynb' });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;
        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(comms, cell, ['66'], '.widget-readout');

        // Restart the kernel.
        const uri = vscodeNotebook.activeNotebookEditor!.document.uri;
        await commands.executeCommand('workbench.action.files.save');
        await closeActiveWindows();

        // Open this notebook again.
        comms = await initializeNotebook({ notebookFile: uri.fsPath });

        // Verify we have output in the first cell.
        assert.isOk(cell.outputs.length, 'No outputs in the cell after saving nb');

        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(comms, cell, ['66'], '.widget-readout');
    });
    test.skip('Widget renders after restarting kernel', async () => {
        const comms = await initializeNotebook({ templateFile: 'standard_widgets.ipynb' });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;
        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(comms, cell, ['66'], '.widget-readout');

        // Restart the kernel.
        const kernel = kernelProvider.get(vscodeNotebook.activeNotebookEditor!.document.uri)!;
        await kernel.restart();
        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(comms, cell, ['66'], '.widget-readout');

        // Clear all cells and restart and test again.
        await kernel.restart();
        await commands.executeCommand('notebook.clearAllCellsOutputs');
        await waitForCondition(async () => cell.outputs.length === 0, 5_000, 'Cell did not get cleared');

        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(comms, cell, ['66'], '.widget-readout');
    });
    test.skip('Widget renders after interrupting kernel', async () => {
        // https://github.com/microsoft/vscode-jupyter/issues/8749
        const comms = await initializeNotebook({ templateFile: 'standard_widgets.ipynb' });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;
        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(comms, cell, ['66'], '.widget-readout');

        // Restart the kernel.
        const kernel = kernelProvider.get(vscodeNotebook.activeNotebookEditor!.document.uri)!;
        await kernel.interrupt();
        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(comms, cell, ['66'], '.widget-readout');

        // Clear all cells and restart and test again.
        await kernel.interrupt();
        await commands.executeCommand('notebook.clearAllCellsOutputs');
        await waitForCondition(async () => cell.outputs.length === 0, 5_000, 'Cell did not get cleared');

        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(comms, cell, ['66'], '.widget-readout');
    });
});
