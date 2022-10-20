// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert, expect } from 'chai';
import * as sinon from 'sinon';
import { NotebookCell, NotebookDocument, Uri } from 'vscode';
import { PYTHON_LANGUAGE } from '../../../platform/common/constants';
import { traceInfo } from '../../../platform/logging';
import { IDisposable } from '../../../platform/common/types';
import { waitForCondition } from '../../common.node';
import { IS_REMOTE_NATIVE_TEST } from '../../constants.node';
import { closeActiveWindows } from '../../initialize.node';
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
    const disposables: IDisposable[] = [];
    let testEmptyIPynb: Uri;
    suiteSetup(async function () {
        if (IS_REMOTE_NATIVE_TEST()) {
            return this.skip();
        }
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
        const { notebook, editor } = await openNotebook(testEmptyIPynb);

        await insertCodeCell('print(1)', { index: 0 });
        await insertCodeCell('print(a)', { index: 1 });
        await insertCodeCell('import time\nfor i in range(10000):\n  print(i)\n  time.sleep(0.1)', { index: 2 });
        await insertCodeCell('import time\nfor i in range(10000):\n  print(i)\n  time.sleep(0.1)', { index: 3 });
        let cell1: NotebookCell;
        let cell2: NotebookCell;
        let cell3: NotebookCell;
        let cell4: NotebookCell;

        function initializeCells(n: NotebookDocument) {
            cell1 = n.cellAt(0)!;
            cell2 = n.getCells()![1]!;
            cell3 = n.getCells()![2]!;
            cell4 = n.getCells()![3]!;
        }
        initializeCells(notebook);
        await waitForKernelToGetAutoSelected(editor, PYTHON_LANGUAGE);
        await runAllCellsInActiveNotebook(false, editor);
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
            notebookMetadata.custom.metadata.language_info.name,
            'python',
            `Language not set correctly.`
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
        initializeCells(secondNotebook.notebook);
        verifyCellMetadata();
        assert.deepEqual(notebookMetadata, secondNotebook.notebook.metadata);
    });
});
