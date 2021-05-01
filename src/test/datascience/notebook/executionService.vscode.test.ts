// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert, expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as dedent from 'dedent';
import * as sinon from 'sinon';
import { commands, NotebookCell, NotebookCellExecutionState, NotebookCellKind, Uri } from 'vscode';
import { Common } from '../../../client/common/utils/localize';
import { IVSCodeNotebook } from '../../../client/common/application/types';
import { traceInfo } from '../../../client/common/logger';
import { IDisposable, Product } from '../../../client/common/types';
import { IExtensionTestApi, waitForCondition } from '../../common';
import { EXTENSION_ROOT_DIR_FOR_TESTS, initialize } from '../../initialize';
import {
    assertHasTextOutputInVSCode,
    canRunNotebookTests,
    closeNotebooksAndCleanUpAfterTests,
    runAllCellsInActiveNotebook,
    runCell,
    insertCodeCell,
    trustAllNotebooks,
    startJupyterServer,
    waitForExecutionCompletedSuccessfully,
    waitForExecutionCompletedWithErrors,
    waitForKernelToGetAutoSelected,
    prewarmNotebooks,
    hijackPrompt,
    waitForEmptyCellExecutionCompleted,
    createTemporaryNotebook,
    closeNotebooks,
    waitForExecutionInProgress,
    waitForQueuedForExecution,
    insertMarkdownCell,
    assertVSCCellIsNotRunning,
    createEmptyPythonNotebook,
    assertNotHasTextOutputInVSCode
} from './helper';
import { ProductNames } from '../../../client/common/installer/productNames';
import { openNotebook } from '../helpers';
import { noop } from '../../../client/common/utils/misc';
import {
    CellOutputMetadata,
    getTextOutputValue,
    hasErrorOutput,
    NotebookCellStateTracker,
    translateCellErrorOutput
} from '../../../client/datascience/notebook/helpers/helpers';

// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const expectedPromptMessageSuffix = `requires ${ProductNames.get(Product.ipykernel)!} to be installed.`;

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataScience - VSCode Notebook - (Execution) (slow)', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
    const templateNbPath = path.join(
        EXTENSION_ROOT_DIR_FOR_TESTS,
        'src',
        'test',
        'datascience',
        'notebook',
        'emptyCellWithOutput.ipynb'
    );

    this.timeout(120_000);
    suiteSetup(async function () {
        this.timeout(120_000);
        api = await initialize();
        if (!(await canRunNotebookTests())) {
            return this.skip();
        }
        await hijackPrompt(
            'showErrorMessage',
            { endsWith: expectedPromptMessageSuffix },
            { text: Common.install(), clickImmediately: true },
            disposables
        );

        await trustAllNotebooks();
        await startJupyterServer();
        await prewarmNotebooks();
        sinon.restore();
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
    });
    // Use same notebook without starting kernel in every single test (use one for whole suite).
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        sinon.restore();
        await startJupyterServer();
        await trustAllNotebooks();
        await createEmptyPythonNotebook(disposables);
        assert.isOk(vscodeNotebook.activeNotebookEditor, 'No active notebook');
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        // Added temporarily to identify why tests are failing.
        process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT = undefined;
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));
    test('Execute cell using VSCode Kernel', async () => {
        await insertCodeCell('print("123412341234")', { index: 0 });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;

        await runCell(cell);

        // Wait till execution count changes and status is success.
        await waitForExecutionCompletedSuccessfully(cell);
    });
    test('Leading whitespace not suppressed', async () => {
        await insertCodeCell('print("\tho")\nprint("\tho")\nprint("\tho")\n', { index: 0 });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;

        await runCell(cell);

        await waitForExecutionCompletedSuccessfully(cell);
        const output = getTextOutputValue(cell.outputs[0]);
        assert.equal(output, '\tho\n\tho\n\tho\n', 'Cell with leading whitespace has incorrect output');
    });
    test('Empty cells will not have an execution order nor have a status of success', async () => {
        await insertCodeCell('');
        await insertCodeCell('print("Hello World")');
        const cells = vscodeNotebook.activeNotebookEditor?.document.getCells()!;

        await runAllCellsInActiveNotebook();

        // Wait till execution count changes and status is success for second cell.
        await waitForExecutionCompletedSuccessfully(cells[1]);

        assert.isUndefined(cells[0].latestExecutionSummary?.executionOrder);
    });
    test('Clear output in empty cells', async () => {
        await closeNotebooks();
        const nbUri = Uri.file(await createTemporaryNotebook(templateNbPath, disposables));
        await openNotebook(api.serviceContainer, nbUri.fsPath);
        await waitForKernelToGetAutoSelected();

        // Confirm we have execution order and output.
        const cells = vscodeNotebook.activeNotebookEditor?.document.getCells()!;
        assert.equal(cells[0].latestExecutionSummary?.executionOrder, 1);
        assertHasTextOutputInVSCode(cells[0], 'Hello World');

        await runAllCellsInActiveNotebook();
        await waitForEmptyCellExecutionCompleted(cells[0]);

        // Clear the cell and run the empty cell again & the status should change the idle & output cleared.
        assert.equal(NotebookCellStateTracker.getCellState(cells[0]), NotebookCellExecutionState.Idle);
        assert.equal(cells[0].outputs.length, 0, 'Cell output is not empty');
        assert.isUndefined(cells[0].latestExecutionSummary?.executionOrder, 'Cell execution order should be undefined');
    });
    test('Verify Cell output, execution count and status', async () => {
        await insertCodeCell('print("Hello World")');
        await runAllCellsInActiveNotebook();

        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;
        // Wait till execution count changes and status is success.
        await waitForExecutionCompletedSuccessfully(cell);
        // Verify output.
        assertHasTextOutputInVSCode(cell, 'Hello World', 0);

        // Verify execution count.
        assert.ok(cell.latestExecutionSummary?.executionOrder, 'Execution count should be > 0');
    });
    test('Verify multiple cells get executed', async () => {
        await insertCodeCell('print("Foo Bar")');
        await insertCodeCell('print("Hello World")');
        const cells = vscodeNotebook.activeNotebookEditor?.document.getCells()!;

        await runAllCellsInActiveNotebook();

        // Wait till execution count changes and status is success.
        await waitForExecutionCompletedSuccessfully(cells[0]);
        await waitForExecutionCompletedSuccessfully(cells[1]);

        // Verify output.
        assertHasTextOutputInVSCode(cells[0], 'Foo Bar');
        assertHasTextOutputInVSCode(cells[1], 'Hello World');

        // Verify execution count.
        assert.ok(cells[0].latestExecutionSummary?.executionOrder, 'Execution count should be > 0');
        assert.equal(
            cells[1].latestExecutionSummary?.executionOrder! - 1,
            cells[0].latestExecutionSummary?.executionOrder!
        );
    });
    test('Verify metadata for successfully executed cell', async () => {
        await insertCodeCell('print("Foo Bar")');
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;

        await runAllCellsInActiveNotebook();

        // Wait till execution count changes and status is success.
        await waitForExecutionCompletedSuccessfully(cell);

        expect(cell.latestExecutionSummary?.executionOrder).to.be.greaterThan(0, 'Execution count should be > 0');
        assert.equal(NotebookCellStateTracker.getCellState(cell), NotebookCellExecutionState.Idle, 'Incorrect State');
        assert.isFalse(hasErrorOutput(cell.outputs), 'Incorrect State');
    });
    test('Verify output & metadata for executed cell with errors', async () => {
        await insertCodeCell('print(abcd)');
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;

        await runAllCellsInActiveNotebook();

        // Wait till execution count changes and status is error.
        await waitForExecutionCompletedWithErrors(cell);

        assert.lengthOf(cell.outputs, 1, 'Incorrect output');
        assert.isTrue(hasErrorOutput(cell.outputs), 'No Error output');
        const errorOutput = translateCellErrorOutput(cell.outputs[0]);
        assert.equal(errorOutput.ename, 'NameError', 'Incorrect ename'); // As status contains ename, we don't want this displayed again.
        assert.equal(errorOutput.evalue, "name 'abcd' is not defined", 'Incorrect evalue'); // As status contains ename, we don't want this displayed again.
        assert.isNotEmpty(errorOutput.traceback, 'Incorrect traceback');
        expect(cell.latestExecutionSummary?.executionOrder).to.be.greaterThan(0, 'Execution count should be > 0');
        assert.equal(NotebookCellStateTracker.getCellState(cell), NotebookCellExecutionState.Idle, 'Incorrect State');
        assert.ok(hasErrorOutput(cell.outputs), 'Incorrect State');
    });
    test('Updating display data', async () => {
        await insertCodeCell('from IPython.display import Markdown\n');
        await insertCodeCell('dh = display(display_id=True)\n');
        await insertCodeCell('dh.update(Markdown("foo"))\n');
        const displayCell = vscodeNotebook.activeNotebookEditor?.document.getCells()![1]!;
        const updateCell = vscodeNotebook.activeNotebookEditor?.document.getCells()![2]!;

        await runAllCellsInActiveNotebook();

        // Wait till execution count changes and status is success.
        await waitForExecutionCompletedSuccessfully(updateCell);

        assert.lengthOf(displayCell.outputs, 1, 'Incorrect output');
        expect(displayCell.latestExecutionSummary?.executionOrder).to.be.greaterThan(
            0,
            'Execution count should be > 0'
        );
        assertHasTextOutputInVSCode(displayCell, 'foo', 0, true);
    });
    test('Clearing output while executing will ensure output is cleared', async function () {
        // https://github.com/microsoft/vscode-jupyter/issues/5713
        // The pending cells are always timing out on interrupt, and it might not be up to us
        // We handle it by asking the user to restart the kernel instead
        return this.skip();
        // Assume you are executing a cell that prints numbers 1-100.
        // When printing number 50, you click clear.
        // Cell output should now start printing output from 51 onwards, & not 1.
        await insertCodeCell(
            dedent`
                    print("Start")
                    import time
                    for i in range(100):
                        time.sleep(0.1)
                        print(i)

                    print("End")`,
            { index: 0 }
        );
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;

        await runAllCellsInActiveNotebook();

        // Wait till we get the desired output.
        await waitForCondition(
            async () =>
                assertHasTextOutputInVSCode(cell, 'Start', 0, false) &&
                assertHasTextOutputInVSCode(cell, '0', 0, false) &&
                assertHasTextOutputInVSCode(cell, '1', 0, false) &&
                assertHasTextOutputInVSCode(cell, '2', 0, false) &&
                assertHasTextOutputInVSCode(cell, '3', 0, false) &&
                assertHasTextOutputInVSCode(cell, '4', 0, false),
            15_000,
            'Cell did not get executed'
        );

        // Clear the cells
        await commands.executeCommand('notebook.clearAllCellsOutputs');

        // Wait till previous output gets cleared & we have new output.
        await waitForCondition(
            async () => assertNotHasTextOutputInVSCode(cell, 'Start', 0, false) && cell.outputs.length > 0,
            //  && cell.outputs[0].outputKind === CellOutputKind.Rich,
            5_000,
            'Cell did not get cleared'
        );

        // Interrupt the kernel).
        traceInfo(`Interrupt requested for ${vscodeNotebook.activeNotebookEditor?.document?.uri} in test`);
        await commands.executeCommand(
            'jupyter.notebookeditor.interruptkernel',
            vscodeNotebook.activeNotebookEditor?.document
        );
        await waitForExecutionCompletedWithErrors(cell);

        // Verify that it hasn't got added (even after interrupting).
        assertNotHasTextOutputInVSCode(cell, 'Start', 0, false);
    });
    test('Clearing output via code', async () => {
        // Assume you are executing a cell that prints numbers 1-100.
        // When printing number 50, you click clear.
        // Cell output should now start printing output from 51 onwards, & not 1.
        await insertCodeCell(
            dedent`
                from IPython.display import display, clear_output
                import time
                print('foo')
                display('foo')
                time.sleep(2)
                clear_output(True)
                print('bar')
                display('bar')`,
            { index: 0 }
        );
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;

        await runAllCellsInActiveNotebook();

        // Wait for foo to be printed
        await waitForCondition(
            async () =>
                assertHasTextOutputInVSCode(cell, 'foo', 0, false) &&
                assertHasTextOutputInVSCode(cell, 'foo', 1, false),
            15_000,
            'Incorrect output'
        );

        // Wait for bar to be printed
        await waitForCondition(
            async () =>
                assertHasTextOutputInVSCode(cell, 'bar', 0, false) &&
                assertHasTextOutputInVSCode(cell, 'bar', 1, false),
            15_000,
            'Incorrect output'
        );

        await waitForExecutionCompletedSuccessfully(cell);
    });
    test('Testing streamed output', async () => {
        // Assume you are executing a cell that prints numbers 1-100.
        // When printing number 50, you click clear.
        // Cell output should now start printing output from 51 onwards, & not 1.
        await insertCodeCell(
            dedent`
                    print("Start")
                    import time
                    for i in range(5):
                        time.sleep(0.5)
                        print(i)

                    print("End")`,
            { index: 0 }
        );
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;

        await runAllCellsInActiveNotebook();
        await waitForCondition(
            async () =>
                assertHasTextOutputInVSCode(cell, 'Start', 0, false) &&
                assertHasTextOutputInVSCode(cell, '0', 0, false) &&
                assertHasTextOutputInVSCode(cell, '1', 0, false) &&
                assertHasTextOutputInVSCode(cell, '2', 0, false) &&
                assertHasTextOutputInVSCode(cell, '3', 0, false) &&
                assertHasTextOutputInVSCode(cell, '4', 0, false) &&
                assertHasTextOutputInVSCode(cell, 'End', 0, false),
            15_000,
            'Incorrect output'
        );
        await waitForExecutionCompletedSuccessfully(cell);
    });
    test('Verify escaping of output', async () => {
        await insertCodeCell('1');
        await insertCodeCell(dedent`
                                            a="<a href=f>"
                                            a`);
        await insertCodeCell(dedent`
                                            a="<a href=f>"
                                            print(a)`);
        await insertCodeCell('raise Exception("<whatever>")');
        const cells = vscodeNotebook.activeNotebookEditor?.document.getCells()!;

        await runAllCellsInActiveNotebook();

        // Wait till execution count changes and status is error.
        await waitForExecutionCompletedWithErrors(cells[3]);

        for (const cell of cells) {
            assert.lengthOf(cell.outputs, 1, 'Incorrect output');
        }
        assertHasTextOutputInVSCode(cells[0], '1');
        assertHasTextOutputInVSCode(cells[1], '<a href=f>', 0, false);
        assertHasTextOutputInVSCode(cells[2], '<a href=f>', 0, false);
        assert.isTrue(hasErrorOutput(cells[3].outputs));
        const errorOutput = translateCellErrorOutput(cells[3].outputs[0]);
        assert.equal(errorOutput.ename, 'Exception', 'Incorrect ename'); // As status contains ename, we don't want this displayed again.
        assert.equal(errorOutput.evalue, '<whatever>', 'Incorrect evalue'); // As status contains ename, we don't want this displayed again.
        assert.isNotEmpty(errorOutput.traceback, 'Incorrect traceback');
        assert.include(errorOutput.traceback.join(''), '<whatever>');
    });
    test('Verify display updates', async () => {
        await insertCodeCell('from IPython.display import Markdown', { index: 0 });
        await insertCodeCell('dh = display(Markdown("foo"), display_id=True)', { index: 1 });
        let cells = vscodeNotebook.activeNotebookEditor?.document.getCells()!;

        await runAllCellsInActiveNotebook();
        await waitForExecutionCompletedSuccessfully(cells[1]);

        assert.equal(cells[0].outputs.length, 0, 'Incorrect number of output');
        assert.equal(cells[1].outputs.length, 1, 'Incorrect number of output');

        assertHasTextOutputInVSCode(cells[1], 'foo', 0, true);
        const cellOutputMetadata = cells[1].outputs[0].outputs[0]?.metadata as CellOutputMetadata | undefined;
        assert.ok(cellOutputMetadata?.transient?.display_id, 'Display id not present in metadata');

        await insertCodeCell(
            dedent`
                    dh.update(Markdown("bar"))
                    print('hello')`,
            { index: 2 }
        );
        await runAllCellsInActiveNotebook();
        cells = vscodeNotebook.activeNotebookEditor?.document.getCells()!;
        await waitForExecutionCompletedSuccessfully(cells[2]);

        assert.equal(cells[0].outputs.length, 0, 'Incorrect number of output');
        assert.equal(cells[1].outputs.length, 1, 'Incorrect number of output');
        assert.equal(cells[2].outputs.length, 1, 'Incorrect number of output');
        assertHasTextOutputInVSCode(cells[1], 'bar', 0, true);
        assertHasTextOutputInVSCode(cells[2], 'hello', 0, false);
    });
    test('More messages from background threads', async () => {
        // Details can be found in notebookUpdater.ts & https://github.com/jupyter/jupyter_client/issues/297
        await insertCodeCell(
            dedent`
        import time
        import threading
        from IPython.display import display

        def work():
            for i in range(10):
                print('iteration %d'%i)
                time.sleep(0.1)

        def spawn():
            thread = threading.Thread(target=work)
            thread.start()
            time.sleep(0.3)

        spawn()
        print('main thread done')
        `,
            { index: 0 }
        );
        const cells = vscodeNotebook.activeNotebookEditor?.document.getCells()!;

        await runAllCellsInActiveNotebook();
        await waitForExecutionCompletedSuccessfully(cells[0]);

        // Wait for last line to be `iteration 9`
        assert.equal(cells[0].outputs.length, 1, 'Incorrect number of output');
        // assert.equal(cells[0].outputs[0].outputKind, CellOutputKind.Rich, 'Incorrect output type');
        await waitForCondition(
            async () => {
                const output = cells[0].outputs[0];
                const text = getTextOutputValue(output);
                return text.trim().endsWith('iteration 9');
            },
            10_000,
            'Incorrect output, expected all iterations'
        );

        const textOutput = getTextOutputValue(cells[0].outputs[0]);
        expect(textOutput.indexOf('main thread done')).lessThan(
            textOutput.indexOf('iteration 9'),
            'Main thread should have completed before background thread'
        );
        expect(textOutput.indexOf('main thread done')).greaterThan(
            textOutput.indexOf('iteration 0'),
            'Main thread should have completed after background starts'
        );
    });
    test('Messages from background threads can come in other cell output', async () => {
        // Details can be found in notebookUpdater.ts & https://github.com/jupyter/jupyter_client/issues/297
        // If you have a background thread in cell 1 & then immediately after that you have a cell 2.
        // The background messages (output) from cell one will end up in cell 2.
        await insertCodeCell(
            dedent`
        import time
        import threading
        from IPython.display import display

        def work():
            for i in range(10):
                print('iteration %d'%i)
                time.sleep(0.1)

        def spawn():
            thread = threading.Thread(target=work)
            thread.start()
            time.sleep(0.3)

        spawn()
        print('main thread done')
        `,
            { index: 0 }
        );
        await insertCodeCell('print("HELLO")', { index: 1 });
        const cells = vscodeNotebook.activeNotebookEditor?.document.getCells()!;

        await runAllCellsInActiveNotebook();
        await waitForExecutionCompletedSuccessfully(cells[1]);

        // Wait for last line to be `iteration 9`
        assert.equal(cells[0].outputs.length, 1, 'Incorrect number of output');
        assert.equal(cells[1].outputs.length, 1, 'Incorrect number of output');
        // assert.equal(cells[0].outputs[0].outputKind, CellOutputKind.Rich, 'Incorrect output type');

        // The background messages from cell 1 will end up in cell 2.
        await waitForCondition(
            async () => {
                const output = cells[1].outputs[0];
                const text = getTextOutputValue(output);
                return text.trim().endsWith('iteration 9');
            },
            10_000,
            'Expected background messages to end up in cell 2'
        );
        const cell1Output = getTextOutputValue(cells[0].outputs[0]);
        const cell2Output = getTextOutputValue(cells[1].outputs[0]);
        expect(cell1Output).includes('main thread done', 'Main thread did not complete in cell 1');
        expect(cell2Output).includes('HELLO', 'Print output from cell 2 not in output of cell 2');
        expect(cell2Output).includes('iteration 9', 'Background output from cell 1 not in output of cell 2');
        expect(cell2Output.indexOf('iteration 9')).greaterThan(
            cell2Output.indexOf('HELLO'),
            'output from cell 2 should be printed before last background output from cell 1'
        );
    });
    test('Outputs with support for ansic code `\u001b[A`', async () => {
        // Ansi Code `<esc>[A` means move cursor up, i.e. replace previous line with the new output (or erase previous line & start there).
        await insertCodeCell(
            dedent`
            import sys
            import os
            sys.stdout.write(f"Line1{os.linesep}")
            sys.stdout.flush()
            sys.stdout.write(os.linesep)
            sys.stdout.flush()
            sys.stdout.write(f"Line3{os.linesep}")
            sys.stdout.flush()
            sys.stdout.write("Line4")
            `,
            { index: 0 }
        );
        await insertCodeCell(
            dedent`
            import sys
            import os
            sys.stdout.write(f"Line1{os.linesep}")
            sys.stdout.flush()
            sys.stdout.write(os.linesep)
            sys.stdout.flush()
            sys.stdout.write(u"\u001b[A")
            sys.stdout.flush()
            sys.stdout.write(f"Line3{os.linesep}")
            sys.stdout.flush()
            sys.stdout.write("Line4")
            `,
            { index: 1 }
        );
        const cells = vscodeNotebook.activeNotebookEditor?.document.getCells()!;

        await runAllCellsInActiveNotebook();
        await waitForExecutionCompletedSuccessfully(cells[0]);
        await waitForExecutionCompletedSuccessfully(cells[1]);

        // In cell 1 we should have the output
        // Line1
        //
        // Line2
        // Line3
        // & in cell 2 we should have the output
        // Line1
        // Line2
        // Line3
        assert.equal(cells[0].outputs.length, 1, 'Incorrect number of output');
        // assert.equal(cells[0].outputs[0].outputKind, CellOutputKind.Rich, 'Incorrect output type');
        assert.equal(cells[1].outputs.length, 1, 'Incorrect number of output');
        // assert.equal(cells[1].outputs[0].outputKind, CellOutputKind.Rich, 'Incorrect output type');

        // Confirm the output
        const output1Lines: string[] = getTextOutputValue(cells[0].outputs[0]).splitLines({
            trim: false,
            removeEmptyEntries: false
        });
        const output2Lines: string[] = getTextOutputValue(cells[1].outputs[0]).splitLines({
            trim: false,
            removeEmptyEntries: false
        });
        assert.equal(output1Lines.length, 4);
        assert.equal(output2Lines.length, 3);
    });
    test('Stderr & stdout outputs should go into separate outputs', async () => {
        await insertCodeCell(
            dedent`
            import sys
            sys.stdout.write("1")
            sys.stdout.flush()
            sys.stdout.write("2")
            sys.stdout.flush()
            sys.stderr.write("a")
            sys.stderr.flush()
            sys.stderr.write("b")
            sys.stderr.flush()
            sys.stdout.write("3")
            sys.stdout.flush()
            sys.stderr.write("c")
            sys.stderr.flush()
                        `,
            { index: 0 }
        );
        if (!vscodeNotebook.activeNotebookEditor) {
            throw new Error('No active document');
        }
        process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT = 'true';
        const cells = vscodeNotebook.activeNotebookEditor!.document.getCells();
        traceInfo('1. Start execution for test of Stderr & stdout outputs');
        await runAllCellsInActiveNotebook();
        traceInfo('2. Start execution for test of Stderr & stdout outputs');
        await waitForExecutionCompletedSuccessfully(cells[0]);
        traceInfo('2. completed execution for test of Stderr & stdout outputs');

        // In cell 1 we should have the output
        // 12
        // ab
        // 3
        // c
        assert.equal(cells[0].outputs.length, 4, 'Incorrect number of output');
        // All output items should be of type stream
        const expectedOutput = [
            {
                metadata: {
                    outputType: 'stream'
                },
                text: '12'
            },
            {
                metadata: {
                    outputType: 'stream'
                },
                text: 'ab'
            },
            {
                metadata: {
                    outputType: 'stream'
                },
                text: '3'
            },
            {
                metadata: {
                    outputType: 'stream'
                },
                text: 'c'
            }
        ];
        for (let index = 0; index < 4; index++) {
            const expected = expectedOutput[index];
            const output = cells[0].outputs[index];
            assert.deepEqual(output.metadata, expected.metadata, `Metadata is incorrect for cell ${index}`);
            assert.deepEqual(getTextOutputValue(output), expected.text, `Text is incorrect for cell ${index}`);
        }
    });

    test('Execute all cells and run after error', async () => {
        await insertCodeCell('raise Error("fail")', { index: 0 });
        await insertCodeCell('print("after fail")', { index: 1 });

        process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT = 'true';
        const cells = vscodeNotebook.activeNotebookEditor!.document.getCells();
        await runAllCellsInActiveNotebook();

        await waitForExecutionCompletedWithErrors(cells[0]);

        // Second cell output should be empty
        assert.equal(cells[1].outputs.length, 0, 'Second cell is not empty on run all');

        const cell = vscodeNotebook.activeNotebookEditor?.document.getCells()![1]!;
        await runCell(cell);

        // Wait till execution count changes and status is success.
        await waitForExecutionCompletedSuccessfully(cell);

        assert.equal(cell.outputs.length, 1, 'Second cell is empty after running individually');
    });
    test('Run whole document and test status of cells', async () => {
        const cells = await insertRandomCells({ count: 4, addMarkdownCells: false });

        await runAllCellsInActiveNotebook();
        const [cell1, cell2, cell3, cell4] = cells;
        // Cell 1 should have started, cells 2 & 3 should be queued.
        await Promise.all([
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
        await Promise.all(queuedCells.map((item) => item.cell).map((cell) => waitForQueuedForExecution(cell)));

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
        await runAllCellsInActiveNotebook();

        // Verify all have been queued.
        await Promise.all(cells.map((item) => item.cell).map((cell) => waitForQueuedForExecution(cell)));

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
                await runCell(cell);
                await waitForQueuedForExecution(cell);
            }
        }

        // let all cells run to completion & validate their execution orders match the order of the queue.
        codeCells.forEach((item) => item.runToCompletion());
        await Promise.all(queuedCells.map((cell) => waitForExecutionCompletedSuccessfully(cell)));
        assertExecutionOrderOfCells(queuedCells);
    });
    test('Run entire notebook then add a new cell, ensure new cell is not executed', async () => {
        const cells = await insertRandomCells({ count: 15, addMarkdownCells: true });

        await runAllCellsInActiveNotebook();
        const queuedCells = cells.filter((item) => item.cell.kind === NotebookCellKind.Code).map((item) => item.cell);
        await Promise.all(queuedCells.map((cell) => waitForQueuedForExecution(cell)));

        // Add a new cell to the document, this should not get executed.
        const [newCell] = await insertRandomCells({ count: 1, addMarkdownCells: false });

        // let all cells run to completion & validate their execution orders match the order of the queue.
        // Also, the new cell should not have been executed.
        cells.forEach((item) => item.runToCompletion());
        await Promise.all(queuedCells.map((cell) => waitForExecutionCompletedSuccessfully(cell)));
        assertExecutionOrderOfCells(queuedCells);

        // This is a brand new cell created by the user, all metadata will be undefined.
        assert.isUndefined(newCell.cell.latestExecutionSummary?.executionOrder);
        assert.equal(newCell.cell.outputs.length, 0);
    });
    test('Run entire notebook then add a new cell & run that as well, ensure this new cell is also executed', async () => {
        const cells = await insertRandomCells({ count: 15, addMarkdownCells: true });
        const codeCells = cells.filter((cell) => cell.cell.kind === NotebookCellKind.Code);

        // Run entire notebook & verify all cells are queued for execution.
        await runAllCellsInActiveNotebook();
        const queuedCells = codeCells.map((item) => item.cell);
        await Promise.all(queuedCells.map((cell) => waitForQueuedForExecution(cell)));

        // Insert new cell & run it, & verify that too is queued for execution.
        const [newCell] = await insertRandomCells({ count: 1, addMarkdownCells: false });
        queuedCells.push(newCell.cell);
        await runCell(newCell.cell);
        await Promise.all(queuedCells.map((cell) => waitForQueuedForExecution(cell)));

        // let all cells run to completion & validate their execution orders match the order in which they were run.
        // Also, the new cell should not have been executed.
        cells.forEach((item) => item.runToCompletion());
        newCell.runToCompletion();
        await Promise.all(queuedCells.map((cell) => waitForExecutionCompletedSuccessfully(cell)));
        assertExecutionOrderOfCells(queuedCells);
    });
    test('Cell failures should not get cached', async () => {
        // Run 3 cells
        // cell 1 is ok
        // cell 2 has errors
        // cell 3 is ok
        // Running all should fail on cell 2 & 3 not run.
        // Running 1 & then 2, 2 should fail.
        // Running 2 & then 3, 2 should fail & 3 should run.
        // Running 2, it should fail, then running 2 again should fail once again.

        const cell1 = await insertCodeCell('1', { index: 0 });
        const cell2 = await insertCodeCell('KABOOM', { index: 1 });
        const cell3 = await insertCodeCell('2', { index: 2 });

        await runAllCellsInActiveNotebook();

        await waitForExecutionCompletedSuccessfully(cell1);
        await waitForExecutionCompletedWithErrors(cell2);
        assertExecutionOrderOfCells([cell1, cell2]);
        assertVSCCellIsNotRunning(cell3);

        // Run cell 2 again, & it should fail again & execution count should increase.
        await runCell(cell2);
        // Give it time to run & fail, this time execution order is greater than previously
        await waitForCondition(
            async () => cell2.latestExecutionSummary?.executionOrder === 3,
            5_000,
            'Cell did not fail again with a new execution order'
        );
        await waitForExecutionCompletedWithErrors(cell2);

        // Run cell 3 & it should run to completion.
        await runCell(cell3);
        await waitForExecutionCompletedSuccessfully(cell3);
        const lastExecutionOrderOfCell3 = cell3.latestExecutionSummary?.executionOrder!;
        assert.equal(lastExecutionOrderOfCell3, 4);

        // Run all cells again
        await runAllCellsInActiveNotebook();
        await waitForCondition(
            async () => cell2.latestExecutionSummary?.executionOrder === 6,
            5_000,
            'Cell did not fail again with a new execution order (3rd time)'
        );
        await waitForExecutionCompletedSuccessfully(cell1);
        await waitForExecutionCompletedWithErrors(cell2);
        assert.equal(cell1.latestExecutionSummary?.executionOrder, 5);
        assert.equal(cell2.latestExecutionSummary?.executionOrder, 6);
        assert.isUndefined(
            cell3.latestExecutionSummary?.executionOrder,
            'Cell 3 should not have run again, but execution cleared like Jupyter'
        );
    });

    // Check the set next input statements correctly insert or update cells
    test('Test set_next_input message payload', async () => {
        await insertCodeCell(
            dedent`
            import IPython
            IPython.get_ipython().set_next_input("print('INSERT')")`,
            { index: 0 }
        );
        await insertCodeCell(
            dedent`
            import IPython
            IPython.get_ipython().set_next_input("print('REPLACE')", replace=True)`,
            { index: 1 }
        );
        const cells = vscodeNotebook.activeNotebookEditor?.document.getCells()!;

        await runAllCellsInActiveNotebook();

        // Wait till execution count changes and status is success.
        await waitForExecutionCompletedSuccessfully(cells[0]);
        await waitForExecutionCompletedSuccessfully(cells[1]);

        const cellsPostExecute = vscodeNotebook.activeNotebookEditor?.document.getCells()!;

        // Check our output, one cell should have been inserted, and one been replaced
        expect(cellsPostExecute.length).to.equal(3);
        expect(cellsPostExecute[0].document.getText()).to.equal(
            dedent`
            import IPython
            IPython.get_ipython().set_next_input("print('INSERT')")`
        );
        expect(cellsPostExecute[1].document.getText()).to.equal("print('INSERT')");
        expect(cellsPostExecute[2].document.getText()).to.equal("print('REPLACE')");
    });

    /**
     * Verify the fact that cells provided were executed in the order they appear in the list.
     * (the execution order of each subsequent cell in the list is expected to have an execution order greater than the previous cell).
     */
    function assertExecutionOrderOfCells(cells: readonly NotebookCell[]) {
        let firstCellExecutionOrder: number;
        cells.forEach((cell, index) => {
            if (index === 0) {
                firstCellExecutionOrder = cell.latestExecutionSummary?.executionOrder!;
                return;
            }
            // This next cell must have an execution order +1 from previous cell in the queue.
            assert.equal(
                cell.latestExecutionSummary?.executionOrder,
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
        const startIndex = vscodeNotebook.activeNotebookEditor!.document.cellCount;
        const endIndex = startIndex + numberOfCellsToAdd;
        // Insert the necessary amount of cells
        for (let index = startIndex; index < endIndex; index++) {
            // Once this file is deleted the cell will run to completion.
            const tmpFile = await createTemporaryNotebook(templateNbPath, disposables);
            let cell: NotebookCell;
            if (!options?.addMarkdownCells || Math.floor(Math.random() * 2) === 0) {
                cell = await insertCodeCell(
                    dedent`
                        print("Start Cell ${index}")
                        import time
                        import os.path
                        from os import path
                        while os.path.exists('${tmpFile}'):
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
