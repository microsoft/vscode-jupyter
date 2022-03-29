// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import * as path from 'path';
import * as sinon from 'sinon';
import { commands, NotebookCell, Uri } from 'vscode';
import { IVSCodeNotebook } from '../../../platform/common/application/types';
import { traceInfo } from '../../../platform/common/logger';
import { IDisposable } from '../../../platform/common/types';
import { IKernelProvider } from '../../../platform/../kernels/types';
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
suite('Standard IPyWidget (Execution) (slow) (WIDGET_TEST)', function () {
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
    async function testSliderWidget(comms: Utils) {
        // Confirm we have execution order and output.
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;
        await executionCell(cell, comms);

        // Verify the slider widget is created.
        await waitForCondition(
            async () => {
                const innerHTML = await comms.queryHtml('.widget-readout', cell.outputs[0].id);
                assert.strictEqual(innerHTML, '666', 'Slider not renderer with the right value.');
                return true;
            },
            WidgetRenderingTimeoutForTests,
            'Slider not rendered'
        );
    }

    test('Slider Widget', async function () {
        const comms = await initializeNotebook({ templateFile: templateNbPath });
        await testSliderWidget(comms);
    });
    test('Checkbox Widget', async () => {
        const comms = await initializeNotebook({ templateFile: templateNbPath });
        // Confirm we have execution order and output.
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(2)!;
        await executionCell(cell, comms);

        await waitForCondition(
            async () => {
                const innerHTML = await comms.queryHtml('.widget-checkbox', cell.outputs[0].id);
                assert.include(innerHTML, 'Check me');
                assert.include(innerHTML, '<input type="checkbox');
                return true;
            },
            WidgetRenderingTimeoutForTests,
            'Checkbox not rendered'
        );
    });
    test.skip('Widget renders after executing a notebook which was saved after previous execution', async () => {
        // https://github.com/microsoft/vscode-jupyter/issues/8748
        let comms = await initializeNotebook({ templateFile: templateNbPath });
        await testSliderWidget(comms);

        // Restart the kernel.
        const uri = vscodeNotebook.activeNotebookEditor!.document.uri;
        await commands.executeCommand('workbench.action.files.save');
        await closeActiveWindows();

        // Open this notebook again.
        comms = await initializeNotebook({ notebookFile: uri.fsPath });

        // Verify we have output in the first cell.
        const cell = vscodeNotebook.activeNotebookEditor!.document.cellAt(0)!;
        assert.isOk(cell.outputs.length, 'No outputs in the cell after saving nb');

        await testSliderWidget(comms);
    });
    test.skip('Widget renders after restarting kernel', async () => {
        const comms = await initializeNotebook({ templateFile: templateNbPath });
        await testSliderWidget(comms);

        // Restart the kernel.
        const kernel = kernelProvider.get(vscodeNotebook.activeNotebookEditor!.document.uri)!;
        await kernel.restart();
        await testSliderWidget(comms);

        // Clear all cells and restart and test again.
        await kernel.restart();
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;
        await commands.executeCommand('notebook.clearAllCellsOutputs');
        await waitForCondition(async () => cell.outputs.length === 0, 5_000, 'Cell did not get cleared');

        await testSliderWidget(comms);
    });
    test.skip('Widget renders after interrupting kernel', async () => {
        // https://github.com/microsoft/vscode-jupyter/issues/8749
        const comms = await initializeNotebook({ templateFile: templateNbPath });
        await testSliderWidget(comms);

        // Restart the kernel.
        const kernel = kernelProvider.get(vscodeNotebook.activeNotebookEditor!.document.uri)!;
        await kernel.interrupt();
        await testSliderWidget(comms);

        // Clear all cells and restart and test again.
        await kernel.interrupt();
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;
        await commands.executeCommand('notebook.clearAllCellsOutputs');
        await waitForCondition(async () => cell.outputs.length === 0, 5_000, 'Cell did not get cleared');

        await testSliderWidget(comms);
    });
});
