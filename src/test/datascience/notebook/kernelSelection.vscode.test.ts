// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as sinon from 'sinon';
import { commands, Uri } from 'vscode';
import { CellDisplayOutput } from '../../../../types/vscode-proposed';
import { IPythonExtensionChecker } from '../../../client/api/types';
import { IVSCodeNotebook } from '../../../client/common/application/types';
import { BufferDecoder } from '../../../client/common/process/decoder';
import { ProcessService } from '../../../client/common/process/proc';
import { IDisposable } from '../../../client/common/types';
import { INotebookEditorProvider } from '../../../client/datascience/types';
import { IInterpreterService } from '../../../client/interpreter/contracts';
import { getOSType, IExtensionTestApi, OSType, waitForCondition } from '../../common';
import { EXTENSION_ROOT_DIR_FOR_TESTS, IS_NON_RAW_NATIVE_TEST, IS_REMOTE_NATIVE_TEST } from '../../constants';
import { closeActiveWindows, initialize, IS_CI_SERVER } from '../../initialize';
import { openNotebook } from '../helpers';
import {
    assertHasTextOutputInVSCode,
    canRunNotebookTests,
    closeNotebooksAndCleanUpAfterTests,
    createTemporaryNotebook,
    deleteAllCellsAndWait,
    executeActiveDocument,
    insertCodeCell,
    startJupyterServer,
    trustAllNotebooks,
    waitForExecutionCompletedSuccessfully,
    waitForKernelToChange,
    waitForKernelToGetAutoSelected
} from './helper';

/* eslint-disable no-invalid-this, , , @typescript-eslint/no-explicit-any */
suite('DataScience - VSCode Notebook - Kernel Selection', function () {
    const disposables: IDisposable[] = [];
    const templateIPynbFile = path.join(
        EXTENSION_ROOT_DIR_FOR_TESTS,
        'src/test/datascience/notebook/nbWithKernel.ipynb'
    );
    const templateEmptyPython = path.join(
        EXTENSION_ROOT_DIR_FOR_TESTS,
        'src/test/datascience/notebook/emptyPython.ipynb'
    );
    const executable = getOSType() === OSType.Windows ? 'Scripts/python.exe' : 'bin/python'; // If running locally on Windows box.
    const venvNoKernelPython = path.join(
        EXTENSION_ROOT_DIR_FOR_TESTS,
        'src/test/datascience/.venvnokernel',
        executable
    );
    const venvKernelPython = path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src/test/datascience/.venvkernel', executable);
    const venvNoRegPath = path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src/test/datascience/.venvnoreg', executable);

    let nbFile1: string;
    let emptyPythonNb: string;
    let api: IExtensionTestApi;
    let editorProvider: INotebookEditorProvider;
    let activeInterpreterPath: string;
    let venvNoKernelPythonPath: string;
    let venvKernelPythonPath: string;
    let venvNoRegPythonPath: string;
    let vscodeNotebook: IVSCodeNotebook;
    this.timeout(60_000); // Slow test, we need to uninstall/install ipykernel.
    /*
    This test requires a virtual environment to be created & registered as a kernel.
    It also needs to have ipykernel installed in it.
    */
    suiteSetup(async function () {
        this.timeout(120_000);
        // These are slow tests, hence lets run only on linux on CI.
        if (
            (IS_CI_SERVER && getOSType() !== OSType.Linux) ||
            !fs.pathExistsSync(venvNoKernelPython) ||
            !fs.pathExistsSync(venvKernelPython) ||
            !fs.pathExistsSync(venvNoRegPath)
        ) {
            // Virtual env does not exist.
            return this.skip();
        }
        api = await initialize();
        if (!(await canRunNotebookTests())) {
            return this.skip();
        }

        const pythonChecker = api.serviceContainer.get<IPythonExtensionChecker>(IPythonExtensionChecker);
        editorProvider = api.serviceContainer.get<INotebookEditorProvider>(INotebookEditorProvider);
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);

        if (!pythonChecker.isPythonExtensionInstalled) {
            return this.skip();
        }

        const interpreterService = api.serviceContainer.get<IInterpreterService>(IInterpreterService);
        const [activeInterpreter, interpreter1, interpreter2, interpreter3] = await Promise.all([
            interpreterService.getActiveInterpreter(),
            interpreterService.getInterpreterDetails(venvNoKernelPython),
            interpreterService.getInterpreterDetails(venvKernelPython),
            interpreterService.getInterpreterDetails(venvNoRegPath)
        ]);
        if (!activeInterpreter || !interpreter1 || !interpreter2 || !interpreter3) {
            throw new Error('Unable to get information for interpreter 1');
        }
        activeInterpreterPath = activeInterpreter?.path;
        venvNoKernelPythonPath = interpreter1.path;
        venvKernelPythonPath = interpreter2.path;
        venvNoRegPythonPath = interpreter3.path;

        await trustAllNotebooks();
        await startJupyterServer();
        sinon.restore();
    });

    setup(async function () {
        console.log(`Start test ${this.currentTest?.title}`);
        // Don't use same file (due to dirty handling, we might save in dirty.)
        // Coz we won't save to file, hence extension will backup in dirty file and when u re-open it will open from dirty.
        nbFile1 = await createTemporaryNotebook(templateIPynbFile, disposables);
        emptyPythonNb = await createTemporaryNotebook(templateEmptyPython, disposables);
        // Ensure IPykernel is in all environments.
        const proc = new ProcessService(new BufferDecoder());
        await Promise.all([
            proc.exec(venvNoKernelPython, ['-m', 'pip', 'install', 'ipykernel']),
            proc.exec(venvKernelPython, ['-m', 'pip', 'install', 'ipykernel']),
            proc.exec(venvNoRegPythonPath, ['-m', 'pip', 'install', 'ipykernel']),
            closeActiveWindows()
        ]);
        sinon.restore();
        console.log(`Start Test completed ${this.currentTest?.title}`);
    });
    teardown(async function () {
        console.log(`End test ${this.currentTest?.title}`);
        await closeNotebooksAndCleanUpAfterTests(disposables);
        console.log(`End test completed ${this.currentTest?.title}`);
    });

    test('Ensure we select active interpreter as kernel (when Raw Kernels)', async function () {
        if (IS_NON_RAW_NATIVE_TEST || IS_REMOTE_NATIVE_TEST) {
            return this.skip();
        }
        await editorProvider.open(Uri.file(emptyPythonNb));
        await waitForKernelToGetAutoSelected(undefined);
        await deleteAllCellsAndWait();
        await insertCodeCell('import sys\nsys.executable', { index: 0 });

        // Run all cells
        await executeActiveDocument();
        const cell = vscodeNotebook.activeNotebookEditor?.document.cells![0]!;
        await waitForExecutionCompletedSuccessfully(cell);

        // Confirm the executable printed as a result of code in cell `import sys;sys.executable`
        assertHasTextOutputInVSCode(cell, activeInterpreterPath, 0, false);
    });
    test('Ensure kernel is auto selected and interpreter is as expected', async function () {
        await openNotebook(api.serviceContainer, nbFile1);
        await waitForKernelToGetAutoSelected(undefined);

        // Run all cells
        await executeActiveDocument();
        const cell = vscodeNotebook.activeNotebookEditor?.document.cells![0]!;
        await waitForExecutionCompletedSuccessfully(cell);

        // Confirm the executable printed as a result of code in cell `import sys;sys.executable`
        assertHasTextOutputInVSCode(cell, venvNoKernelPythonPath, 0, false);
    });
    test('Switch kernel to a registered kernelspec', async function () {
        await openNotebook(api.serviceContainer, nbFile1);
        await waitForKernelToGetAutoSelected(undefined);

        // Run all cells
        await executeActiveDocument();
        const cell = vscodeNotebook.activeNotebookEditor?.document.cells![0]!;
        await waitForExecutionCompletedSuccessfully(cell);

        // Confirm the executable printed as a result of code in cell `import sys;sys.executable`
        assertHasTextOutputInVSCode(cell, venvNoKernelPythonPath, 0, false);

        // Change kernel
        await waitForKernelToChange({ labelOrId: '.venvkernel' });

        // Clear the cells & execute again
        await commands.executeCommand('notebook.clearAllCellsOutputs');
        await waitForCondition(async () => cell.outputs.length === 0, 5_000, 'Cell did not get cleared');
        await executeActiveDocument();
        await waitForExecutionCompletedSuccessfully(cell);

        // Confirm the executable printed as a result of code in cell `import sys;sys.executable`
        assertHasTextOutputInVSCode(cell, venvKernelPythonPath, 0, false);
    });
    test('Switch kernel to an interpreter that is registered as a kernel', async function () {
        // Test only applies for Raw & Jupyter notebooks.
        if (IS_REMOTE_NATIVE_TEST) {
            return this.skip();
        }
        await editorProvider.open(Uri.file(emptyPythonNb));
        await waitForKernelToGetAutoSelected(undefined);
        await deleteAllCellsAndWait();
        await insertCodeCell('import sys\nsys.executable', { index: 0 });

        // Run all cells
        await executeActiveDocument();
        const cell = vscodeNotebook.activeNotebookEditor?.document.cells![0]!;
        await waitForExecutionCompletedSuccessfully(cell);

        // Confirm the executable printed is not venvkernel
        assert.ok(cell.outputs.length);
        const outputText: string = (cell.outputs[0] as CellDisplayOutput).data['text/plain'].trim();
        assert.equal(outputText.toLowerCase().indexOf(venvKernelPythonPath), -1);

        // Change kernel to the interpreter venvkernel
        await waitForKernelToChange({ interpreterPath: venvKernelPythonPath });

        // Clear the cells & execute again
        await commands.executeCommand('notebook.clearAllCellsOutputs');
        await waitForCondition(async () => cell.outputs.length === 0, 5_000, 'Cell did not get cleared');
        await executeActiveDocument();
        await waitForExecutionCompletedSuccessfully(cell);

        // Confirm the executable printed as a result of code in cell `import sys;sys.executable`
        assertHasTextOutputInVSCode(cell, venvKernelPythonPath, 0, false);
    });
    test('Switch kernel to an interpreter that is not registered as a kernel', async function () {
        // Test only applies for raw notebooks.
        if (IS_NON_RAW_NATIVE_TEST || IS_REMOTE_NATIVE_TEST) {
            return this.skip();
        }
        await editorProvider.open(Uri.file(emptyPythonNb));
        await waitForKernelToGetAutoSelected(undefined);
        await deleteAllCellsAndWait();
        await insertCodeCell('import sys\nsys.executable', { index: 0 });

        // Run all cells
        await executeActiveDocument();

        const cell = vscodeNotebook.activeNotebookEditor?.document.cells![0]!;
        await waitForExecutionCompletedSuccessfully(cell);

        // Confirm the executable printed is not venvNoReg
        assert.ok(cell.outputs.length);
        const outputText: string = (cell.outputs[0] as CellDisplayOutput).data['text/plain'].trim();
        assert.equal(outputText.toLowerCase().indexOf(venvNoRegPythonPath), -1);

        // Change kernel to the interpreter venvNoReg
        await waitForKernelToChange({ interpreterPath: venvNoRegPythonPath });

        // Clear the cells & execute again
        await commands.executeCommand('notebook.clearAllCellsOutputs');
        await waitForCondition(async () => cell.outputs.length === 0, 5_000, 'Cell did not get cleared');
        await executeActiveDocument();
        await waitForExecutionCompletedSuccessfully(cell);

        // Confirm the executable printed as a result of code in cell `import sys;sys.executable`
        assertHasTextOutputInVSCode(cell, venvNoRegPythonPath, 0, false);
    });
});
