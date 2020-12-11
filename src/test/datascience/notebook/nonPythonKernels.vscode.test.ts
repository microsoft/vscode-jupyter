// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

// tslint:disable:no-require-imports no-var-requires
import * as path from 'path';
import * as sinon from 'sinon';
import { Uri } from 'vscode';
import { IPythonExtensionChecker } from '../../../client/api/types';
import { IVSCodeNotebook } from '../../../client/common/application/types';
import { traceInfo, traceInfoIf } from '../../../client/common/logger';
import { IDisposable } from '../../../client/common/types';
import { VSCodeNotebookProvider } from '../../../client/datascience/constants';
import { NotebookCellLanguageService } from '../../../client/datascience/notebook/defaultCellLanguageService';
import { INotebookEditorProvider } from '../../../client/datascience/types';
import { IExtensionTestApi, waitForCondition } from '../../common';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../constants';
import { initialize } from '../../initialize';
import { openNotebook } from '../helpers';
import {
    assertHasTextOutputInVSCode,
    canRunNotebookTests,
    closeNotebooks,
    closeNotebooksAndCleanUpAfterTests,
    createTemporaryNotebook,
    executeActiveDocument,
    insertCodeCell,
    insertMarkdownCell,
    saveActiveNotebook,
    trustAllNotebooks,
    waitForExecutionCompletedSuccessfully,
    waitForKernelToGetAutoSelected
} from './helper';

// tslint:disable: no-any no-invalid-this
suite('DataScience - VSCode Notebook - Kernels (non-python-kernel) (slow)', () => {
    const juliaNb = path.join(
        EXTENSION_ROOT_DIR_FOR_TESTS,
        'src',
        'test',
        'datascience',
        'notebook',
        'simpleJulia.ipynb'
    );
    const csharpNb = path.join(
        EXTENSION_ROOT_DIR_FOR_TESTS,
        'src',
        'test',
        'datascience',
        'notebook',
        'simpleCSharp.ipynb'
    );
    const javaNb = path.join(
        EXTENSION_ROOT_DIR_FOR_TESTS,
        'src',
        'test',
        'datascience',
        'notebook',
        'simpleJavaBeakerX.ipynb'
    );

    const emptyPythonNb = path.join(
        EXTENSION_ROOT_DIR_FOR_TESTS,
        'src',
        'test',
        'datascience',
        'notebook',
        'emptyPython.ipynb'
    );

    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
    let testJuliaNb: Uri;
    let testJavaNb: Uri;
    let testCSharpNb: Uri;
    let testEmptyPythonNb: Uri;
    let editorProvider: INotebookEditorProvider;
    let languageService: NotebookCellLanguageService;
    const testJavaKernels = (process.env.VSC_JUPYTER_CI_RUN_JAVA_NB_TEST || '').toLowerCase() === 'true';
    suiteSetup(async function () {
        api = await initialize();
        if (!process.env.VSC_JUPYTER_CI_RUN_NON_PYTHON_NB_TEST || !(await canRunNotebookTests())) {
            return this.skip();
        }
        await trustAllNotebooks();
        sinon.restore();
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        editorProvider = api.serviceContainer.get<INotebookEditorProvider>(VSCodeNotebookProvider);
        languageService = api.serviceContainer.get<NotebookCellLanguageService>(NotebookCellLanguageService);
    });
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        sinon.restore();
        await closeNotebooks();
        // Don't use same file (due to dirty handling, we might save in dirty.)
        // Coz we won't save to file, hence extension will backup in dirty file and when u re-open it will open from dirty.
        testJuliaNb = Uri.file(await createTemporaryNotebook(juliaNb, disposables));
        testJavaNb = Uri.file(await createTemporaryNotebook(javaNb, disposables));
        testCSharpNb = Uri.file(await createTemporaryNotebook(csharpNb, disposables));
        testEmptyPythonNb = Uri.file(await createTemporaryNotebook(emptyPythonNb, disposables));
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async () => {
        process.env.VSC_CI_ENABLE_TOO_MUCH_LOGGING = undefined;
        process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT = undefined;
        await closeNotebooksAndCleanUpAfterTests(disposables);
    });
    test('Automatically pick java kernel when opening a Java Notebook', async function () {
        if (!testJavaKernels) {
            return this.skip();
        }
        await openNotebook(api.serviceContainer, testJavaNb.fsPath);
        await waitForKernelToGetAutoSelected('java');
    });
    test('Automatically pick julia kernel when opening a Julia Notebook', async () => {
        await openNotebook(api.serviceContainer, testJuliaNb.fsPath);
        await waitForKernelToGetAutoSelected('julia');
    });
    test('Automatically pick csharp kernel when opening a csharp notebook', async function () {
        // The .NET interactive CLI does not work if you do not have Jupyter installed.
        // We install Jupyter on CI when we have tests with Python extension.
        // Hence if python extension is not installed, then assume jupyter is not installed on CI.
        // Meaning, no python extension, no jupyter, hence no .NET kernel either.
        const pythonChecker = api.serviceContainer.get<IPythonExtensionChecker>(IPythonExtensionChecker);
        if (!pythonChecker.isPythonExtensionInstalled) {
            return this.skip();
        }
        process.env.VSC_CI_ENABLE_TOO_MUCH_LOGGING = 'true';
        traceInfoIf(!!process.env.VSC_CI_ENABLE_TOO_MUCH_LOGGING, '1. Open Notebook');
        await openNotebook(api.serviceContainer, testCSharpNb.fsPath);
        traceInfoIf(!!process.env.VSC_CI_ENABLE_TOO_MUCH_LOGGING, '2. Wait for kernel to get selected');
        await waitForKernelToGetAutoSelected('c#');
    });
    test('New notebook will have a Julia cell if last notebook was a julia nb', async () => {
        await openNotebook(api.serviceContainer, testJuliaNb.fsPath);
        await waitForKernelToGetAutoSelected();
        await insertMarkdownCell('# Hello');
        await saveActiveNotebook([]);

        // Add another cell, to ensure changes are detected by our code.
        await insertMarkdownCell('# Hello');
        await saveActiveNotebook([]);
        await closeNotebooks();

        // Wait for the default cell language to change.
        await waitForCondition(
            async () => languageService.getPreferredLanguage().toLowerCase() === 'julia',
            10_000,
            'Default cell language is not Julia'
        );
        // Create a blank notebook & confirm we have a julia code cell & julia kernel.
        await editorProvider.createNew();

        await waitForCondition(
            async () => vscodeNotebook.activeNotebookEditor?.document.cells[0].language.toLowerCase() === 'julia',
            5_000,
            'First cell is not julia'
        );
        await waitForKernelToGetAutoSelected('julia');

        // Lets try opening a python nb & validate that.
        await closeNotebooks();

        const pythonChecker = api.serviceContainer.get<IPythonExtensionChecker>(IPythonExtensionChecker);
        if (pythonChecker.isPythonExtensionInstalled) {
            // Now open an existing python notebook & confirm kernel is set to Python.
            await openNotebook(api.serviceContainer, testEmptyPythonNb.fsPath);
            await waitForKernelToGetAutoSelected('python');
        }
    });
    test('Can run a Julia notebook', async function () {
        this.timeout(30_000); // Can be slow to start Julia kernel on CI.
        await openNotebook(api.serviceContainer, testJuliaNb.fsPath);
        await insertCodeCell('123456', { language: 'julia', index: 0 });
        await waitForKernelToGetAutoSelected('julia');
        await executeActiveDocument();

        const cell = vscodeNotebook.activeNotebookEditor?.document.cells![0]!;
        // Wait till execution count changes and status is success.
        await waitForExecutionCompletedSuccessfully(cell);

        assertHasTextOutputInVSCode(cell, '123456', 0, false);
    });
    test('Can run a CSharp notebook', async function () {
        // C# Kernels can only be installed when you have Jupyter
        // On CI we install Jupyter only when testing with Python extension.
        const pythonChecker = api.serviceContainer.get<IPythonExtensionChecker>(IPythonExtensionChecker);
        if (!pythonChecker.isPythonExtensionInstalled) {
            return this.skip();
        }
        process.env.VSC_CI_ENABLE_TOO_MUCH_LOGGING = 'true';
        process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT = 'true';
        this.timeout(30_000); // Can be slow to start csharp kernel on CI.
        await openNotebook(api.serviceContainer, testCSharpNb.fsPath);
        traceInfo('1. Notebook opened');
        await waitForKernelToGetAutoSelected('c#');
        traceInfo('2. Kernel Selected');
        await executeActiveDocument();
        traceInfo('3. Document executed');

        const cell = vscodeNotebook.activeNotebookEditor?.document.cells![0]!;
        // Wait till execution count changes and status is success.
        traceInfo('4. Waiting for completion of cell');
        await waitForExecutionCompletedSuccessfully(cell);
        traceInfo('5. Cell executed');

        assertHasTextOutputInVSCode(cell, 'Hello', 0, false);
    });
    test('Can run a Java notebook', async function () {
        // Disabled, as activation of conda environments doesn't work on CI in Python extension.
        // As a result we cannot get env variables of conda environments.
        // This test requires PATH be set to conda environment that owns the jupyter kernel.
        return this.skip();
        if (!testJavaKernels) {
            return this.skip();
        }
        this.timeout(30_000); // In case starting Java kernel is slow on CI (we know julia is slow).
        await openNotebook(api.serviceContainer, testJavaNb.fsPath);
        await waitForKernelToGetAutoSelected('java');
        await executeActiveDocument();

        const cell = vscodeNotebook.activeNotebookEditor?.document.cells![0]!;
        // Wait till execution count changes and status is success.
        await waitForExecutionCompletedSuccessfully(cell);

        assertHasTextOutputInVSCode(cell, 'Hello', 0, false);
    });
});
