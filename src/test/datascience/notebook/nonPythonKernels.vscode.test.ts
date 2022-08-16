// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import * as path from '../../../platform/vscode-path/path';
import * as sinon from 'sinon';
import assert from 'assert';
import { Uri } from 'vscode';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { IVSCodeNotebook } from '../../../platform/common/application/types';
import { traceInfo } from '../../../platform/logging';
import { IDisposable } from '../../../platform/common/types';
import { IExtensionTestApi, waitForCondition } from '../../common.node';
import { EXTENSION_ROOT_DIR_FOR_TESTS, IS_REMOTE_NATIVE_TEST, IS_NON_RAW_NATIVE_TEST } from '../../constants.node';
import { initialize } from '../../initialize.node';
import { openNotebook } from '../helpers.node';
import {
    closeNotebooks,
    closeNotebooksAndCleanUpAfterTests,
    runAllCellsInActiveNotebook,
    runCell,
    insertCodeCell,
    insertMarkdownCell,
    saveActiveNotebook,
    waitForExecutionCompletedSuccessfully,
    waitForKernelToGetAutoSelected,
    waitForTextOutput,
    createTemporaryNotebookFromFile
} from './helper.node';
import { PythonExtensionChecker } from '../../../platform/api/pythonApi';
import { NotebookCellLanguageService } from '../../../notebooks/languages/cellLanguageService';
import { INotebookEditorProvider } from '../../../notebooks/types';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataScience - VSCode Notebook - Kernels (non-python-kernel) (slow)', () => {
    const juliaNb = Uri.file(
        path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'test', 'datascience', 'notebook', 'simpleJulia.ipynb')
    );
    const csharpNb = Uri.file(
        path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'test', 'datascience', 'notebook', 'simpleCSharp.ipynb')
    );
    const javaNb = Uri.file(
        path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'test', 'datascience', 'notebook', 'simpleJavaBeakerX.ipynb')
    );

    const emptyPythonNb = Uri.file(
        path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'test', 'datascience', 'notebook', 'emptyPython.ipynb')
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
    // eslint-disable-next-line local-rules/dont-use-process
    const testJavaKernels = (process.env.VSC_JUPYTER_CI_RUN_JAVA_NB_TEST || '').toLowerCase() === 'true';
    suiteSetup(async function () {
        api = await initialize();
        verifyPromptWasNotDisplayed();
        // eslint-disable-next-line local-rules/dont-use-process
        if (!process.env.VSC_JUPYTER_CI_RUN_NON_PYTHON_NB_TEST || IS_REMOTE_NATIVE_TEST() || IS_NON_RAW_NATIVE_TEST()) {
            return this.skip();
        }
        sinon.restore();
        verifyPromptWasNotDisplayed();
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        editorProvider = api.serviceContainer.get<INotebookEditorProvider>(INotebookEditorProvider);
        languageService = api.serviceContainer.get<NotebookCellLanguageService>(NotebookCellLanguageService);
    });
    function verifyPromptWasNotDisplayed() {
        assert.strictEqual(
            PythonExtensionChecker.promptDisplayed,
            undefined,
            'Prompt for requiring Python Extension should not have been displayed'
        );
    }
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        sinon.restore();
        await closeNotebooks();
        // Don't use same file (due to dirty handling, we might save in dirty.)
        // Coz we won't save to file, hence extension will backup in dirty file and when u re-open it will open from dirty.
        testJuliaNb = await createTemporaryNotebookFromFile(juliaNb, disposables);
        testJavaNb = await createTemporaryNotebookFromFile(javaNb, disposables);
        testCSharpNb = await createTemporaryNotebookFromFile(csharpNb, disposables);
        testEmptyPythonNb = await createTemporaryNotebookFromFile(emptyPythonNb, disposables);
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async () => {
        verifyPromptWasNotDisplayed();
        await closeNotebooksAndCleanUpAfterTests(disposables);
    });
    // https://github.com/microsoft/vscode-jupyter/issues/10900
    test.skip('Automatically pick java kernel when opening a Java Notebook', async function () {
        if (!testJavaKernels) {
            return this.skip();
        }
        const { editor } = await openNotebook(testJavaNb);
        await waitForKernelToGetAutoSelected(editor, 'java');
    });
    test('Automatically pick julia kernel when opening a Julia Notebook', async () => {
        const { editor } = await openNotebook(testJuliaNb);
        await waitForKernelToGetAutoSelected(editor, 'julia');
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
        const { editor } = await openNotebook(testCSharpNb);
        await waitForKernelToGetAutoSelected(editor, 'c#');
    });
    test('New notebook will have a Julia cell if last notebook was a julia nb', async function () {
        return this.skip();
        await openNotebook(testJuliaNb);
        await waitForKernelToGetAutoSelected();
        await insertMarkdownCell('# Hello');
        await saveActiveNotebook();

        // Add another cell, to ensure changes are detected by our code.
        await insertMarkdownCell('# Hello');
        await saveActiveNotebook();
        await closeNotebooks();

        // Wait for the default cell language to change.
        await waitForCondition(
            async () => languageService.getPreferredLanguage().toLowerCase() === 'julia',
            10_000,
            `Default cell language is not Julia, it is ${languageService.getPreferredLanguage().toLowerCase()}`
        );
        // Create a blank notebook & confirm we have a julia code cell & julia kernel.
        await editorProvider.createNew();

        await waitForCondition(
            async () =>
                vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0).document.languageId.toLowerCase() === 'julia',
            5_000,
            `First cell is not julia, it is ${vscodeNotebook.activeNotebookEditor?.notebook
                .cellAt(0)
                .document.languageId.toLowerCase()}`
        );
        await waitForKernelToGetAutoSelected(undefined, 'julia');

        // Lets try opening a python nb & validate that.
        await closeNotebooks();

        const pythonChecker = api.serviceContainer.get<IPythonExtensionChecker>(IPythonExtensionChecker);
        if (pythonChecker.isPythonExtensionInstalled) {
            // Now open an existing python notebook & confirm kernel is set to Python.
            const { editor } = await openNotebook(testEmptyPythonNb);
            await waitForKernelToGetAutoSelected(editor, 'python');
        }
    });
    test('Can run a Julia notebook', async function () {
        this.timeout(60_000); // Can be slow to start Julia kernel on CI.
        const { editor } = await openNotebook(testJuliaNb);
        await waitForKernelToGetAutoSelected(editor, 'julia');
        await insertCodeCell('123456', { language: 'julia', index: 0 });
        const cell = editor.notebook.cellAt(0)!;
        // Wait till execution count changes and status is success.
        await Promise.all([
            runCell(cell),
            waitForExecutionCompletedSuccessfully(cell, 60_000),
            waitForTextOutput(cell, '123456', 0, false)
        ]);
    });
    test('Can run a CSharp notebook', async function () {
        // C# Kernels can only be installed when you have Jupyter
        // On CI we install Jupyter only when testing with Python extension.
        const pythonChecker = api.serviceContainer.get<IPythonExtensionChecker>(IPythonExtensionChecker);
        if (!pythonChecker.isPythonExtensionInstalled) {
            return this.skip();
        }
        this.timeout(30_000); // Can be slow to start csharp kernel on CI.
        const { editor } = await openNotebook(testCSharpNb);
        await waitForKernelToGetAutoSelected(editor, 'c#');
        await runAllCellsInActiveNotebook();

        const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;
        // Wait till execution count changes and status is success.
        await waitForExecutionCompletedSuccessfully(cell);

        // For some reason C# kernel sends multiple outputs.
        // First output can contain `text/html` with some Jupyter UI specific stuff.
        try {
            traceInfo(`Cell output length ${cell.outputs.length}`);
            await waitForTextOutput(cell, 'Hello', 0, false, 5_000);
        } catch (ex) {
            if (cell.outputs.length > 1) {
                await waitForTextOutput(cell, 'Hello', 1, false);
            } else {
                throw ex;
            }
        }
    });
});
