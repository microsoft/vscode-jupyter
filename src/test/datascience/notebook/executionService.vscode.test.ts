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
    Disposable,
    EventEmitter,
    NotebookCell,
    NotebookCellKind,
    NotebookCellOutput,
    NotebookCellOutputItem,
    NotebookDocumentChangeEvent,
    NotebookEdit,
    Uri,
    workspace,
    WorkspaceEdit
} from 'vscode';
import { Common } from '../../../platform/common/utils/localize';
import { traceError, traceInfo, traceVerbose } from '../../../platform/logging';
import { IDisposable } from '../../../platform/common/types';
import { captureScreenShot, IExtensionTestApi, waitForCondition, testMandatory } from '../../common.node';
import { EXTENSION_ROOT_DIR_FOR_TESTS, initialize } from '../../initialize.node';
import {
    closeNotebooksAndCleanUpAfterTests,
    startJupyterServer,
    hijackPrompt,
    waitForTextOutput,
    defaultNotebookTestTimeout,
    assertNotHasTextOutputInVSCode,
    waitForExecutionCompletedWithErrors,
    waitForExecutionCompletedSuccessfully,
    getCellOutputs,
    waitForCellHavingOutput,
    waitForCellExecutionToComplete,
    createTemporaryNotebookFromFile,
    waitForQueuedForExecution,
    waitForExecutionInProgress,
    waitForQueuedForExecutionOrExecuting,
    assertVSCCellIsNotRunning,
    getDefaultKernelConnection
} from './helper.node';
import { isWeb, swallowExceptions } from '../../../platform/common/utils/misc';
import { ProductNames } from '../../../kernels/installer/productNames';
import { Product } from '../../../kernels/installer/types';
import { IPYTHON_VERSION_CODE, IS_REMOTE_NATIVE_TEST } from '../../constants.node';
import { areInterpreterPathsSame } from '../../../platform/pythonEnvironments/info/interpreter';
import {
    getTextOutputValue,
    getTextOutputValues,
    hasErrorOutput,
    translateCellErrorOutput
} from '../../../kernels/execution/helpers';
import { IKernel, IKernelProvider, INotebookKernelExecution, NotebookCellRunState } from '../../../kernels/types';
import { createKernelController, TestNotebookDocument } from './executionHelper';
import { noop } from '../../core';
import { getOSType, OSType } from '../../../platform/common/utils/platform';

// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const expectedPromptMessageSuffix = `requires ${ProductNames.get(Product.ipykernel)!} to be installed.`;

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('Kernel Execution @kernelCore', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    const templateNbPath = Uri.file(
        path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'test', 'datascience', 'notebook', 'emptyCellWithOutput.ipynb')
    );
    const envFile = Uri.joinPath(Uri.file(EXTENSION_ROOT_DIR_FOR_TESTS), 'src', 'test', 'datascience', '.env');
    this.timeout(120_000);
    let notebook: TestNotebookDocument;
    let kernel: IKernel;
    let kernelExecution: INotebookKernelExecution;
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
            traceVerbose('Before starting Jupyter');
            await startJupyterServer();
            traceVerbose('After starting Jupyter');
            sinon.restore();
            notebook = new TestNotebookDocument(templateNbPath);
            const kernelProvider = api.serviceContainer.get<IKernelProvider>(IKernelProvider);
            traceVerbose('Before creating kernel connection');
            const metadata = await getDefaultKernelConnection();
            traceVerbose('After creating kernel connection');

            const controller = createKernelController();
            kernel = kernelProvider.getOrCreate(notebook, { metadata, resourceUri: notebook.uri, controller });
            traceVerbose('Before starting kernel');
            await kernel.start();
            traceVerbose('After starting kernel');
            kernelExecution = kernelProvider.getKernelExecution(kernel);
            traceInfo('Suite Setup (completed)');
        } catch (e) {
            traceError('Suite Setup (failed) - Execution', e);
            await captureScreenShot('execution-suite');
            throw e;
        }
    });
    setup(function () {
        notebook.cells.length = 0;
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(function () {
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));
    testMandatory('Execute cell using VSCode Kernel', async () => {
        const cell = await notebook.appendCodeCell('print("123412341234")');
        await kernelExecution.executeCell(cell);

        assert.isAtLeast(cell.executionSummary?.executionOrder || 0, 1);
        assert.strictEqual(Buffer.from(cell.outputs[0].items[0].data).toString().trim(), '123412341234');
        assert.isTrue(cell.executionSummary?.success);
    });
    test('Test __vsc_ipynb_file__ defined in cell using VSCode Kernel', async () => {
        const cell = await notebook.appendCodeCell('print(__vsc_ipynb_file__)');
        await kernelExecution.executeCell(cell);
        const uri = notebook.uri;
        // eslint-disable-next-line local-rules/dont-use-fspath
        await Promise.all([kernelExecution.executeCell(cell), waitForTextOutput(cell, `${uri.fsPath}`)]);
    });
    test.skip('Test exceptions have hrefs', async () => {
        const ipythonVersionCell = await notebook.appendCodeCell(IPYTHON_VERSION_CODE);
        assert.strictEqual(await kernelExecution.executeCell(ipythonVersionCell), NotebookCellRunState.Success);
        const ipythonVersion = parseInt(getTextOutputValue(ipythonVersionCell!.outputs[0]));

        const codeCell = await notebook.appendCodeCell('raise Exception("FOO")');
        assert.strictEqual(await kernelExecution.executeCell(codeCell), NotebookCellRunState.Error);

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
            assert.ok(
                hrefs,
                `Hrefs not found in traceback, HTML = ${html}, output = ${errorOutput.traceback.join('\n')}`
            );
        }
    });
    test('Leading whitespace not suppressed', async () => {
        const cell = await notebook.appendCodeCell('print("\tho")\nprint("\tho")\nprint("\tho")\n');
        await kernelExecution.executeCell(cell);
        await waitForCondition(
            () => {
                const output = getCellOutputs(cell);
                const lines = output.splitLines({ trim: false, removeEmptyEntries: true });
                return lines.length === 3 && lines[0] === '\tho' && lines[1] === '\tho' && lines[2] === '\tho';
            },
            defaultNotebookTestTimeout,
            () => `Cell output not as expected, it is ${getCellOutputs(cell)}`
        );
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

        const cell = await notebook.appendCodeCell(
            dedent`
                    import sys
                    import os
                    print(sys.path)
                    print(os.getenv("ENV_VAR_TESTING_CI"))`
        );

        await Promise.all([
            kernelExecution.executeCell(cell),
            waitForTextOutput(cell, 'HelloWorldEnvVariable', 0, false),
            waitForTextOutput(cell, 'dummyFolderForPythonPath', 0, false)
        ]);
    });
    test('Empty cells will not have an execution order nor have a status of success', async () => {
        const cell1 = await notebook.appendCodeCell('');
        const cell2 = await notebook.appendCodeCell('print("Hello World")');

        await Promise.all([
            kernelExecution.executeCell(cell1),
            kernelExecution.executeCell(cell2),
            waitForTextOutput(cell2, 'Hello World')
        ]);

        assert.isUndefined(cell1.executionSummary?.executionOrder);
    });
    test('Clear output in empty cells', async function () {
        const cell = await notebook.appendCodeCell('');
        cell.executionSummary = { executionOrder: 1 };
        cell.outputs.push(new NotebookCellOutput([NotebookCellOutputItem.text('Hello World')]));

        assert.equal(cell.executionSummary?.executionOrder, 1);

        await kernelExecution.executeCell(cell);
        assert.strictEqual(cell.outputs.length, 0);
        assert.isUndefined(cell.executionSummary.executionOrder);
    });
    test('Verify multiple cells get executed', async () => {
        const cell1 = await notebook.appendCodeCell('print("Foo Bar")');
        const cell2 = await notebook.appendCodeCell('print("Hello World")');

        await Promise.all([kernelExecution.executeCell(cell1), kernelExecution.executeCell(cell2)]);

        // Verify execution count.
        assert.isAtLeast(cell1.executionSummary?.executionOrder || 0, 1);
        // Second cell should have an execution order of 1 more than previous.
        assert.equal(cell2.executionSummary?.executionOrder! - 1, cell1.executionSummary?.executionOrder!);
    });
    test('Verify output & metadata for executed cell with errors', async () => {
        const cell = await notebook.appendCodeCell('print(abcd)');

        await kernelExecution.executeCell(cell);

        assert.isAtLeast(cell.executionSummary?.executionOrder || 0, 1);
        assert.isTrue(hasErrorOutput(cell.outputs));

        const errorOutput = translateCellErrorOutput(cell.outputs[0]);
        assert.equal(errorOutput.ename, 'NameError', 'Incorrect ename'); // As status contains ename, we don't want this displayed again.
        assert.equal(errorOutput.evalue, "name 'abcd' is not defined", 'Incorrect evalue'); // As status contains ename, we don't want this displayed again.
        assert.isNotEmpty(errorOutput.traceback, 'Incorrect traceback');
    });
    test('Updating display data', async function () {
        const cell1 = await notebook.appendCodeCell('from IPython.display import Markdown\n');
        const displayCell = await notebook.appendCodeCell('dh = display(display_id=True)\n');
        const cell3 = await notebook.appendCodeCell('dh.update(Markdown("foo"))\n');

        await Promise.all([
            kernelExecution.executeCell(cell1),
            kernelExecution.executeCell(displayCell),
            kernelExecution.executeCell(cell3)
        ]);

        assert.lengthOf(displayCell.outputs, 1, 'Incorrect output');
        assert.isAtLeast(displayCell.executionSummary?.executionOrder || 0, 1);
        await waitForTextOutput(displayCell, 'foo', 0, false);
    });
    test('Clearing output while executing will ensure output is cleared', async function () {
        // const vscNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        let onDidChangeNbEventHandler = new EventEmitter<NotebookDocumentChangeEvent>();
        const stub = sinon.stub(workspace, 'onDidChangeNotebookDocument');
        stub.get(() => onDidChangeNbEventHandler.event);
        disposables.push(onDidChangeNbEventHandler);

        // Assume you are executing a cell that prints numbers 1-100.
        // When printing number 50, you click clear.
        // Cell output should now start printing output from 51 onwards, & not 1.
        const cell = await notebook.appendCodeCell(
            dedent`
                    print("Start")
                    import time
                    for i in range(100):
                        time.sleep(0.1)
                        print(i)

                    print("End")`
        );
        kernelExecution.executeCell(cell).catch(noop);

        await Promise.all([
            waitForTextOutput(cell, 'Start', 0, false),
            waitForTextOutput(cell, '0', 0, false),
            waitForTextOutput(cell, '1', 0, false),
            waitForTextOutput(cell, '2', 0, false),
            waitForTextOutput(cell, '3', 0, false),
            waitForTextOutput(cell, '4', 0, false)
        ]);

        // Clear the outputs.
        cell.outputs.length = 0;
        onDidChangeNbEventHandler.fire({
            notebook,
            metadata: undefined,
            contentChanges: [],
            cellChanges: [{ cell, document: undefined, executionSummary: undefined, metadata: undefined, outputs: [] }]
        });

        // Wait till previous output gets cleared & we have new output.
        await waitForCondition(
            () => assertNotHasTextOutputInVSCode(cell, 'Start', 0, false) && cell.outputs.length > 0,
            5_000,
            'Cell did not get cleared'
        );
        await kernel.interrupt();
        if (getOSType() == OSType.Windows) {
            // Interrupting a cell on Windows is flaky. there isn't much we can do about it.
            await kernel.interrupt().catch(noop);
            await kernel.interrupt().catch(noop);
            await waitForCellExecutionToComplete(cell).catch(noop);
        } else {
            await waitForExecutionCompletedWithErrors(cell);
            // Verify that it hasn't got added (even after interrupting).
            assertNotHasTextOutputInVSCode(cell, 'Start', 0, false);
        }
    });
    test('Clearing output via code', async function () {
        // Assume you are executing a cell that prints numbers 1-100.
        // When printing number 50, you click clear.
        // Cell output should now start printing output from 51 onwards, & not 1.
        const cell = await notebook.appendCodeCell(
            dedent`
                from IPython.display import display, clear_output
                import time
                print('foo')
                display('foo')
                time.sleep(0.5)
                clear_output(True)
                print('bar')
                display('bar')`
        );

        await Promise.all([
            kernelExecution.executeCell(cell),

            // Wait for foo to be printed
            waitForTextOutput(cell, 'foo', 0, false),
            waitForTextOutput(cell, 'foo', 1, false),

            // Wait for bar to be printed
            waitForTextOutput(cell, 'bar', 0, false),
            waitForTextOutput(cell, 'bar', 1, false),

            // Wait for cell to finish.
            waitForExecutionCompletedSuccessfully(cell)
        ]);
    });
    test('Clearing output immediately via code', async () => {
        // Assume you are executing a cell that prints numbers 1-100.
        // When printing number 50, you click clear.
        // Cell output should now start printing output from 51 onwards, & not 1.
        const cell = await notebook.appendCodeCell(
            dedent`
            from ipywidgets import widgets
            from IPython.display import display, clear_output
            import time

            display(widgets.Button(description="First Button"))

            time.sleep(0.5)
            clear_output()

            display(widgets.Button(description="Second Button"))`
        );

        await Promise.all([
            kernelExecution.executeCell(cell),
            waitForExecutionCompletedSuccessfully(cell),
            waitForTextOutput(cell, 'Second Button', 0, false)
        ]);
    });
    test('Clearing output via code only when receiving new output', async function () {
        // Assume you are executing a cell that prints numbers 1-100.
        // When printing number 50, you click clear.
        // Cell output should now start printing output from 51 onwards, & not 1.
        const cell = await notebook.appendCodeCell(
            dedent`
            from ipywidgets import widgets
            from IPython.display import display, clear_output
            import time

            display(widgets.Button(description="First Button"))

            time.sleep(0.5)
            clear_output(True)

            display(widgets.Button(description="Second Button"))`
        );

        // Wait for first button to appear then second.
        await Promise.all([
            kernelExecution.executeCell(cell),
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
        await notebook.appendCodeCell('import sys');
        await notebook.appendCodeCell('import os');
        const cell3 = await notebook.appendCodeCell('print(os.getenv("PATH"))');
        const cell4 = await notebook.appendCodeCell('print(sys.executable)');

        // Basically anything such as `!which python` and the like should point to the right executable.
        // For that to work, the first directory in the PATH must be the Python environment.

        await Promise.all([
            Promise.all(notebook.cells.map((cell) => kernelExecution.executeCell(cell))),
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
        const cell1 = await notebook.appendCodeCell(getOSType() === OSType.Windows ? '!where python' : '!which python');
        await notebook.appendCodeCell('import sys');
        const cell3 = await notebook.appendCodeCell('print(sys.executable)');

        notebook.cells.map((cell) => kernelExecution.executeCell(cell).ignoreErrors());

        // Basically anything such as `!which python` and the like should point to the right executable.
        // For that to work, the first directory in the PATH must be the Python environment.

        await Promise.all([
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
        const cell = await notebook.appendCodeCell(
            dedent`
                    print("Start")
                    import time
                    for i in range(5):
                        time.sleep(0.1)
                        print(i)

                    print("End")`
        );

        await Promise.all([
            kernelExecution.executeCell(cell),
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
        await notebook.appendCodeCell('1');
        await notebook.appendCodeCell(dedent`
                                            a="<a href=f>"
                                            a`);
        await notebook.appendCodeCell(dedent`
                                            a="<a href=f>"
                                            print(a)`);
        await notebook.appendCodeCell('raise Exception("<whatever>")');
        const cells = notebook.cells;
        await Promise.all([
            Promise.all(notebook.cells.map((cell) => kernelExecution.executeCell(cell))),
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
        const cell1 = await notebook.appendCodeCell('from IPython.display import Markdown');
        const cell2 = await notebook.appendCodeCell('dh = display(Markdown("foo"), display_id=True)');

        await Promise.all([
            kernelExecution.executeCell(cell1),
            kernelExecution.executeCell(cell2),
            waitForTextOutput(cell2, 'foo', 0, false)
        ]);
        const cell3 = await notebook.appendCodeCell(
            dedent`
                    dh.update(Markdown("bar"))
                    print('hello')`
        );
        await Promise.all([
            kernelExecution.executeCell(cell3),
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
        const cell = await notebook.appendCodeCell(
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
        `
        );

        await Promise.all([
            kernelExecution.executeCell(cell),
            waitForCondition(
                async () => {
                    expect(getTextOutputValues(cell)).to.include('iteration 9');
                    return true;
                },
                defaultNotebookTestTimeout,
                () => `'iteration 9' not in output => '${getTextOutputValues(cell)}'`
            ),
            waitForCondition(
                async () => {
                    const textOutput = getTextOutputValues(cell);
                    expect(textOutput.indexOf('main thread done')).lessThan(
                        textOutput.indexOf('iteration 9'),
                        'Main thread should have completed before background thread'
                    );
                    return true;
                },
                defaultNotebookTestTimeout,
                () => `Main thread output not before background output, '${getTextOutputValues(cell)}'`
            ),
            waitForCondition(
                async () => {
                    const textOutput = getTextOutputValues(cell);
                    expect(textOutput.indexOf('main thread done')).greaterThan(
                        textOutput.indexOf('iteration 0'),
                        'Main thread should have completed after background starts'
                    );
                    return true;
                },
                defaultNotebookTestTimeout,
                () => `Main thread not after first background output, '${getTextOutputValues(cell)}'`
            )
        ]);
    });
    test('Messages from background threads can come in other cell output', async function () {
        // Details can be found in notebookUpdater.ts & https://github.com/jupyter/jupyter_client/issues/297
        // If you have a background thread in cell 1 & then immediately after that you have a cell 2.
        // The background messages (output) from cell one will end up in cell 2.
        const cell1 = await notebook.appendCodeCell(
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
        `
        );
        const cell2 = await notebook.appendCodeCell('print("HELLO")');

        await Promise.all([
            Promise.all(notebook.cells.map((cell) => kernelExecution.executeCell(cell))),
            waitForCondition(
                () => getTextOutputValues(cell1).includes('main thread started'),
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
    test('Stderr & stdout outputs should go into separate outputs', async function () {
        const cell = await notebook.appendCodeCell(
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
                        `
        );
        traceInfo('1. Start execution for test of Stderr & stdout outputs');
        traceInfo('2. Start execution for test of Stderr & stdout outputs');
        await Promise.all([
            kernelExecution.executeCell(cell),
            waitForTextOutput(cell, '1', 0, false),
            waitForTextOutput(cell, 'a', 1, false),
            waitForTextOutput(cell, '3', 2, false),
            waitForTextOutput(cell, 'c', 3, false)
        ]);
        traceInfo('2. completed execution for test of Stderr & stdout outputs');

        // In cell 1 we should have the output
        // 12
        // ab
        // 3
        // c
        assert.equal(cell.outputs.length, 4, 'Incorrect number of output');
        // All output items should be of type stream
        const expectedMetadata = { outputType: 'stream' };
        assert.deepEqual(cell.outputs[0].metadata, expectedMetadata, `Metadata is incorrect for cell 0`);
        assert.deepEqual(cell.outputs[1].metadata, expectedMetadata, `Metadata is incorrect for cell 1`);
        assert.deepEqual(cell.outputs[2].metadata, expectedMetadata, `Metadata is incorrect for cell 2`);
        assert.deepEqual(cell.outputs[3].metadata, expectedMetadata, `Metadata is incorrect for cell 3`);

        assert.include(getTextOutputValue(cell.outputs[0]), '12', `Text is incorrect for cell 0`);
        assert.include(getTextOutputValue(cell.outputs[1]), 'ab', `Text is incorrect for cell 1`);
        assert.include(getTextOutputValue(cell.outputs[2]), '3', `Text is incorrect for cell 2`);
        assert.include(getTextOutputValue(cell.outputs[3]), 'c', `Text is incorrect for cell 3`);
    });

    test('Execute all cells and run after error', async () => {
        const cell1 = await notebook.appendCodeCell('raise Error("fail")');
        const cell2 = await notebook.appendCodeCell('print("after fail")');

        await Promise.all([
            Promise.all(notebook.cells.map((cell) => kernelExecution.executeCell(cell))),
            waitForExecutionCompletedWithErrors(cell1)
        ]);

        // Second cell output should be empty
        assert.equal(cell2.outputs.length, 0, 'Second cell is not empty on run all');

        await Promise.all([
            kernelExecution.executeCell(cell2),
            // Wait till execution count changes and status is success.
            waitForTextOutput(cell2, 'after fail', 0, false)
        ]);
    });
    test('Raw cells should not get executed', async () => {
        const cell1 = await notebook.appendCodeCell('print(1234)');
        const cell2 = await notebook.appendCodeCell('Hello World', 'raw');
        const cell3 = await notebook.appendCodeCell('print(5678)');

        await Promise.all([
            Promise.all(notebook.cells.map((cell) => kernelExecution.executeCell(cell))),
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
        const cells = await insertRandomCells(notebook, { count: 4, addMarkdownCells: false });

        // Cell 1 should have started, cells 2 & 3 should be queued.
        const [cell1, cell2, cell3, cell4] = cells;
        Promise.all(notebook.cells.map((cell) => kernelExecution.executeCell(cell))).ignoreErrors();
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
        const cells = await insertRandomCells(notebook, { count: 15, addMarkdownCells: true });
        const codeCells = cells.filter((cell) => cell.cell.kind === NotebookCellKind.Code);
        // Run cells at random & keep track of the order in which they were run (to validate execution order later).
        const queuedCells: typeof cells = [];
        while (codeCells.length) {
            const index = Math.floor(Math.random() * codeCells.length);
            const cellToQueue = codeCells.splice(index, 1)[0];
            queuedCells.push(cellToQueue);
            kernelExecution.executeCell(cellToQueue.cell).ignoreErrors();
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
        const cells = await insertRandomCells(notebook, { count: 4, addMarkdownCells: false });
        // Add 5th code cells code errors.
        cells.push({
            runToCompletion: noop,
            cell: await notebook.appendCodeCell('KABOOM')
        });
        // Add 5 more code cells.
        cells.push(...(await insertRandomCells(notebook, { count: 5, addMarkdownCells: false })));

        // Run the whole document.
        // Verify all have been queued.
        notebook.cells.map((cell) => kernelExecution.executeCell(cell).ignoreErrors());
        await Promise.all(cells.map((item) => item.cell).map((cell) => waitForQueuedForExecutionOrExecuting(cell)));

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
        const cells = await insertRandomCells(notebook, { count: 5, addMarkdownCells: false });
        // Create some code cells & markdown cells.
        cells.push(...(await insertRandomCells(notebook, { count: 10, addMarkdownCells: true })));

        const codeCells = cells.filter((cell) => cell.cell.kind === NotebookCellKind.Code);
        const queuedCells: NotebookCell[] = [];
        for (let index = 0; index < codeCells.length; index++) {
            const cell = codeCells[index].cell;
            if (cell.kind === NotebookCellKind.Code) {
                queuedCells.push(cell);
                kernelExecution.executeCell(cell).ignoreErrors();
                await waitForQueuedForExecutionOrExecuting(cell);
            }
        }

        // let all cells run to completion & validate their execution orders match the order of the queue.
        codeCells.forEach((item) => item.runToCompletion());
        await Promise.all(queuedCells.map((cell) => waitForExecutionCompletedSuccessfully(cell)));
        assertExecutionOrderOfCells(queuedCells);
    });
    test('Run entire notebook then add a new cell, ensure new cell is not executed', async () => {
        const cells = await insertRandomCells(notebook, { count: 15, addMarkdownCells: true });

        const queuedCells = cells.filter((item) => item.cell.kind === NotebookCellKind.Code).map((item) => item.cell);
        notebook.cells.map((cell) => kernelExecution.executeCell(cell).ignoreErrors());
        await Promise.all(queuedCells.map((cell) => waitForQueuedForExecutionOrExecuting(cell)));

        // Add a new cell to the document, this should not get executed.
        const [newCell] = await insertRandomCells(notebook, { count: 1, addMarkdownCells: false });

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
        const cells = await insertRandomCells(notebook, { count: 15, addMarkdownCells: true });
        const codeCells = cells.filter((cell) => cell.cell.kind === NotebookCellKind.Code);

        const queuedCells = codeCells.map((item) => item.cell);
        // Run entire notebook & verify all cells are queued for execution.
        notebook.cells.map((cell) => kernelExecution.executeCell(cell).ignoreErrors());
        await Promise.all(queuedCells.map((cell) => waitForQueuedForExecutionOrExecuting(cell)));

        // Insert new cell & run it, & verify that too is queued for execution.
        const [newCell] = await insertRandomCells(notebook, { count: 1, addMarkdownCells: false });
        queuedCells.push(newCell.cell);
        kernelExecution.executeCell(newCell.cell).ignoreErrors();
        await Promise.all(queuedCells.map((cell) => waitForQueuedForExecutionOrExecuting(cell)));

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

        const cell1 = await notebook.appendCodeCell('1');
        const cell2 = await notebook.appendCodeCell('KABOOM');
        const cell3 = await notebook.appendCodeCell('2');

        await Promise.all([
            Promise.all(notebook.cells.map((cell) => kernelExecution.executeCell(cell))),
            waitForExecutionCompletedSuccessfully(cell1),
            waitForExecutionCompletedWithErrors(cell2)
        ]);
        assertExecutionOrderOfCells([cell1, cell2]);
        assertVSCCellIsNotRunning(cell3);

        // Run cell 2 again, & it should fail again & execution count should increase.
        await Promise.all([
            kernelExecution.executeCell(cell2),
            // Give it time to run & fail, this time execution order is greater than previously
            waitForCondition(
                async () => cell2.executionSummary?.executionOrder === cell1.executionSummary!.executionOrder! + 2,
                5_000,
                'Cell did not fail again with a new execution order'
            ),
            waitForExecutionCompletedWithErrors(cell2)
        ]);

        // Run cell 3 & it should run to completion.
        await Promise.all([kernelExecution.executeCell(cell3), , waitForExecutionCompletedSuccessfully(cell3)]);
        const lastExecutionOrderOfCell3 = cell3.executionSummary?.executionOrder!;
        assert.equal(lastExecutionOrderOfCell3, cell1.executionSummary!.executionOrder! + 3);

        // Run all cells again
        await Promise.all([
            Promise.all(notebook.cells.map((cell) => kernelExecution.executeCell(cell))),
            waitForCondition(
                async () => cell2.executionSummary?.executionOrder === lastExecutionOrderOfCell3 + 2,
                5_000,
                'Cell did not fail again with a new execution order (3rd time)'
            ),
            waitForExecutionCompletedSuccessfully(cell1),
            waitForExecutionCompletedWithErrors(cell2)
        ]);
        assert.equal(cell1.executionSummary?.executionOrder, lastExecutionOrderOfCell3 + 1);
        assert.equal(cell2.executionSummary?.executionOrder, lastExecutionOrderOfCell3 + 2);
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
        await notebook.appendCodeCell(
            dedent`
            import IPython
            IPython.get_ipython().set_next_input("print('INSERT')")`
        );
        await notebook.appendCodeCell(
            dedent`
            import IPython
            IPython.get_ipython().set_next_input("print('REPLACE')", replace=True)`
        );

        const nbEditStub = sinon.stub(NotebookEdit, 'insertCells');
        // const editStub = sinon.stub(workspace, 'applyEdit');
        const workspaceEditSetStub = sinon.stub(WorkspaceEdit.prototype, 'set');
        disposables.push(new Disposable(() => nbEditStub.restore()));
        // disposables.push(new Disposable(() => editStub.restore()));
        disposables.push(new Disposable(() => workspaceEditSetStub.restore()));
        // editStub.callsFake(() => Promise.resolve(true));
        nbEditStub.callsFake((index, newCells) => {
            newCells.forEach((cell, i) => {
                if (cell.kind === NotebookCellKind.Code) {
                    notebook.insertCodeCell(index + i, cell.value, cell.languageId).ignoreErrors();
                } else {
                    notebook.insertMarkdownCell(index + i, cell.value).ignoreErrors();
                }
            });
            return undefined as any;
        });
        workspaceEditSetStub.callsFake(() => noop());

        const cells = notebook.cells;
        await Promise.all([
            Promise.all(notebook.cells.map((cell) => kernelExecution.executeCell(cell))),

            // Wait till execution count changes and status is success.
            waitForExecutionCompletedSuccessfully(cells[0]),
            waitForExecutionCompletedSuccessfully(cells[1]),
            waitForCondition(async () => notebook.cellCount === 3, defaultNotebookTestTimeout, 'New cell not inserted')
        ]);

        // Check our output, one cell should have been inserted, and one been replaced
        const cellsPostExecute = notebook.getCells()!;
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
    test('Updating display data with async code in Python cells', async function () {
        await notebook.appendCodeCell(dedent`
        from asyncio import sleep, create_task, gather
        from typing import Awaitable, List
        from IPython.display import display
        from IPython import get_ipython

        def get_msg_id() -> str:
            return get_ipython().kernel.get_parent()["header"]['msg_id']

        async def say_hi_to_after(message:str, x:str, tasks: Awaitable[None]):
            current_cell_msg_id = get_msg_id()
            await tasks
            get_ipython().kernel.get_parent()["header"]["msg_id"] = x
            display(f"HI {message}")
            get_ipython().kernel.get_parent()["header"]["msg_id"] = current_cell_msg_id
            `);
        const cell2 = await notebook.appendCodeCell('x = get_msg_id()');
        await notebook.appendCodeCell(dedent`
        y = say_hi_to_after("Y", x, sleep(1))
        create_task(y);`);
        const cell4 = await notebook.appendCodeCell(dedent`
        z = say_hi_to_after("Z", x, sleep(1))
        create_task(z);`);

        await Promise.all(notebook.cells.map((cell) => kernelExecution.executeCell(cell)));

        // Wait till execution count changes and status is success.
        await waitForExecutionCompletedSuccessfully(cell4);

        await waitForTextOutput(cell2, 'HI Y', 0, false);
        await waitForTextOutput(cell2, 'HI Z', 1, false);
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
    async function insertRandomCells(
        notebook: TestNotebookDocument,
        options?: { count: number; addMarkdownCells: boolean }
    ) {
        const cellInfo: { runToCompletion: Function; cell: NotebookCell }[] = [];
        const numberOfCellsToAdd = options?.count ?? 10;
        const startIndex = notebook.cellCount;
        const endIndex = startIndex + numberOfCellsToAdd;
        // Insert the necessary amount of cells
        for (let index = startIndex; index < endIndex; index++) {
            // Once this file is deleted the cell will run to completion.
            const tmpFile = (await createTemporaryNotebookFromFile(templateNbPath, disposables)).fsPath;
            let cell: NotebookCell;
            if (!options?.addMarkdownCells || Math.floor(Math.random() * 2) === 0) {
                cell = await notebook.appendCodeCell(
                    dedent`
                        print("Start Cell ${index}")
                        import time
                        import os.path
                        from os import path
                        while os.path.exists('${tmpFile.replace(/\\/g, '\\\\')}'):
                            time.sleep(0.1)

                        print("End Cell ${index}")`
                );
            } else {
                cell = await notebook.appendMarkdownCell(`Markdown Cell ${index}`);
            }

            cellInfo.push({ runToCompletion: () => swallowExceptions(() => fs.unlinkSync(tmpFile)), cell });
        }

        return cellInfo;
    }
});
