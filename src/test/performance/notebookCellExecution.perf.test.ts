// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import { IVSCodeNotebook } from '../../platform/common/application/types';
import { IDisposable } from '../../platform/common/types';
import { IExtensionTestApi } from '../common';
import { captureScreenShot } from '../common.node';
import { createEmptyPythonNotebook, insertCodeCell, runCell, waitForTextOutput } from '../datascience/notebook/helper';
import { activateExtension, initializePython } from '../initialize.node';
import { PerformanceTracker } from './performanceTracker';

suite('Initial Notebook Cell Execution Perf Test', function () {
    this.timeout(120_000);
    let tracker: PerformanceTracker;
    setup(function () {
        sinon.restore();
        tracker = new PerformanceTracker();
    });
    teardown(async function () {
        // results are reported in global test hooks
        this.currentTest!.perfCheckpoints = tracker.finish();
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this);
        }
    });
    test.skip('Initial Notebook Cell Execution Perf Test', async function () {
        // See https://github.com/microsoft/vscode-jupyter/issues/11303
        const disposables: IDisposable[] = [];
        sinon.restore();
        await initializePython();
        tracker.markTime('pythonExtensionActivation');

        const api = (await activateExtension()) as IExtensionTestApi;
        tracker.markTime('jupyterExtensionActivation');

        const vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        await createEmptyPythonNotebook(disposables);
        assert.isOk(vscodeNotebook.activeNotebookEditor, 'No active notebook');
        tracker.markTime('notebookCreated');

        await insertCodeCell('print("testing")', { index: 0 });
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;
        await Promise.all([runCell(cell), waitForTextOutput(cell, 'testing')]);
        tracker.markTime('cellExecuted');
    });
});
