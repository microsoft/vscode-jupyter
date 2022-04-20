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
    const templateNbPath = path.join(notebookPath, 'standard_widgets.ipynb');
    const templateButtonNbPath = path.join(notebookPath, 'button_widgets.ipynb');
    const templateSliderNbPath = path.join(notebookPath, 'slider_widgets.ipynb');
    const templateIPySheetNbPath = path.join(notebookPath, 'ipySheet_widgets.ipynb');
    const templateIPySheetSearchNbPath = path.join(notebookPath, 'ipySheet_widgets_search.ipynb');
    // const templateIPySheetSliderNbPath = path.join(notebookPath, 'ipySheet_widgets_slider.ipynb');

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
                ? await createTemporaryNotebookFromFile(options.templateFile, disposables)
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
        const comms = await initializeNotebook({ templateFile: templateSliderNbPath });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;
        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(comms, cell, ['6519'], '.widget-readout');
    });
    test('Textbox Widget', async () => {
        const comms = await initializeNotebook({ templateFile: templateNbPath });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(1)!;
        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(comms, cell, ['<input type="text', 'Enter your name:'], '.widget-text');
    });
    test('Linking Widgets slider to textbox widget', async function () {
        const comms = await initializeNotebook({ templateFile: templateSliderNbPath });
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
        const comms = await initializeNotebook({ templateFile: templateNbPath });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(2)!;
        await executeCellAndWaitForOutput(cell, comms);
        await assertOutputContainsHtml(comms, cell, ['Check me', '<input type="checkbox'], '.widget-checkbox');
    });
    test('Button Widget (click button)', async () => {
        const comms = await initializeNotebook({ templateFile: templateButtonNbPath });
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
        const comms = await initializeNotebook({ templateFile: templateButtonNbPath });
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
        const comms = await initializeNotebook({ templateFile: templateIPySheetNbPath });
        const [, cell1, , cell3] = vscodeNotebook.activeNotebookEditor!.document.getCells();

        await executeCellAndDontWaitForOutput(cell1);
        await executeCellAndWaitForOutput(cell3, comms);
        await assertOutputContainsHtml(comms, cell3, ['Hello', 'World', '42.000']);
    });
    test('Render IPySheets & search', async () => {
        const comms = await initializeNotebook({ templateFile: templateIPySheetSearchNbPath });
        // const [, cell1, , cell3, , cell5, cell6, cell7, , cell9, cell10, , cell12, cell13] =
        const [, cell1, , cell3, , cell5, cell6, cell7, , cell9, cell10, , cell12, cell13] =
            vscodeNotebook.activeNotebookEditor!.document.getCells();

        await executeCellAndDontWaitForOutput(cell1);
        await executeCellAndWaitForOutput(cell3, comms);
        await executeCellAndDontWaitForOutput(cell5);
        await executeCellAndWaitForOutput(cell6, comms);
        await executeCellAndWaitForOutput(cell7, comms);
        await executeCellAndDontWaitForOutput(cell9);
        await executeCellAndWaitForOutput(cell10, comms);
        await executeCellAndWaitForOutput(cell12, comms);
        await executeCellAndWaitForOutput(cell13, comms);
        await assertOutputContainsHtml(comms, cell3, ['Hello', 'World', '42.000']);
        await assertOutputContainsHtml(comms, cell6, ['Search:', '<input type="text']);
        await assertOutputContainsHtml(comms, cell7, ['test:', 'train', 'foo']);
        await assertOutputContainsHtml(comms, cell10, ['Continuous Slider']);
        await assertOutputContainsHtml(comms, cell12, ['Continuous Text']);

        // Update the textbox widget.
        await comms.setValue(cell12, '.widget-text input', '60');
        await assertOutputContainsHtml(comms, cell12, ['765']);
        await assertOutputContainsHtml(comms, cell10, ['765']);

        await assertOutputContainsHtml(comms, cell13, ['50.0', '815.0']);
    });
    // test('IPySheet Widget', async () => {
    //     const comms = await initializeNotebook({ templateFile: templateIPySheetNbPath });
    //     // Confirm we have execution order and output.
    //     const [, cell1, , cell3, , cell5, cell6, cell7, cell9, cell10, , cell12, cell13] =
    //         vscodeNotebook.activeNotebookEditor!.document.getCells();
    //     await Promise.all([
    //         executeCellAndDontWaitForOutput(cell1, comms),
    //         executeCellAndWaitForOutput(cell3, comms),
    //         executeCellAndWaitForOutput(cell5, comms),
    //         executeCellAndWaitForOutput(cell6, comms),
    //         executeCellAndWaitForOutput(cell7, comms),
    //         executeCellAndWaitForOutput(cell9, comms),
    //         executeCellAndWaitForOutput(cell10, comms),
    //         executeCellAndWaitForOutput(cell12, comms),
    //         executeCellAndWaitForOutput(cell13, comms)
    //     ]);

    //     await waitForCondition(
    //         async () => {
    //             const innerHTML = await comms.queryHtml(cell1, '.widget-text');
    //             assert.include(innerHTML, 'Enter your name:');
    //             assert.include(innerHTML, '<input type="text');
    //             return true;
    //         },
    //         WidgetRenderingTimeoutForTests,
    //         'Textbox not rendered'
    //     );
    // });
    test.skip('Widget renders after executing a notebook which was saved after previous execution', async () => {
        // https://github.com/microsoft/vscode-jupyter/issues/8748
        let comms = await initializeNotebook({ templateFile: templateNbPath });
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
        const comms = await initializeNotebook({ templateFile: templateNbPath });
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
        const comms = await initializeNotebook({ templateFile: templateNbPath });
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
