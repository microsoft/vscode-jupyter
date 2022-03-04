// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import * as path from 'path';
import * as sinon from 'sinon';
import { commands, NotebookCell, Uri } from 'vscode';
import { IVSCodeNotebook } from '../../../client/common/application/types';
import { traceInfo } from '../../../client/common/logger';
import { IDisposable } from '../../../client/common/types';
import { IKernelProvider } from '../../../client/datascience/jupyter/kernels/types';
import { captureScreenShot, IExtensionTestApi, waitForCondition } from '../../common';
import { closeActiveWindows, EXTENSION_ROOT_DIR_FOR_TESTS, initialize } from '../../initialize';
import { openNotebook } from '../helpers';
import {
    closeNotebooks,
    closeNotebooksAndCleanUpAfterTests,
    createTemporaryNotebook,
    defaultNotebookTestTimeout,
    prewarmNotebooks,
    runCell,
    startJupyterServer,
    waitForExecutionCompletedSuccessfully,
    waitForKernelToGetAutoSelected,
    workAroundVSCodeNotebookStartPages
} from '../notebook/helper';
import { initializeWidgetComms, Utils } from './commUtils';
import { WidgetRenderingTimeoutForTests } from './constants';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite.only('Standard IPyWidget (Execution) (slow) (WIDGET_TEST)', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
    let kernelProvider: IKernelProvider;
    const templateNbPath = path.join(
        EXTENSION_ROOT_DIR_FOR_TESTS,
        'src',
        'test',
        'datascience',
        'widgets',
        'notebooks',
        'standard_widgets.ipynb'
    );

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
    });
    // Use same notebook without starting kernel in every single test (use one for whole suite).
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        sinon.restore();
        await startJupyterServer();
        await closeNotebooks();
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this.currentTest?.title);
        }
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));
    async function initializeNotebook(options: { templateFile: string } | { notebookFile: string }) {
        const nbUri =
            'templateFile' in options
                ? Uri.file(await createTemporaryNotebook(options.templateFile, disposables))
                : Uri.file(options.notebookFile);
        await openNotebook(nbUri.fsPath);
        await waitForKernelToGetAutoSelected();
        return initializeWidgetComms(api.serviceContainer);
    }
    async function executionCell(cell: NotebookCell, comms: Utils) {
        await Promise.all([
            runCell(cell),
            waitForExecutionCompletedSuccessfully(cell),
            waitForCondition(async () => cell.outputs.length > 0, defaultNotebookTestTimeout, 'Cell output is empty'),
            comms.ready
        ]);
    }
    async function assertOutputContainsHtml(
        comms: Utils,
        cellIndex: number,
        htmlFragmentsToLookFor: string[],
        selector?: string
    ) {
        // Confirm we have execution order and output.
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(cellIndex)!;

        // Verify the widget is created & rendered.
        await waitForCondition(
            async () => {
                const outputs = await Promise.all(cell.outputs.map((output) => comms.queryHtml(output.id, selector)));
                const html = outputs.join('');
                htmlFragmentsToLookFor.forEach((fragment) => assert.include(html, fragment));
                return true;
            },
            WidgetRenderingTimeoutForTests,
            { rethrowLastFailure: true }
        );
    }
    async function click(comms: Utils, cellIndex: number, selector: string) {
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(cellIndex)!;
        await comms.click(selector, cell.outputs[0].id);
    }

    test('Slider Widget', async function () {
        const comms = await initializeNotebook({ templateFile: templateNbPath });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;
        await executionCell(cell, comms);
        await assertOutputContainsHtml(comms, 0, ['66'], '.widget-readout');
    });
    test('Textbox Widget', async () => {
        const comms = await initializeNotebook({ templateFile: templateNbPath });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(1)!;
        await executionCell(cell, comms);
        await assertOutputContainsHtml(comms, 1, ['<input type="text'], '.widget-text');
    });
    test('Checkbox Widget', async () => {
        const comms = await initializeNotebook({ templateFile: templateNbPath });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(2)!;
        await executionCell(cell, comms);
        await assertOutputContainsHtml(comms, 2, ['Check me', '<input type="checkbox'], '.widget-checkbox');
    });
    test('Button Widget (click button)', async () => {
        const comms = await initializeNotebook({ templateFile: templateNbPath });
        const [, , , cell3, cell4, cell5] = vscodeNotebook.activeNotebookEditor!.document.getCells();

        await executionCell(cell3, comms);
        await executionCell(cell4, comms);
        await executionCell(cell5, comms);
        await assertOutputContainsHtml(comms, 3, ['Click Me!', '<button']);
        await assertOutputContainsHtml(comms, 4, ['Click Me!', '<button']);

        // Click the button and verify we have output in other cells
        await click(comms, 3, 'button');
        await assertOutputContainsHtml(comms, 3, ['Button clicked']);
        await assertOutputContainsHtml(comms, 4, ['Button clicked']);
        await assertOutputContainsHtml(comms, 5, ['Button clicked']);
    });
    test('Button Widget (click button in output of another cell)', async () => {
        const comms = await initializeNotebook({ templateFile: templateNbPath });
        const [, , , cell3, cell4, cell5] = vscodeNotebook.activeNotebookEditor!.document.getCells();

        await executionCell(cell3, comms);
        await executionCell(cell4, comms);
        await executionCell(cell5, comms);
        await assertOutputContainsHtml(comms, 3, ['Click Me!', '<button']);
        await assertOutputContainsHtml(comms, 4, ['Click Me!', '<button']);

        // Click the button and verify we have output in other cells
        await click(comms, 4, 'button');
        await assertOutputContainsHtml(comms, 3, ['Button clicked']);
        await assertOutputContainsHtml(comms, 4, ['Button clicked']);
        await assertOutputContainsHtml(comms, 5, ['Button clicked']);
    });
    test.skip('Widget renders after executing a notebook which was saved after previous execution', async () => {
        // https://github.com/microsoft/vscode-jupyter/issues/8748
        let comms = await initializeNotebook({ templateFile: templateNbPath });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;
        await executionCell(cell, comms);
        await assertOutputContainsHtml(comms, 0, ['66'], '.widget-readout');

        // Restart the kernel.
        const uri = vscodeNotebook.activeNotebookEditor!.document.uri;
        await commands.executeCommand('workbench.action.files.save');
        await closeActiveWindows();

        // Open this notebook again.
        comms = await initializeNotebook({ notebookFile: uri.fsPath });

        // Verify we have output in the first cell.
        assert.isOk(cell.outputs.length, 'No outputs in the cell after saving nb');

        await executionCell(cell, comms);
        await assertOutputContainsHtml(comms, 0, ['66'], '.widget-readout');
    });
    test.skip('Widget renders after restarting kernel', async () => {
        const comms = await initializeNotebook({ templateFile: templateNbPath });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;
        await executionCell(cell, comms);
        await assertOutputContainsHtml(comms, 0, ['66'], '.widget-readout');

        // Restart the kernel.
        const kernel = kernelProvider.get(vscodeNotebook.activeNotebookEditor!.document)!;
        await kernel.restart();
        await executionCell(cell, comms);
        await assertOutputContainsHtml(comms, 0, ['66'], '.widget-readout');

        // Clear all cells and restart and test again.
        await kernel.restart();
        await commands.executeCommand('notebook.clearAllCellsOutputs');
        await waitForCondition(async () => cell.outputs.length === 0, 5_000, 'Cell did not get cleared');

        await executionCell(cell, comms);
        await assertOutputContainsHtml(comms, 0, ['66'], '.widget-readout');
    });
    test.skip('Widget renders after interrupting kernel', async () => {
        // https://github.com/microsoft/vscode-jupyter/issues/8749
        const comms = await initializeNotebook({ templateFile: templateNbPath });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;
        await executionCell(cell, comms);
        await assertOutputContainsHtml(comms, 0, ['66'], '.widget-readout');

        // Restart the kernel.
        const kernel = kernelProvider.get(vscodeNotebook.activeNotebookEditor!.document)!;
        await kernel.interrupt();
        await executionCell(cell, comms);
        await assertOutputContainsHtml(comms, 0, ['66'], '.widget-readout');

        // Clear all cells and restart and test again.
        await kernel.interrupt();
        await commands.executeCommand('notebook.clearAllCellsOutputs');
        await waitForCondition(async () => cell.outputs.length === 0, 5_000, 'Cell did not get cleared');

        await executionCell(cell, comms);
        await assertOutputContainsHtml(comms, 0, ['66'], '.widget-readout');
    });
});
