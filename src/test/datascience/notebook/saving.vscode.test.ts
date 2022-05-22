// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert, expect } from 'chai';
import * as sinon from 'sinon';
import { NotebookCell, Uri } from 'vscode';
import { IVSCodeNotebook } from '../../../platform/common/application/types';
import { PYTHON_LANGUAGE } from '../../../platform/common/constants';
import { traceInfo } from '../../../platform/logging';
import { IDisposable } from '../../../platform/common/types';
import { IExtensionTestApi, waitForCondition } from '../../common.node';
import { IS_REMOTE_NATIVE_TEST } from '../../constants.node';
import { closeActiveWindows, initialize } from '../../initialize.node';
import { openNotebook } from '../helpers.node';
import {
    assertHasTextOutputInVSCode,
    assertVSCCellHasErrorOutput,
    assertVSCCellStateIsUndefinedOrIdle,
    closeNotebooks,
    closeNotebooksAndCleanUpAfterTests,
    createTemporaryNotebook,
    runAllCellsInActiveNotebook,
    insertCodeCell,
    saveActiveNotebook,
    waitForExecutionCompletedSuccessfully,
    waitForExecutionCompletedWithErrors,
    waitForKernelToGetAutoSelected
} from './helper.node';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import cloneDeep = require('lodash/cloneDeep');

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataScience - VSCode Notebook - (Saving) (slow)', function () {
    this.timeout(60_000);
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
    let testEmptyIPynb: Uri;
    suiteSetup(async function () {
        api = await initialize();
        if (IS_REMOTE_NATIVE_TEST()) {
            return this.skip();
        }
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
    });
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        sinon.restore();
        // Don't use same file (due to dirty handling, we might save in dirty.)
        // Coz we won't save to file, hence extension will backup in dirty file and when u re-open it will open from dirty.
        testEmptyIPynb = await createTemporaryNotebook([], disposables);
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        await closeNotebooks(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(closeNotebooksAndCleanUpAfterTests);
    test('Verify output & metadata when re-opening (slow)', async () => {
        const notebook = await openNotebook(testEmptyIPynb);

        await insertCodeCell('print(1)', { index: 0 });
        await insertCodeCell('print(a)', { index: 1 });
        await insertCodeCell('import time\nfor i in range(10000):\n  print(i)\n  time.sleep(0.1)', { index: 2 });
        await insertCodeCell('import time\nfor i in range(10000):\n  print(i)\n  time.sleep(0.1)', { index: 3 });
        let cell1: NotebookCell;
        let cell2: NotebookCell;
        let cell3: NotebookCell;
        let cell4: NotebookCell;

        function initializeCells() {
            cell1 = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;
            cell2 = vscodeNotebook.activeNotebookEditor?.notebook.getCells()![1]!;
            cell3 = vscodeNotebook.activeNotebookEditor?.notebook.getCells()![2]!;
            cell4 = vscodeNotebook.activeNotebookEditor?.notebook.getCells()![3]!;
        }
        initializeCells();
        await waitForKernelToGetAutoSelected(PYTHON_LANGUAGE);
        await runAllCellsInActiveNotebook();
        // Wait till 1 & 2 finish & 3rd cell starts executing.
        await waitForExecutionCompletedSuccessfully(cell1!);
        await waitForExecutionCompletedWithErrors(cell2!);
        await waitForCondition(
            async () => assertVSCCellStateIsUndefinedOrIdle(cell3) && assertVSCCellStateIsUndefinedOrIdle(cell4),
            15_000,
            'Cells did not finish executing'
        );
        const notebookMetadata = cloneDeep(notebook.metadata);
        assert.strictEqual(
            notebookMetadata.custom.metadata.kernelspec.language,
            'python',
            `Kernel language not set correctly.`
        );

        function verifyCellMetadata() {
            assert.lengthOf(cell1.outputs, 1, 'Incorrect output for cell 1');
            assert.lengthOf(cell2.outputs, 1, 'Incorrect output for cell 2');
            assert.lengthOf(cell3.outputs, 0, 'Incorrect output for cell 3'); // stream and interrupt error.
            assert.lengthOf(cell4.outputs, 0, 'Incorrect output for cell 4');

            assertHasTextOutputInVSCode(cell1, '1', 0);
            assertVSCCellHasErrorOutput(cell2);

            expect(cell1.executionSummary?.executionOrder).to.be.greaterThan(0, 'Execution count should be > 0');
            expect(cell2.executionSummary?.executionOrder).to.be.greaterThan(
                cell1.executionSummary?.executionOrder!,
                'Execution count > cell 1'
            );
            assert.isUndefined(cell3.executionSummary?.executionOrder, 'Execution count must be undefined for cell 3');
            assert.isUndefined(cell4.executionSummary?.executionOrder, 'Execution count must be undefined for cell 4');
        }

        verifyCellMetadata();

        // Save and close this nb.
        await saveActiveNotebook();
        await closeActiveWindows();

        // Reopen the notebook & validate the metadata.
        const secondNotebook = await openNotebook(testEmptyIPynb);
        initializeCells();
        verifyCellMetadata();
        assert.deepEqual(notebookMetadata, secondNotebook.metadata);
    });
});
