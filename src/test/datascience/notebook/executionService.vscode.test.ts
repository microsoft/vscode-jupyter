// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert, expect } from 'chai';
import * as fs from 'fs';
import * as path from '../../../platform/vscode-path/path';
import dedent from 'dedent';
import * as sinon from 'sinon';
import {
    commands,
    NotebookCell,
    NotebookCellExecutionState,
    NotebookCellKind,
    NotebookCellOutput,
    Uri,
    window,
    workspace
} from 'vscode';
import { Common } from '../../../platform/common/utils/localize';
import { IVSCodeNotebook } from '../../../platform/common/application/types';
import { traceInfo } from '../../../platform/logging';
import { IDisposable } from '../../../platform/common/types';
import { captureScreenShot, IExtensionTestApi, waitForCondition } from '../../common.node';
import { EXTENSION_ROOT_DIR_FOR_TESTS, initialize } from '../../initialize.node';
import {
    closeNotebooksAndCleanUpAfterTests,
    runAllCellsInActiveNotebook,
    runCell,
    insertCodeCell,
    startJupyterServer,
    waitForExecutionCompletedSuccessfully,
    waitForExecutionCompletedWithErrors,
    waitForKernelToGetAutoSelected,
    prewarmNotebooks,
    hijackPrompt,
    closeNotebooks,
    waitForExecutionInProgress,
    waitForQueuedForExecution,
    insertMarkdownCell,
    assertVSCCellIsNotRunning,
    createEmptyPythonNotebook,
    assertNotHasTextOutputInVSCode,
    waitForQueuedForExecutionOrExecuting,
    waitForTextOutput,
    defaultNotebookTestTimeout,
    waitForCellExecutionState,
    getCellOutputs,
    waitForCellHavingOutput,
    waitForCellExecutionToComplete,
    createTemporaryNotebookFromFile
} from './helper.node';
import { openNotebook } from '../helpers.node';
import { isWeb, noop, swallowExceptions } from '../../../platform/common/utils/misc';
import { getDisplayPath } from '../../../platform/common/platform/fs-paths';
import { ProductNames } from '../../../kernels/installer/productNames';
import { Product } from '../../../kernels/installer/types';
import { IPYTHON_VERSION_CODE, IS_REMOTE_NATIVE_TEST } from '../../constants.node';
import { areInterpreterPathsSame } from '../../../platform/pythonEnvironments/info/interpreter';
import { getOSType, OSType } from '../../../platform/common/utils/platform';
import {
    getTextOutputValue,
    translateCellErrorOutput,
    hasErrorOutput,
    getTextOutputValues
} from '../../../kernels/execution/helpers';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { ErrorRendererCommunicationHandler } from '../../../notebooks/outputs/errorRendererComms';
import { InteractiveWindowMessages } from '../../../messageTypes';

// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const expectedPromptMessageSuffix = `requires ${ProductNames.get(Product.ipykernel)!} to be installed.`;

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataScience - VSCode Notebook - (Execution) (slow)', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
    const templateNbPath = Uri.file(
        path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'test', 'datascience', 'notebook', 'emptyCellWithOutput.ipynb')
    );
    const envFile = Uri.joinPath(Uri.file(EXTENSION_ROOT_DIR_FOR_TESTS), 'src', 'test', 'datascience', '.env');
    this.timeout(120_000);
    suiteSetup(async function () {
        traceInfo('Suite Setup VS Code Notebook - Execution');
        this.timeout(120_000);
        try {
            api = await initialize();
            await hijackPrompt(
                'showErrorMessage',
                { endsWith: expectedPromptMessageSuffix },
                { result: Common.install(), clickImmediately: true },
                disposables
            );
            if (!IS_REMOTE_NATIVE_TEST() && !isWeb()) {
                await workspace
                    .getConfiguration('python', workspace.workspaceFolders![0].uri)
                    .update('envFile', '${workspaceFolder}/.env');
            }
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
            // With less realestate, the outputs might not get rendered (VS Code optimization to avoid rendering if not in viewport).
            await commands.executeCommand('workbench.action.closePanel');
            traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
        } catch (e) {
            await captureScreenShot(this);
            throw e;
        }
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this);
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
    test('Test __vsc_ipynb_file__ defined in cell using VSCode Kernel', async () => {
        const uri = vscodeNotebook.activeNotebookEditor?.notebook.uri;
        if (uri && uri.scheme === 'file') {
            await insertCodeCell('print(__vsc_ipynb_file__)', { index: 0 });
            const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;
            await Promise.all([runCell(cell), waitForTextOutput(cell, `${uri.fsPath}`)]);
        }
    });
    test('Test exceptions have hrefs', async () => {
        const uri = vscodeNotebook.activeNotebookEditor?.notebook.uri;
        if (uri && uri.scheme === 'file') {
            let ipythonVersionCell = await insertCodeCell(IPYTHON_VERSION_CODE, { index: 0 });
            await runCell(ipythonVersionCell);
            await waitForExecutionCompletedSuccessfully(ipythonVersionCell);
            const ipythonVersion = parseInt(getTextOutputValue(ipythonVersionCell!.outputs[0]));

            const codeCell = await insertCodeCell('raise Exception("FOO")', { index: 0 });
            await runCell(codeCell);
            await waitForExecutionCompletedWithErrors(codeCell);

            // Parse the last cell's error output
            const errorOutput = translateCellErrorOutput(codeCell.outputs[0]);
            assert.ok(errorOutput, 'No error output found');

            // Convert to html for easier parsing
            const ansiToHtml = require('ansi-to-html') as typeof import('ansi-to-html');
            const converter = new ansiToHtml();
            const html = converter.toHtml(errorOutput.traceback.join('\n'));

            // Should be more than 3 hrefs if ipython 8
            if (ipythonVersion >= 8) {
                const hrefs = /<a\s+href='(.*\?line=\d+)'/gm.exec(html);
                assert.ok(hrefs, 'Hrefs not found in traceback');
                const errorComm = api.serviceContainer
                    .getAll<ErrorRendererCommunicationHandler>(IExtensionSyncActivationService)
                    .find((s) => s.onDidReceiveMessage);
                assert.ok(errorComm, 'Error comm handler not found');
                const editor = vscodeNotebook.activeNotebookEditor;
                const href = hrefs![1].toString();

                // Act like the user clicked the link
                await errorComm?.onDidReceiveMessage({
                    editor: editor!,
                    message: { message: InteractiveWindowMessages.OpenLink, payload: href }
                });

                // This should eventually give focus to the code cell
                await waitForCondition(
                    async () => {
                        return window.activeTextEditor?.document === codeCell.document;
                    },
                    defaultNotebookTestTimeout,
                    `HREF click did not move into the cell`
                );
            }
        }
    });
    test('Leading whitespace not suppressed', async () => {
        await insertCodeCell('print("\tho")\nprint("\tho")\nprint("\tho")\n', { index: 0 });
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;

        await Promise.all([runCell(cell), waitForTextOutput(cell, '\tho\n\tho\n\tho\n', 0, true)]);
    });
    test('Verify loading of env variables form .env file', async function () {
        if (IS_REMOTE_NATIVE_TEST()) {
            return this.skip();
        }
        await fs.writeFileSync(
            envFile.fsPath,
            dedent`
        ENV_VAR_TESTING_CI=HelloWorldEnvVariable
        PYTHONPATH=./dummyFolderForPythonPath
        `
        );

        const cell = await insertCodeCell(
            dedent`
                    import sys
                    import os
                    print(sys.path)
                    print(os.getenv("ENV_VAR_TESTING_CI"))`,
            {
                index: 0
            }
        );

        await Promise.all([
            runCell(cell),
            waitForTextOutput(cell, 'HelloWorldEnvVariable', 0, false),
            waitForTextOutput(cell, 'dummyFolderForPythonPath', 0, false)
        ]);
    });
    test('Empty cells will not have an execution order nor have a status of success', async () => {
        await insertCodeCell('');
        await insertCodeCell('print("Hello World")');
        const cells = vscodeNotebook.activeNotebookEditor?.notebook.getCells()!;

        await Promise.all([runAllCellsInActiveNotebook(), waitForTextOutput(cells[1], 'Hello World')]);

        assert.isUndefined(cells[0].executionSummary?.executionOrder);
    });
    test('Clear output in empty cells', async function () {
        await closeNotebooks();
        const nbUri = await createTemporaryNotebookFromFile(templateNbPath, disposables);
        await openNotebook(nbUri);
        await waitForKernelToGetAutoSelected();

        // Confirm we have execution order and output.
        const cells = vscodeNotebook.activeNotebookEditor?.notebook.getCells()!;
        assert.equal(cells[0].executionSummary?.executionOrder, 1);
        await waitForTextOutput(cells[0], 'Hello World');

        await Promise.all([
            runAllCellsInActiveNotebook(),
            waitForCellExecutionState(cells[0], NotebookCellExecutionState.Pending, disposables),
            waitForCellExecutionState(cells[0], NotebookCellExecutionState.Executing, disposables),
            waitForCellExecutionState(cells[0], NotebookCellExecutionState.Idle, disposables),
            waitForCondition(
                async () => cells[0].outputs.length === 0,
                defaultNotebookTestTimeout,
                'Cell output is not empty'
            ),
            waitForCondition(
                async () => cells[0].executionSummary?.executionOrder === undefined,
                defaultNotebookTestTimeout,
                'Cell execution order should be undefined'
            )
        ]);
    });
    test('Verify Cell output, execution count and status', async () => {
        await insertCodeCell('print("Hello World")');
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;

        await Promise.all([runAllCellsInActiveNotebook(), waitForTextOutput(cell, 'Hello World', 0, false)]);

        // Verify execution count.
        assert.ok(cell.executionSummary?.executionOrder, 'Execution count should be > 0');
    });
    test('Verify multiple cells get executed', async () => {
        await insertCodeCell('print("Foo Bar")');
        await insertCodeCell('print("Hello World")');
        const cells = vscodeNotebook.activeNotebookEditor?.notebook.getCells()!;

        await Promise.all([
            runAllCellsInActiveNotebook(),
            // Verify output.
            waitForTextOutput(cells[0], 'Foo Bar', 0, false),
            waitForTextOutput(cells[1], 'Hello World', 0, false)
        ]);

        // Verify execution count.
        assert.ok(cells[0].executionSummary?.executionOrder, 'Execution count should be > 0');
        assert.equal(cells[1].executionSummary?.executionOrder! - 1, cells[0].executionSummary?.executionOrder!);
    });
    test('Verify metadata for successfully executed cell', async () => {
        await insertCodeCell('print("Foo Bar")');
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;

        await Promise.all([
            runAllCellsInActiveNotebook(),
            waitForCondition(
                async () => (cell.executionSummary?.executionOrder || 0) > 0,
                defaultNotebookTestTimeout,
                'Execution count should be > 0'
            )
        ]);
    });
    test('Verify output & metadata for executed cell with errors', async () => {
        await insertCodeCell('print(abcd)');
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;

        await Promise.all([
            runAllCellsInActiveNotebook(),
            waitForCondition(async () => hasErrorOutput(cell.outputs), 30_000, 'No errors'),
            waitForCondition(
                async () => (cell.executionSummary?.executionOrder || 0) > 0,
                defaultNotebookTestTimeout,
                'Execution count should be > 0'
            )
        ]);

        const errorOutput = translateCellErrorOutput(cell.outputs[0]);
        assert.equal(errorOutput.ename, 'NameError', 'Incorrect ename'); // As status contains ename, we don't want this displayed again.
        assert.equal(errorOutput.evalue, "name 'abcd' is not defined", 'Incorrect evalue'); // As status contains ename, we don't want this displayed again.
        assert.isNotEmpty(errorOutput.traceback, 'Incorrect traceback');
    });
    test('Updating display data', async function () {
        await insertCodeCell('from IPython.display import Markdown\n');
        await insertCodeCell('dh = display(display_id=True)\n');
        await insertCodeCell('dh.update(Markdown("foo"))\n');
        const displayCell = vscodeNotebook.activeNotebookEditor?.notebook.getCells()![1]!;
        const updateCell = vscodeNotebook.activeNotebookEditor?.notebook.getCells()![2]!;

        await runAllCellsInActiveNotebook();

        // Wait till execution count changes and status is success.
        await waitForExecutionCompletedSuccessfully(updateCell);

        assert.lengthOf(displayCell.outputs, 1, 'Incorrect output');
        expect(displayCell.executionSummary?.executionOrder).to.be.greaterThan(0, 'Execution count should be > 0');
        await waitForTextOutput(displayCell, 'foo', 0, false);
    });
    test('Clearing output while executing will ensure output is cleared', async function () {
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
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;
        runAllCellsInActiveNotebook().catch(noop);

        await Promise.all([
            waitForTextOutput(cell, 'Start', 0, false),
            waitForTextOutput(cell, '0', 0, false),
            waitForTextOutput(cell, '1', 0, false),
            waitForTextOutput(cell, '2', 0, false),
            waitForTextOutput(cell, '3', 0, false),
            waitForTextOutput(cell, '4', 0, false)
        ]);

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
        traceInfo(
            `Interrupt requested for ${getDisplayPath(vscodeNotebook.activeNotebookEditor?.notebook?.uri)} in test`
        );
        await commands.executeCommand(
            'jupyter.notebookeditor.interruptkernel',
            vscodeNotebook.activeNotebookEditor?.notebook.uri
        );
        await waitForExecutionCompletedWithErrors(cell);
        // Verify that it hasn't got added (even after interrupting).
        assertNotHasTextOutputInVSCode(cell, 'Start', 0, false);
    });
    test('Clearing output via code', async function () {
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
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;

        await runAllCellsInActiveNotebook();

        // Wait for foo to be printed
        await Promise.all([waitForTextOutput(cell, 'foo', 0, false), waitForTextOutput(cell, 'foo', 1, false)]);

        // Wait for bar to be printed
        await Promise.all([waitForTextOutput(cell, 'bar', 0, false), waitForTextOutput(cell, 'bar', 1, false)]);

        await waitForExecutionCompletedSuccessfully(cell);
    });
    test('Clearing output immediately via code', async function () {
        // Assume you are executing a cell that prints numbers 1-100.
        // When printing number 50, you click clear.
        // Cell output should now start printing output from 51 onwards, & not 1.
        await insertCodeCell(
            dedent`
            from ipywidgets import widgets
            from IPython.display import display, clear_output
            import time

            display(widgets.Button(description="First Button"))

            time.sleep(2)
            clear_output()

            display(widgets.Button(description="Second Button"))`,
            { index: 0 }
        );
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;

        await runAllCellsInActiveNotebook();

        await Promise.all([
            waitForExecutionCompletedSuccessfully(cell),
            waitForTextOutput(cell, 'Second Button', 0, false)
        ]);
    });
    test('Clearing output via code only when receiving new output', async function () {
        // Assume you are executing a cell that prints numbers 1-100.
        // When printing number 50, you click clear.
        // Cell output should now start printing output from 51 onwards, & not 1.
        await insertCodeCell(
            dedent`
            from ipywidgets import widgets
            from IPython.display import display, clear_output
            import time

            display(widgets.Button(description="First Button"))

            time.sleep(2)
            clear_output(True)

            display(widgets.Button(description="Second Button"))`,
            { index: 0 }
        );
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;

        await runAllCellsInActiveNotebook();

        // Wait for first button to appear then second.
        await Promise.all([
            waitForExecutionCompletedSuccessfully(cell),
            waitForTextOutput(cell, 'First Button', 0, false),
            waitForTextOutput(cell, 'Second Button', 0, false)
        ]);

        // Verify first is no longer visible and second is visible.
        assert.notInclude(getCellOutputs(cell), 'First Button');
        assert.include(getCellOutputs(cell), 'Second Button');
    });
    test('Shell commands should give preference to executables in Python Environment', async function () {
        if (IS_REMOTE_NATIVE_TEST()) {
            return this.skip();
        }
        await insertCodeCell('import sys', { index: 0 });
        await insertCodeCell('import os', { index: 1 });
        await insertCodeCell('print(os.getenv("PATH"))', { index: 2 });
        await insertCodeCell('print(sys.executable)', { index: 3 });
        const [, , cell3, cell4] = vscodeNotebook.activeNotebookEditor?.notebook.getCells()!;

        // Basically anything such as `!which python` and the like should point to the right executable.
        // For that to work, the first directory in the PATH must be the Python environment.

        await Promise.all([
            runAllCellsInActiveNotebook(),
            waitForExecutionCompletedSuccessfully(cell4),
            waitForCellHavingOutput(cell4)
        ]);

        const pathValue = getCellOutputs(cell3).split(path.delimiter);
        const sysExecutable = getCellOutputs(cell4).trim().toLowerCase();

        // First path in PATH must be the directory where executable is located.
        assert.ok(
            areInterpreterPathsSame(Uri.file(path.dirname(sysExecutable)), Uri.file(pathValue[0]), getOSType(), true),
            `First entry in PATH (${pathValue[0]}) does not point to executable (${sysExecutable})`
        );
    });
    test('!python should point to the Environment', async function () {
        if (IS_REMOTE_NATIVE_TEST()) {
            return this.skip();
        }
        await insertCodeCell(getOSType() === OSType.Windows ? '!where python' : '!which python', { index: 0 });
        await insertCodeCell('import sys', { index: 1 });
        await insertCodeCell('print(sys.executable)', { index: 2 });
        const [cell1, , cell3] = vscodeNotebook.activeNotebookEditor!.notebook.getCells()!;

        // Basically anything such as `!which python` and the like should point to the right executable.
        // For that to work, the first directory in the PATH must be the Python environment.

        await Promise.all([
            runAllCellsInActiveNotebook(),
            waitForCellExecutionToComplete(cell1),
            waitForCondition(
                async () => {
                    // Sometimes the cell can fail execution (IPython can sometimes throw an error).
                    const output = getCellOutputs(cell1).trim();
                    if (output !== '<No cell outputs>' && output.length > 0) {
                        return true;
                    }
                    if (hasErrorOutput(cell1.outputs)) {
                        return true;
                    }
                    return false;
                },
                defaultNotebookTestTimeout,
                'Cell did not have output'
            )
        ]);

        // Sometimes the IPython can (sometimes) fail with an error of `shell not found`.
        // For now, we'll ignore these errors
        // We already have tests that ensures the first path in sys.path points to where the executable is located.
        // Hence skipping this test in such cases is acceptable.
        let errorOutput = '';
        if (hasErrorOutput(cell1.outputs)) {
            const error = translateCellErrorOutput(cell1.outputs[0]);
            errorOutput = `${error.evalue}:${error.traceback}`;
            if (errorOutput.includes('shell not found')) {
                return this.skip();
            }
        }

        // On windows `!where python`, prints multiple items in the output (all executables found).
        const cell1Output = getCellOutputs(cell1);
        const shellExecutable = cell1Output
            .split('\n')
            .filter((item) => item.length)[0]
            .trim();

        await Promise.all([waitForCellExecutionToComplete(cell3), waitForCellHavingOutput(cell3)]);

        const sysExecutable = getCellOutputs(cell3).trim();

        // First path in PATH must be the directory where executable is located.
        assert.ok(
            areInterpreterPathsSame(Uri.file(shellExecutable), Uri.file(sysExecutable)),
            `Python paths do not match ${shellExecutable}, ${sysExecutable}. Output is (${cell1Output}), error is ${errorOutput}`
        );
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
        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;

        await Promise.all([
            runAllCellsInActiveNotebook(),
            waitForTextOutput(cell, 'Start', 0, false),
            waitForTextOutput(cell, '0', 0, false),
            waitForTextOutput(cell, '1', 0, false),
            waitForTextOutput(cell, '2', 0, false),
            waitForTextOutput(cell, '3', 0, false),
            waitForTextOutput(cell, '4', 0, false),
            waitForTextOutput(cell, 'End', 0, false)
        ]);
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
        const cells = vscodeNotebook.activeNotebookEditor?.notebook.getCells()!;

        await Promise.all([
            runAllCellsInActiveNotebook(),
            waitForTextOutput(cells[0], '1', 0, false),
            waitForTextOutput(cells[1], '<a href=f>', 0, false),
            waitForTextOutput(cells[2], '<a href=f>', 0, false),
            waitForCondition(
                async () => hasErrorOutput(cells[3].outputs),
                defaultNotebookTestTimeout,
                'No error output'
            )
        ]);

        const errorOutput = translateCellErrorOutput(cells[3].outputs[0]);
        assert.equal(errorOutput.ename, 'Exception', 'Incorrect ename'); // As status contains ename, we don't want this displayed again.
        assert.equal(errorOutput.evalue, '<whatever>', 'Incorrect evalue'); // As status contains ename, we don't want this displayed again.
        assert.isNotEmpty(errorOutput.traceback, 'Incorrect traceback');
        assert.include(errorOutput.traceback.join(''), '<whatever>');
    });
    test('Verify display updates', async () => {
        await insertCodeCell('from IPython.display import Markdown', { index: 0 });
        await insertCodeCell('dh = display(Markdown("foo"), display_id=True)', { index: 1 });
        const [, cell2] = vscodeNotebook.activeNotebookEditor?.notebook.getCells()!;

        await Promise.all([runAllCellsInActiveNotebook(), waitForTextOutput(cell2, 'foo', 0, false)]);
        const cell3 = await insertCodeCell(
            dedent`
                    dh.update(Markdown("bar"))
                    print('hello')`,
            { index: 2 }
        );
        await Promise.all([
            runCell(cell3),
            waitForTextOutput(cell2, 'bar', 0, false),
            waitForTextOutput(cell3, 'hello', 0, false)
        ]);
    });
    test('More messages from background threads', async function () {
        if (IS_REMOTE_NATIVE_TEST()) {
            //https://github.com/microsoft/vscode-jupyter/issues/7620 test failing for remote, but seems to work in manual test
            return this.skip();
        }
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
        const cells = vscodeNotebook.activeNotebookEditor?.notebook.getCells()!;

        await Promise.all([
            runAllCellsInActiveNotebook(),
            waitForCondition(
                async () => {
                    expect(getTextOutputValues(cells[0])).to.include('iteration 9');
                    return true;
                },
                defaultNotebookTestTimeout,
                () => `'iteration 9' not in output => '${getTextOutputValues(cells[0])}'`
            ),
            waitForCondition(
                async () => {
                    const textOutput = getTextOutputValues(cells[0]);
                    expect(textOutput.indexOf('main thread done')).lessThan(
                        textOutput.indexOf('iteration 9'),
                        'Main thread should have completed before background thread'
                    );
                    return true;
                },
                defaultNotebookTestTimeout,
                () => `Main thread output not before background output, '${getTextOutputValues(cells[0])}'`
            ),
            waitForCondition(
                async () => {
                    const textOutput = getTextOutputValues(cells[0]);
                    expect(textOutput.indexOf('main thread done')).greaterThan(
                        textOutput.indexOf('iteration 0'),
                        'Main thread should have completed after background starts'
                    );
                    return true;
                },
                defaultNotebookTestTimeout,
                () => `Main thread not after first background output, '${getTextOutputValues(cells[0])}'`
            )
        ]);
    });
    test('Messages from background threads can come in other cell output', async function () {
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
        print('main thread started')
        `,
            { index: 0 }
        );
        await insertCodeCell('print("HELLO")', { index: 1 });
        const [cell1, cell2] = vscodeNotebook.activeNotebookEditor?.notebook.getCells()!;

        await Promise.all([
            runAllCellsInActiveNotebook(),
            waitForCondition(
                async () => {
                    expect(getTextOutputValues(cell1)).to.include('main thread started');
                    return true;
                },
                defaultNotebookTestTimeout,
                () => `'main thread started' not in output => '${getTextOutputValues(cell1)}'`
            ),
            waitForCondition(
                async () => {
                    const secondCellOutput = getTextOutputValues(cell2);
                    expect(secondCellOutput).to.include('HELLO');
                    // The last output from the first cell should end up in the second cell.
                    expect(secondCellOutput).to.include('iteration 9');
                    return true;
                },
                defaultNotebookTestTimeout,
                () => `'iteration 9' and 'HELLO' not in second cell Output => '${getTextOutputValues(cell2)}'`
            )
        ]);
    });
    test('Outputs with support for ansic code `\u001b[A`', async function () {
        // Ansi Code `<esc>[A` means move cursor up, i.e. replace previous line with the new output (or erase previous line & start there).
        const cell1 = await insertCodeCell(
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
        const cell2 = await insertCodeCell(
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

        await Promise.all([
            runAllCellsInActiveNotebook(),
            waitForTextOutput(cell1, 'Line4', 0, false),
            waitForTextOutput(cell2, 'Line4', 0, false)
        ]);

        // In cell 1 we should have the output
        // Line1
        //
        // Line2
        // Line3
        // & in cell 2 we should have the output
        // Line1
        // Line2
        // Line3

        // Work around https://github.com/ipython/ipykernel/issues/729
        const ignoreEmptyOutputs = (output: NotebookCellOutput) => {
            return output.items.filter((item) => item.mime !== 'text/plain').length > 0;
        };
        assert.equal(cell1.outputs.filter(ignoreEmptyOutputs).length, 1, 'Incorrect number of output');
        assert.equal(cell2.outputs.filter(ignoreEmptyOutputs).length, 1, 'Incorrect number of output');

        // Confirm the output
        const output1Lines: string[] = getTextOutputValue(cell1.outputs[0]).splitLines({
            trim: false,
            removeEmptyEntries: false
        });
        const output2Lines: string[] = getTextOutputValue(cell2.outputs[0]).splitLines({
            trim: false,
            removeEmptyEntries: false
        });
        assert.equal(output1Lines.length, 4);
        assert.equal(output2Lines.length, 3);
    });
    test('Stderr & stdout outputs should go into separate outputs', async function () {
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
        const cells = vscodeNotebook.activeNotebookEditor!.notebook.getCells();
        traceInfo('1. Start execution for test of Stderr & stdout outputs');
        traceInfo('2. Start execution for test of Stderr & stdout outputs');
        await Promise.all([
            runAllCellsInActiveNotebook(),
            waitForTextOutput(cells[0], '3', 2, false),
            waitForTextOutput(cells[0], 'c', 3, false)
        ]);
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

    test('Handling of carriage returns', async () => {
        await insertCodeCell('print("one\\r", end="")\nprint("two\\r", end="")\nprint("three\\r", end="")', {
            index: 0
        });
        await insertCodeCell('print("one\\r")\nprint("two\\r")\nprint("three\\r")', { index: 1 });
        await insertCodeCell('print("1\\r2\\r3")', { index: 2 });
        await insertCodeCell('print("1\\r2")', { index: 3 });
        await insertCodeCell(
            'import time\nfor i in range(10):\n    s = str(i) + "%"\n    print("{0}\\r".format(s),end="")\n    time.sleep(0.0001)',
            { index: 4 }
        );
        await insertCodeCell('print("\\rExecute\\rExecute\\nExecute 8\\rExecute 9\\r\\r")', { index: 5 });

        const cells = vscodeNotebook.activeNotebookEditor!.notebook.getCells();
        await Promise.all([runAllCellsInActiveNotebook(), waitForExecutionCompletedSuccessfully(cells[5])]);

        // Wait for the outputs.
        await Promise.all([
            waitForTextOutput(cells[0], 'three\r', 0, true),
            waitForTextOutput(cells[1], 'one\ntwo\nthree\n', 0, true),
            waitForTextOutput(cells[2], '3\n', 0, true),
            waitForTextOutput(cells[3], '2\n', 0, true),
            waitForTextOutput(cells[4], '9%\r', 0, true),
            waitForTextOutput(cells[5], 'Execute\nExecute 9\n', 0, true)
        ]);
    });

    test('Execute all cells and run after error', async () => {
        await insertCodeCell('raise Error("fail")', { index: 0 });
        await insertCodeCell('print("after fail")', { index: 1 });

        const cells = vscodeNotebook.activeNotebookEditor!.notebook.getCells();
        await Promise.all([runAllCellsInActiveNotebook(), waitForExecutionCompletedWithErrors(cells[0])]);

        // Second cell output should be empty
        assert.equal(cells[1].outputs.length, 0, 'Second cell is not empty on run all');

        const cell = vscodeNotebook.activeNotebookEditor?.notebook.getCells()![1]!;
        await Promise.all([
            runCell(cell),
            // Wait till execution count changes and status is success.
            waitForTextOutput(cell, 'after fail', 0, false)
        ]);
    });
    test('Raw cells should not get executed', async () => {
        await insertCodeCell('print(1234)', { index: 0 });
        await insertCodeCell('Hello World', { index: 1, language: 'raw' });
        await insertCodeCell('print(5678)', { index: 2 });

        const [cell1, cell2, cell3] = vscodeNotebook.activeNotebookEditor!.notebook.getCells();
        await Promise.all([
            runAllCellsInActiveNotebook(),
            waitForCellExecutionToComplete(cell1),
            waitForTextOutput(cell1, '1234', 0, false),
            waitForCellExecutionToComplete(cell3),
            waitForTextOutput(cell3, '5678', 0, false)
        ]);

        // Second cell should not have been executed.
        assert.isEmpty(cell2.outputs, 'Second cell should not have any output');
        assert.isUndefined(cell2.executionSummary?.executionOrder, 'Second cell should not have an execution order');
        assert.isUndefined(cell2.executionSummary?.timing, 'Second cell should not have execution times');
        assert.isUndefined(cell2.executionSummary?.success, 'Second cell should not have execution result');
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

        await Promise.all([
            runAllCellsInActiveNotebook(),
            waitForExecutionCompletedSuccessfully(cell1),
            waitForExecutionCompletedWithErrors(cell2)
        ]);
        assertExecutionOrderOfCells([cell1, cell2]);
        assertVSCCellIsNotRunning(cell3);

        // Run cell 2 again, & it should fail again & execution count should increase.
        await Promise.all([
            runCell(cell2),
            // Give it time to run & fail, this time execution order is greater than previously
            waitForCondition(
                async () => cell2.executionSummary?.executionOrder === 3,
                5_000,
                'Cell did not fail again with a new execution order'
            ),
            waitForExecutionCompletedWithErrors(cell2)
        ]);

        // Run cell 3 & it should run to completion.
        await Promise.all([runCell(cell3), waitForExecutionCompletedSuccessfully(cell3)]);
        const lastExecutionOrderOfCell3 = cell3.executionSummary?.executionOrder!;
        assert.equal(lastExecutionOrderOfCell3, 4);

        // Run all cells again
        await Promise.all([
            runAllCellsInActiveNotebook(),
            waitForCondition(
                async () => cell2.executionSummary?.executionOrder === 6,
                5_000,
                'Cell did not fail again with a new execution order (3rd time)'
            ),
            waitForExecutionCompletedSuccessfully(cell1),
            waitForExecutionCompletedWithErrors(cell2)
        ]);
        assert.equal(cell1.executionSummary?.executionOrder, 5);
        assert.equal(cell2.executionSummary?.executionOrder, 6);
        // We check if the execution order is undefined or the same as previous.
        // For some reason execution orders don't cleared, we have a bug for this.
        // https://github.com/microsoft/vscode/issues/130791
        assert.isTrue(
            cell3.executionSummary?.executionOrder === undefined ||
                cell3.executionSummary?.executionOrder == lastExecutionOrderOfCell3,
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
        const cells = vscodeNotebook.activeNotebookEditor?.notebook.getCells()!;

        await Promise.all([
            runAllCellsInActiveNotebook(),

            // Wait till execution count changes and status is success.
            waitForExecutionCompletedSuccessfully(cells[0]),
            waitForExecutionCompletedSuccessfully(cells[1]),
            waitForCondition(
                async () => vscodeNotebook.activeNotebookEditor?.notebook.cellCount === 3,
                defaultNotebookTestTimeout,
                'New cell not inserted'
            )
        ]);

        // Check our output, one cell should have been inserted, and one been replaced
        const cellsPostExecute = vscodeNotebook.activeNotebookEditor?.notebook.getCells()!;
        expect(cellsPostExecute.length).to.equal(3);
        expect(cellsPostExecute[0].document.getText()).to.equal(
            dedent`
            import IPython
            IPython.get_ipython().set_next_input("print('INSERT')")`
        );
        // Wait for UI to get updated, sometimes VSC can be slow, even after execution has completed.
        await waitForCondition(
            async () => {
                expect(cellsPostExecute[1].document.getText()).to.equal("print('INSERT')");
                return true;
            },
            defaultNotebookTestTimeout,
            () => `Cell not replaced, it is ${cellsPostExecute[1].document.getText()}`
        );
        await waitForCondition(
            async () => {
                expect(cellsPostExecute[2].document.getText()).to.equal("print('REPLACE')");
                return true;
            },
            defaultNotebookTestTimeout,
            () => `Cell not replaced, it is ${cellsPostExecute[2].document.getText()}`
        );
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

            cellInfo.push({ runToCompletion: () => swallowExceptions(() => fs.unlinkSync(tmpFile)), cell });
        }

        return cellInfo;
    }
});
