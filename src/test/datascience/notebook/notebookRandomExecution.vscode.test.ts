// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

// tslint:disable:no-require-imports no-var-requires
import { assert, expect } from 'chai';
import * as dedent from 'dedent';
import * as sinon from 'sinon';
import { CellDisplayOutput, CellOutput, commands, NotebookCell } from 'vscode';
import { CellErrorOutput } from '../../../../typings/vscode-proposed';
import { IVSCodeNotebook } from '../../../client/common/application/types';
import { traceInfo } from '../../../client/common/logger';
import { IConfigurationService, IDisposable, IJupyterSettings, ReadWrite } from '../../../client/common/types';
import { IKernelProvider } from '../../../client/datascience/jupyter/kernels/types';
import { INotebookEditorProvider } from '../../../client/datascience/types';
import { createEventHandler, IExtensionTestApi, sleep, waitForCondition } from '../../common';
import { noop } from '../../core';
import { initialize } from '../../initialize';
import {
    assertHasTextOutputInVSCode,
    assertNotHasTextOutputInVSCode,
    assertVSCCellIsRunning,
    canRunNotebookTests,
    closeNotebooks,
    closeNotebooksAndCleanUpAfterTests,
    deleteAllCellsAndWait,
    executeActiveDocument,
    executeCell,
    insertCodeCell,
    startJupyter,
    trustAllNotebooks,
    waitForExecutionCompletedSuccessfully,
    waitForExecutionCompletedWithErrors,
    waitForKernelToGetAutoSelected,
    waitForTextOutputInVSCode
} from './helper';

// tslint:disable-next-line: no-var-requires no-require-imports
const vscodeNotebookEnums = require('vscode') as typeof import('vscode-proposed');

// tslint:disable: no-any no-invalid-this
suite('DataScience - VSCode Notebook - (Random Execution) (slow)', () => {
    let api: IExtensionTestApi;
    let editorProvider: INotebookEditorProvider;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
    let kernelProvider: IKernelProvider;
    let dsSettings: ReadWrite<IJupyterSettings>;
    let oldAskForRestart: boolean | undefined;
    suiteSetup(async function () {
        this.timeout(120_000);
        api = await initialize();
        if (!(await canRunNotebookTests())) {
            return this.skip();
        }
        await trustAllNotebooks();
        await startJupyter(true);
        sinon.restore();
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        editorProvider = api.serviceContainer.get<INotebookEditorProvider>(INotebookEditorProvider);
        kernelProvider = api.serviceContainer.get<IKernelProvider>(IKernelProvider);
    });
    // Use same notebook without starting kernel in every single test (use one for whole suite).
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        sinon.restore();
        // Open a notebook and use this for all tests in this test suite.
        await editorProvider.createNew();
        await waitForKernelToGetAutoSelected();
        await deleteAllCellsAndWait();
        assert.isOk(vscodeNotebook.activeNotebookEditor, 'No active notebook');
        dsSettings = api.serviceContainer
            .get<IConfigurationService>(IConfigurationService)
            .getSettings(vscodeNotebook.activeNotebookEditor?.document.uri);
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
        oldAskForRestart = dsSettings.askForKernelRestart;
        dsSettings.askForKernelRestart = false;
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        if (dsSettings) {
            dsSettings.askForKernelRestart = oldAskForRestart === true;
        }
        // Added temporarily to identify why tests are failing.
        process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT = undefined;
        await closeNotebooks(disposables);
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));

    function getRandomCell() {
        const cells = [
            {
                title: 'Print Hello World',
                code: 'print("Hello World")',
                assert: async (cell: NotebookCell) => {
                    await waitForExecutionCompletedSuccessfully(cell);
                    assertHasTextOutputInVSCode(cell, 'Hello World', 0, false);
                }
            },
            {
                title: 'Print 1234',
                code: 'print(1234)',
                assert: async (cell: NotebookCell) => {
                    await waitForExecutionCompletedSuccessfully(cell);
                    assertHasTextOutputInVSCode(cell, '1234', 0, false);
                }
            },
            {
                title: 'Sleep for 2s and print',
                streamsOutput: true,
                code: dedent`
                            import time
                            time.sleep(2.0)
                            print("Slept for 1s")
                            `,
                assert: async (cell: NotebookCell) => {
                    await sleep(2_000);
                    await waitForExecutionCompletedSuccessfully(cell);
                    assertHasTextOutputInVSCode(cell, 'Slept', 0, false);
                }
            },
            {
                title: 'Write to stdout',
                code: dedent`
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
                assert: async (cell: NotebookCell) => {
                    await waitForExecutionCompletedSuccessfully(cell);
                    // In cell 1 we should have the output
                    // Line1
                    //
                    // Line3
                    // Line4
                    assert.equal(cell.outputs.length, 1, 'Incorrect number of output');
                    assert.equal(
                        cell.outputs[0].outputKind,
                        vscodeNotebookEnums.CellOutputKind.Rich,
                        'Incorrect output type'
                    );

                    // Confirm the output
                    const outputLines: string[] = ((cell.outputs[0] as CellDisplayOutput).data[
                        'text/plain'
                    ] as string).splitLines({ trim: false, removeEmptyEntries: false });
                    assert.equal(outputLines.length, 4);
                }
            },
            {
                title: 'Throw errors',
                code: 'print(garbage)',
                assert: async (cell: NotebookCell) => {
                    await waitForExecutionCompletedWithErrors(cell);
                    assert.lengthOf(cell.outputs, 1, 'Incorrect output');
                    const errorOutput = cell.outputs[0] as CellErrorOutput;
                    assert.equal(errorOutput.outputKind, vscodeNotebookEnums.CellOutputKind.Error, 'Incorrect output');
                    assert.equal(errorOutput.ename, 'NameError', 'Incorrect ename'); // As status contains ename, we don't want this displayed again.
                    assert.equal(errorOutput.evalue, "name 'abcd' is not defined", 'Incorrect evalue'); // As status contains ename, we don't want this displayed again.
                    assert.isNotEmpty(errorOutput.traceback, 'Incorrect traceback');
                    expect(cell.metadata.executionOrder).to.be.greaterThan(0, 'Execution count should be > 0');
                    expect(cell.metadata.runStartTime).to.be.greaterThan(0, 'Start time should be > 0');
                    assert.equal(
                        cell.metadata.runState,
                        vscodeNotebookEnums.NotebookCellRunState.Error,
                        'Incorrect State'
                    );
                    assert.include(cell.metadata.statusMessage!, 'NameError', 'Must contain error message');
                    assert.include(cell.metadata.statusMessage!, 'abcd', 'Must contain error message');
                }
            },
            {
                title: 'Write to stdout and stderr',
                code: dedent`
                            import sys
                            sys.stdout.write("1")
                            sys.stdout.flush()
                            sys.stderr.write("a")
                            sys.stderr.flush()
                            sys.stdout.write("2")
                            sys.stdout.flush()
                            sys.stderr.write("b")
                            sys.stderr.flush()
                                    `,
                assert: async (cell: NotebookCell) => {
                    await waitForExecutionCompletedSuccessfully(cell);
                    assert.equal(cell.outputs.length, 2, 'Incorrect number of output');
                    const output1 = cell.outputs[0] as CellDisplayOutput;
                    const output2 = cell.outputs[1] as CellDisplayOutput;
                    assert.equal(output1.metadata?.custom?.vscode?.outputType, 'stream', 'Incorrect output type');
                    assert.equal(output2.metadata?.custom?.vscode?.outputType, 'stream', 'Incorrect output type');
                    assert.equal(output1.metadata?.custom?.vscode?.name, 'stdout', 'Incorrect stream name');
                    assert.equal(output2.metadata?.custom?.vscode?.name, 'stderr', 'Incorrect stream name');
                    assert.equal(output1.outputKind, vscodeNotebookEnums.CellOutputKind.Rich, 'Incorrect output type');
                    assert.equal(output2.outputKind, vscodeNotebookEnums.CellOutputKind.Rich, 'Incorrect output type');

                    // Confirm the output
                    assert.equal(output1.data['text/plain'], '12');
                    assert.equal(output2.data['text/plain'], 'ab');
                }
            },
            {
                title: 'Print from background thread',
                streamsOutput: true,
                code: dedent`
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
                assert: async (cell: NotebookCell) => {
                    await waitForExecutionCompletedSuccessfully(cell);
                    // Wait for last line to be `iteration 9`
                    assert.equal(cell.outputs.length, 1, 'Incorrect number of output');
                    assert.equal(
                        cell.outputs[0].outputKind,
                        vscodeNotebookEnums.CellOutputKind.Rich,
                        'Incorrect output type'
                    );
                    await waitForCondition(
                        async () => {
                            const output = cell.outputs[0] as CellDisplayOutput;
                            const text = output.data['text/plain'] as string;
                            return text.trim().endsWith('iteration 9');
                        },
                        10_000,
                        'Incorrect output, expected all iterations'
                    );
                    const textOutput = (cell.outputs[0] as CellDisplayOutput).data['text/plain'] as string;
                    expect(textOutput.indexOf('main thread done')).lessThan(
                        textOutput.indexOf('iteration 9'),
                        'Main thread should have completed before background thread'
                    );
                    expect(textOutput.indexOf('main thread done')).greaterThan(
                        textOutput.indexOf('iteration 0'),
                        'Main thread should have completed after background starts'
                    );
                }
            },
            {
                title: 'Print and sleep for interruption',
                code: dedent`
                            print("Started cell for interrupt")
                            import time
                            time.sleep(30)
                            `,
                assert: async (cell: NotebookCell) => {
                    await waitForCondition(
                        async () => kernelProvider.get(cell.notebook.uri) !== undefined,
                        5_000,
                        'No kernel'
                    );
                    await waitForCondition(async () => assertVSCCellIsRunning(cell), 15_000, 'Cell not being executed');
                    await waitForTextOutputInVSCode(cell, 'Started cell for interrupt', 0, false, 15_000); // Wait for 15 seconds for it to start (possibly

                    // Interrupt the kernel.
                    kernelProvider.get(cell.notebook.uri)!.interrupt().catch(noop);

                    // Execution should have stopped.
                    await waitForExecutionCompletedWithErrors(cell);
                }
            },
            {
                title: 'Test clearing when streaming output',
                code: dedent`
                            print("Start")
                            import time
                            for i in range(100):
                                time.sleep(0.1)
                                print(i)

                            print("End")
                            `,
                assert: async (cell: NotebookCell) => {
                    await waitForCondition(
                        async () => kernelProvider.get(cell.notebook.uri) !== undefined,
                        5_000,
                        'No kernel'
                    );
                    await waitForCondition(async () => assertVSCCellIsRunning(cell), 15_000, 'Cell not being executed');
                    await waitForTextOutputInVSCode(cell, 'Start', 0, false, 15_000); // Wait for 15 seconds for it to start (possibly

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
                        async () =>
                            assertNotHasTextOutputInVSCode(cell, 'Start', 0, false) &&
                            cell.outputs.length > 0 &&
                            cell.outputs[0].outputKind === vscodeNotebookEnums.CellOutputKind.Rich,
                        5_000,
                        'Cell did not get cleared'
                    );

                    // Interrupt the kernel).
                    await commands.executeCommand('notebook.cancelExecution');
                    await waitForExecutionCompletedWithErrors(cell);

                    // Verify that it hasn't got added (even after interrupting).
                    assertNotHasTextOutputInVSCode(cell, 'Start', 0, false);
                }
            }
        ];
        return cells;
    }

    test('Execute cell using VSCode Kernel', async () => {
        await insertCodeCell('print("123412341234")', { index: 0 });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cells![0]!;

        await executeCell(cell);

        // Wait till execution count changes and status is success.
        await waitForExecutionCompletedSuccessfully(cell);
    });
});
