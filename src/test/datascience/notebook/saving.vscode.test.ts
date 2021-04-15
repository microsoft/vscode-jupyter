// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert, expect } from 'chai';
import * as path from 'path';
import * as sinon from 'sinon';
import { NotebookCell, Uri } from 'vscode';
import { IVSCodeNotebook } from '../../../client/common/application/types';
import { IDisposable } from '../../../client/common/types';
import { StatusBarProvider } from '../../../client/datascience/notebook/statusBarProvider';
import { IExtensionTestApi, waitForCondition } from '../../common';
import { IS_REMOTE_NATIVE_TEST } from '../../constants';
import { closeActiveWindows, EXTENSION_ROOT_DIR_FOR_TESTS, initialize } from '../../initialize';
import { openNotebook } from '../helpers';
import {
    assertHasTextOutputInVSCode,
    assertVSCCellHasErrorOutput,
    assertVSCCellStateIsUndefinedOrIdle,
    canRunNotebookTests,
    closeNotebooks,
    closeNotebooksAndCleanUpAfterTests,
    createTemporaryNotebook,
    runAllCellsInActiveNotebook,
    insertCodeCell,
    saveActiveNotebook,
    trustAllNotebooks,
    waitForExecutionCompletedSuccessfully,
    waitForExecutionCompletedWithErrors
} from './helper';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataScience - VSCode Notebook - (Saving) (slow)', function () {
    this.timeout(60_000);
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
    const templateIPynbEmpty = path.join(
        EXTENSION_ROOT_DIR_FOR_TESTS,
        'src',
        'test',
        'datascience',
        'notebook',
        'empty.ipynb'
    );
    let testEmptyIPynb: Uri;
    suiteSetup(async function () {
        api = await initialize();
        if (IS_REMOTE_NATIVE_TEST || !(await canRunNotebookTests())) {
            return this.skip();
        }
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
    });
    setup(async () => {
        sinon.restore();
        await trustAllNotebooks();
        // Don't use same file (due to dirty handling, we might save in dirty.)
        // Coz we won't save to file, hence extension will backup in dirty file and when u re-open it will open from dirty.
        testEmptyIPynb = Uri.file(await createTemporaryNotebook(templateIPynbEmpty, disposables));
    });
    teardown(() => closeNotebooks(disposables));
    suiteTeardown(closeNotebooksAndCleanUpAfterTests);
    test('Verify output & metadata when re-opening (slow)', async () => {
        await openNotebook(api.serviceContainer, testEmptyIPynb.fsPath);

        await insertCodeCell('print(1)', { index: 0 });
        await insertCodeCell('print(a)', { index: 1 });
        await insertCodeCell('import time\nfor i in range(10000):\n  print(i)\n  time.sleep(0.1)', { index: 2 });
        await insertCodeCell('import time\nfor i in range(10000):\n  print(i)\n  time.sleep(0.1)', { index: 3 });
        let cell1: NotebookCell;
        let cell2: NotebookCell;
        let cell3: NotebookCell;
        let cell4: NotebookCell;

        function initializeCells() {
            cell1 = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;
            cell2 = vscodeNotebook.activeNotebookEditor?.document.getCells()![1]!;
            cell3 = vscodeNotebook.activeNotebookEditor?.document.getCells()![2]!;
            cell4 = vscodeNotebook.activeNotebookEditor?.document.getCells()![3]!;
        }
        initializeCells();
        await runAllCellsInActiveNotebook();
        // Wait till 1 & 2 finish & 3rd cell starts executing.
        await waitForExecutionCompletedSuccessfully(cell1!);
        await waitForExecutionCompletedWithErrors(cell2!);
        await waitForCondition(
            async () => assertVSCCellStateIsUndefinedOrIdle(cell3) && assertVSCCellStateIsUndefinedOrIdle(cell4),
            15_000,
            'Cells did not finish executing'
        );

        function verifyCelMetadata() {
            assert.lengthOf(cell1.outputs, 1, 'Incorrect output for cell 1');
            assert.lengthOf(cell2.outputs, 1, 'Incorrect output for cell 2');
            assert.lengthOf(cell3.outputs, 0, 'Incorrect output for cell 3'); // stream and interrupt error.
            assert.lengthOf(cell4.outputs, 0, 'Incorrect output for cell 4');

            assertHasTextOutputInVSCode(cell1, '1', 0);
            assertVSCCellHasErrorOutput(cell2);

            expect(cell1.latestExecutionSummary?.executionOrder).to.be.greaterThan(0, 'Execution count should be > 0');
            expect(cell2.latestExecutionSummary?.executionOrder).to.be.greaterThan(
                cell1.latestExecutionSummary?.executionOrder!,
                'Execution count > cell 1'
            );
            assert.isUndefined(
                cell3.latestExecutionSummary?.executionOrder,
                'Execution count must be undefined for cell 3'
            );
            assert.isUndefined(
                cell4.latestExecutionSummary?.executionOrder,
                'Execution count must be undefined for cell 4'
            );

            const statusBarItem1 = StatusBarProvider.getCellStatusBarItem(cell1);
            const statusBarItem2 = StatusBarProvider.getCellStatusBarItem(cell2);
            const statusBarItem3 = StatusBarProvider.getCellStatusBarItem(cell3);
            const statusBarItem4 = StatusBarProvider.getCellStatusBarItem(cell4);
            assert.isEmpty(statusBarItem1?.text || '', 'Cell 1 status should be empty'); // No errors.
            assert.isNotEmpty(statusBarItem2?.text, 'Cell 1 status should be empty'); // Errors.
            assert.isEmpty(statusBarItem3?.text || '', 'Cell 3 status should be empty'); // Not executed.
            assert.isEmpty(statusBarItem4?.text || '', 'Cell 4 status should be empty'); // Not executed.
        }

        verifyCelMetadata();

        // Save and close this nb.
        await saveActiveNotebook(disposables);
        await closeActiveWindows();

        // Reopen the notebook & validate the metadata.
        await openNotebook(api.serviceContainer, testEmptyIPynb.fsPath);
        initializeCells();
        verifyCelMetadata();
    });
});
