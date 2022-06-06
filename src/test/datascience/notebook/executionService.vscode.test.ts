// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import * as fs from 'fs-extra';
import { assert } from 'chai';
import * as dedent from 'dedent';
import * as sinon from 'sinon';
import { NotebookCell, NotebookCellKind, Uri, workspace } from 'vscode';
import { Common } from '../../../platform/common/utils/localize';
import { IVSCodeNotebook } from '../../../platform/common/application/types';
import { traceInfo } from '../../../platform/logging';
import { IDisposable } from '../../../platform/common/types';
import { initialize, captureScreenShot, IExtensionTestApi } from '../../common';
import {
    closeNotebooksAndCleanUpAfterTests,
    runAllCellsInActiveNotebook,
    runCell,
    insertCodeCell,
    waitForExecutionCompletedSuccessfully,
    waitForExecutionCompletedWithErrors,
    prewarmNotebooks,
    hijackPrompt,
    waitForExecutionInProgress,
    waitForQueuedForExecution,
    insertMarkdownCell,
    assertVSCCellIsNotRunning,
    createEmptyPythonNotebook,
    waitForQueuedForExecutionOrExecuting,
    workAroundVSCodeNotebookStartPages,
    waitForTextOutput,
    createTemporaryNotebookFromFile
} from './helper';
import { startJupyterServer } from '../../common';
import { noop } from '../../../platform/common/utils/misc';
import { ProductNames } from '../../../kernels/installer/productNames';
import { Product } from '../../../kernels/installer/types';

// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const expectedPromptMessageSuffix = `requires ${ProductNames.get(Product.ipykernel)!} to be installed.`;

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataScience - VSCode Notebook - (Execution) (slow)', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
    const templateNbPath = Uri.joinPath(workspace.workspaceFolders![0].uri, 'notebook', 'emptyCellWithOutput.ipynb');

    this.timeout(120_000);
    suiteSetup(async function () {
        traceInfo('Suite Setup VS Code Notebook - Execution');
        this.timeout(120_000);
        try {
            api = await initialize();
            await workAroundVSCodeNotebookStartPages();
            await hijackPrompt(
                'showErrorMessage',
                { endsWith: expectedPromptMessageSuffix },
                { text: Common.install(), clickImmediately: true },
                disposables
            );

            await startJupyterServer();
            await prewarmNotebooks();
            sinon.restore();
            vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
            traceInfo('Suite Setup (completed)');
        } catch (e) {
            traceInfo('Suite Setup (failed) - Execution');
            await captureScreenShot('execution-suite');
            throw e;
        }
    });
    // Use same notebook without starting kernel in every single test (use one for whole suite).
    setup(async function () {
        try {
            traceInfo(`Start Test ${this.currentTest?.title}`);
            sinon.restore();
            await startJupyterServer();
            await createEmptyPythonNotebook(disposables);
            assert.isOk(vscodeNotebook.activeNotebookEditor, 'No active notebook');
            traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
        } catch (e) {
            await captureScreenShot(this.currentTest?.title || 'unknown');
            throw e;
        }
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
    test('Execute cell using VSCode Kernel', async () => {
        await insertCodeCell('print("123412341234")', { index: 0 });
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;

        await Promise.all([runCell(cell), waitForTextOutput(cell, '123412341234')]);
    });
    test('Run whole document and test status of cells', async () => {
        const cells = await insertRandomCells({ count: 4, addMarkdownCells: false });

        // Cell 1 should have started, cells 2 & 3 should be queued.
        const [cell1, cell2, cell3, cell4] = cells;
        await Promise.all([
            runAllCellsInActiveNotebook(),
            waitForExecutionInProgress(cell1.cell),
            waitForQueuedForExecution(cell2.cell),
            waitForQueuedForExecution(cell3.cell),
            waitForQueuedForExecution(cell4.cell)
        ]);

        // After cell 1 completes, then cell 2 should start & cell 3 still queued.
        cell1.runToCompletion();
        await Promise.all([
            waitForExecutionCompletedSuccessfully(cell1.cell),
            waitForExecutionInProgress(cell2.cell),
            waitForQueuedForExecution(cell3.cell),
            waitForQueuedForExecution(cell4.cell)
        ]);

        // After cell 2 completes, then cell 3 should start.
        cell2.runToCompletion();
        await Promise.all([
            waitForExecutionCompletedSuccessfully(cell1.cell),
            waitForExecutionCompletedSuccessfully(cell2.cell),
            waitForExecutionInProgress(cell3.cell),
            waitForQueuedForExecution(cell4.cell)
        ]);

        // After cell 3 completes, then cell 4 should start.
        cell3.runToCompletion();
        await Promise.all([
            waitForExecutionCompletedSuccessfully(cell1.cell),
            waitForExecutionCompletedSuccessfully(cell2.cell),
            waitForExecutionCompletedSuccessfully(cell3.cell),
            waitForExecutionInProgress(cell4.cell)
        ]);

        // After cell 4 completes, all should have completed.
        cell4.runToCompletion();
        await Promise.all([
            waitForExecutionCompletedSuccessfully(cell1.cell),
            waitForExecutionCompletedSuccessfully(cell2.cell),
            waitForExecutionCompletedSuccessfully(cell3.cell),
            waitForExecutionCompletedSuccessfully(cell4.cell)
        ]);
        assertExecutionOrderOfCells(cells.map((item) => item.cell));
    });
    test('Run cells randomly & validate the order of execution', async () => {
        const cells = await insertRandomCells({ count: 15, addMarkdownCells: true });
        const codeCells = cells.filter((cell) => cell.cell.kind === NotebookCellKind.Code);
        // Run cells at random & keep track of the order in which they were run (to validate execution order later).
        const queuedCells: typeof cells = [];
        while (codeCells.length) {
            const index = Math.floor(Math.random() * codeCells.length);
            const cellToQueue = codeCells.splice(index, 1)[0];
            queuedCells.push(cellToQueue);
            await runCell(cellToQueue.cell);
        }

        // Verify all have been queued.
        await Promise.all(
            queuedCells.map((item) => item.cell).map((cell) => waitForQueuedForExecutionOrExecuting(cell))
        );

        // let all cells run to completion & validate their execution orders match the order of the queue.
        queuedCells.forEach((item) => item.runToCompletion());
        await Promise.all(
            queuedCells.map((item) => item.cell).map((cell) => waitForExecutionCompletedSuccessfully(cell))
        );
        assertExecutionOrderOfCells(queuedCells.map((item) => item.cell));
    });
    test('Run first 10 cells, fail 5th cell & validate first 4 ran, 5th failed & rest did not run', async () => {
        // Add first 4 code cells.
        const cells = await insertRandomCells({ count: 4, addMarkdownCells: false });
        // Add 5th code cells code errors.
        cells.push({
            runToCompletion: noop,
            cell: await insertCodeCell('KABOOM', { index: 4 })
        });
        // Add 5 more code cells.
        cells.push(...(await insertRandomCells({ count: 5, addMarkdownCells: false })));

        // Run the whole document.
        // Verify all have been queued.
        await Promise.all([
            runAllCellsInActiveNotebook(),
            ...cells.map((item) => item.cell).map((cell) => waitForQueuedForExecutionOrExecuting(cell))
        ]);

        // let all cells run to completion & validate their execution orders match the order of the queue.
        cells.forEach((item) => item.runToCompletion());

        // First 4 passed.
        const first4Cells = cells.filter((_, index) => index <= 3);
        await Promise.all(
            first4Cells.map((item) => item.cell).map((cell) => waitForExecutionCompletedSuccessfully(cell))
        );
        assertExecutionOrderOfCells(first4Cells.map((item) => item.cell));
        // 5th failed.
        await waitForExecutionCompletedWithErrors(cells[4].cell);
        // Rest did not run.
        const restOfCells = cells.filter((_, index) => index > 5);
        await restOfCells.map((item) => item.cell).map(assertVSCCellIsNotRunning);
    });
    test('Run cells randomly, and fail one & validate the order & status of execution', async () => {
        // E.g. create 10 cells
        // Run 3 cells successfully
        // Run 4th cell and let it fail
        // 3 should pass, 1 should fail, rest should not have run.

        // Create some code cells (we need a minium of 5 for the test).
        const cells = await insertRandomCells({ count: 5, addMarkdownCells: false });
        // Create some code cells & markdown cells.
        cells.push(...(await insertRandomCells({ count: 10, addMarkdownCells: true })));

        const codeCells = cells.filter((cell) => cell.cell.kind === NotebookCellKind.Code);
        const queuedCells: NotebookCell[] = [];
        for (let index = 0; index < codeCells.length; index++) {
            const cell = codeCells[index].cell;
            if (cell.kind === NotebookCellKind.Code) {
                queuedCells.push(cell);
                await Promise.all([runCell(cell), waitForQueuedForExecutionOrExecuting(cell)]);
            }
        }

        // let all cells run to completion & validate their execution orders match the order of the queue.
        codeCells.forEach((item) => item.runToCompletion());
        await Promise.all(queuedCells.map((cell) => waitForExecutionCompletedSuccessfully(cell)));
        assertExecutionOrderOfCells(queuedCells);
    });
    test('Run entire notebook then add a new cell, ensure new cell is not executed', async () => {
        const cells = await insertRandomCells({ count: 15, addMarkdownCells: true });

        const queuedCells = cells.filter((item) => item.cell.kind === NotebookCellKind.Code).map((item) => item.cell);
        await Promise.all([
            runAllCellsInActiveNotebook(),
            ...queuedCells.map((cell) => waitForQueuedForExecutionOrExecuting(cell))
        ]);

        // Add a new cell to the document, this should not get executed.
        const [newCell] = await insertRandomCells({ count: 1, addMarkdownCells: false });

        // let all cells run to completion & validate their execution orders match the order of the queue.
        // Also, the new cell should not have been executed.
        cells.forEach((item) => item.runToCompletion());
        await Promise.all(queuedCells.map((cell) => waitForExecutionCompletedSuccessfully(cell)));
        assertExecutionOrderOfCells(queuedCells);

        // This is a brand new cell created by the user, all metadata will be undefined.
        assert.isUndefined(newCell.cell.executionSummary?.executionOrder);
        assert.equal(newCell.cell.outputs.length, 0);
    });
    test('Run entire notebook then add a new cell & run that as well, ensure this new cell is also executed', async () => {
        const cells = await insertRandomCells({ count: 15, addMarkdownCells: true });
        const codeCells = cells.filter((cell) => cell.cell.kind === NotebookCellKind.Code);

        const queuedCells = codeCells.map((item) => item.cell);
        // Run entire notebook & verify all cells are queued for execution.
        await Promise.all([
            runAllCellsInActiveNotebook(),
            ...queuedCells.map((cell) => waitForQueuedForExecutionOrExecuting(cell))
        ]);

        // Insert new cell & run it, & verify that too is queued for execution.
        const [newCell] = await insertRandomCells({ count: 1, addMarkdownCells: false });
        queuedCells.push(newCell.cell);
        await Promise.all([
            runCell(newCell.cell),
            ...queuedCells.map((cell) => waitForQueuedForExecutionOrExecuting(cell))
        ]);

        // let all cells run to completion & validate their execution orders match the order in which they were run.
        // Also, the new cell should not have been executed.
        cells.forEach((item) => item.runToCompletion());
        newCell.runToCompletion();
        await Promise.all(queuedCells.map((cell) => waitForExecutionCompletedSuccessfully(cell)));
        assertExecutionOrderOfCells(queuedCells);
    });

    /**
     * Verify the fact that cells provided were executed in the order they appear in the list.
     * (the execution order of each subsequent cell in the list is expected to have an execution order greater than the previous cell).
     */
    function assertExecutionOrderOfCells(cells: readonly NotebookCell[]) {
        let firstCellExecutionOrder: number;
        cells.forEach((cell, index) => {
            if (index === 0) {
                firstCellExecutionOrder = cell.executionSummary?.executionOrder!;
                return;
            }
            // This next cell must have an execution order +1 from previous cell in the queue.
            assert.equal(
                cell.executionSummary?.executionOrder,
                firstCellExecutionOrder + index,
                `Execution order of cell ${cell.index} is not one more than previous cell`
            );
        });
    }

    /**
     * Randomly inserts a code or markdown cell.
     * The code is long running, that will run to completion when a file is deleted.
     * This allows us to test long running cells & let it run to completion when we want.
     * The return value contains a method `runToCompletion` which when invoked will ensure the cell will run to completion.
     */
    async function insertRandomCells(options?: { count: number; addMarkdownCells: boolean }) {
        const cellInfo: { runToCompletion: Function; cell: NotebookCell }[] = [];
        const numberOfCellsToAdd = options?.count ?? 10;
        const startIndex = vscodeNotebook.activeNotebookEditor!.notebook.cellCount;
        const endIndex = startIndex + numberOfCellsToAdd;
        // Insert the necessary amount of cells
        for (let index = startIndex; index < endIndex; index++) {
            // Once this file is deleted the cell will run to completion.
            const tmpFile = (await createTemporaryNotebookFromFile(templateNbPath, disposables)).fsPath;
            let cell: NotebookCell;
            if (!options?.addMarkdownCells || Math.floor(Math.random() * 2) === 0) {
                cell = await insertCodeCell(
                    dedent`
                        print("Start Cell ${index}")
                        import time
                        import os.path
                        from os import path
                        while os.path.exists('${tmpFile.replace(/\\/g, '\\\\')}'):
                            time.sleep(0.1)

                        print("End Cell ${index}")`,
                    { index: index }
                );
            } else {
                cell = await insertMarkdownCell(`Markdown Cell ${index}`, { index: index });
            }

            cellInfo.push({ runToCompletion: () => fs.unlinkSync(tmpFile), cell });
        }

        return cellInfo;
    }
});
