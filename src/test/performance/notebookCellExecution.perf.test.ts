import { assert } from 'chai';
import * as sinon from 'sinon';
import { IVSCodeNotebook } from '../../platform/common/application/types';
import { IDisposable } from '../../platform/common/types';
import { IExtensionTestApi } from '../common';
import { createEmptyPythonNotebook, insertCodeCell, runCell, waitForTextOutput } from '../datascience/notebook/helper';
import { activateExtension, initializePython } from '../initialize.node';
import { PerformanceTracker } from './performanceTracker';

suite('Initial Notebook Cell Execution Perf Test', () => {
    let tracker: PerformanceTracker;
    setup(function () {
        sinon.restore();
        tracker = new PerformanceTracker(this.currentTest!.title);
    });
    teardown(async function () {
        let result = this.currentTest?.isFailed() ? 'failed' : this.currentTest?.isPassed() ? 'passed' : 'skipped';
        tracker.finishAndReport(result);
        await tracker.dispose();
    });
    test('Initial Notebook Cell Execution Perf Test', async function () {
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
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;
        await Promise.all([runCell(cell), waitForTextOutput(cell, 'testing')]);
        tracker.markTime('cellExecuted');
    });
});
