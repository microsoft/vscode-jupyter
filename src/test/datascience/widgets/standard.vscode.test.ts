// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import * as path from 'path';
import * as sinon from 'sinon';
import { Uri } from 'vscode';
import { IVSCodeNotebook } from '../../../client/common/application/types';
import { traceInfo } from '../../../client/common/logger';
import { IDisposable } from '../../../client/common/types';
import { captureScreenShot, IExtensionTestApi, waitForCondition } from '../../common';
import { EXTENSION_ROOT_DIR_FOR_TESTS, initialize } from '../../initialize';
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
import { initializeWidgetComms } from './commUtils';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('Standard IPyWidget (Execution) (slow)', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
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
    test('Slider Widget', async function () {
        const nbUri = Uri.file(await createTemporaryNotebook(templateNbPath, disposables));
        await openNotebook(nbUri.fsPath);
        await waitForKernelToGetAutoSelected();
        const comms = initializeWidgetComms(api.serviceContainer);
        // Confirm we have execution order and output.
        const cell1 = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;
        await Promise.all([
            runCell(cell1),
            waitForExecutionCompletedSuccessfully(cell1),
            waitForCondition(
                async () => cell1.outputs.length === 0,
                defaultNotebookTestTimeout,
                'Cell output is not empty'
            ),
            comms.ready
        ]);

        // Verify the slider widget is created.
        await waitForCondition(
            async () => {
                const innerHTML = await comms.queryHtml(`#${cell1.outputs[0].id} .widget-readout`);
                assert.strictEqual(innerHTML, '666', 'Slider not renderer with the correct value');
                return true;
            },
            15_000,
            'Slider not rendered'
        );
    });
});
