// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import assert from 'assert';
import * as sinon from 'sinon';
import { Uri } from 'vscode';
import { IKernelProvider } from '../../../kernels/types';
import { IControllerRegistration } from '../../../notebooks/controllers/types';
import { PythonExtensionChecker } from '../../../platform/api/pythonApi';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { IDisposable } from '../../../platform/common/types';
import { traceInfo } from '../../../platform/logging';
import * as path from '../../../platform/vscode-path/path';
import { IExtensionTestApi, waitForCondition } from '../../common.node';
import { EXTENSION_ROOT_DIR_FOR_TESTS, IS_NON_RAW_NATIVE_TEST, IS_REMOTE_NATIVE_TEST } from '../../constants.node';
import { noop } from '../../core';
import { initialize } from '../../initialize.node';
import { ControllerPreferredService } from './controllerPreferredService';
import { TestNotebookDocument, createKernelController } from './executionHelper';
import {
    closeNotebooks,
    closeNotebooksAndCleanUpAfterTests,
    createTemporaryNotebookFromFile,
    defaultNotebookTestTimeout,
    waitForExecutionCompletedSuccessfully,
    waitForTextOutput
} from './helper.node';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('Non-Python Kernel @nonPython ', async function () {
    const juliaNb = Uri.file(
        path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'test', 'datascience', 'notebook', 'simpleJulia.ipynb')
    );
    const csharpNb = Uri.file(
        path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'test', 'datascience', 'notebook', 'simpleCSharp.ipynb')
    );

    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let testJuliaNb: Uri;
    let testCSharpNb: Uri;
    let controllerPreferred: ControllerPreferredService;
    let kernelProvider: IKernelProvider;
    let pythonChecker: IPythonExtensionChecker;
    let controllerRegistration: IControllerRegistration;
    this.timeout(120_000); // Julia and C# kernels can be slow
    suiteSetup(async function () {
        this.timeout(120_000);
        api = await initialize();
        verifyPromptWasNotDisplayed();
        if (
            // eslint-disable-next-line local-rules/dont-use-process
            !process.env.VSC_JUPYTER_CI_RUN_NON_PYTHON_NB_TEST ||
            IS_REMOTE_NATIVE_TEST() ||
            IS_NON_RAW_NATIVE_TEST()
        ) {
            return this.skip();
        }
        sinon.restore();
        verifyPromptWasNotDisplayed();
        controllerPreferred = ControllerPreferredService.create(api.serviceContainer);
        controllerRegistration = api.serviceContainer.get<IControllerRegistration>(IControllerRegistration);
        kernelProvider = api.serviceContainer.get<IKernelProvider>(IKernelProvider);
        pythonChecker = api.serviceContainer.get<IPythonExtensionChecker>(IPythonExtensionChecker);
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
        testCSharpNb = await createTemporaryNotebookFromFile(csharpNb, disposables);
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async () => {
        verifyPromptWasNotDisplayed();
        await closeNotebooksAndCleanUpAfterTests(disposables);
    });
    // https://github.com/microsoft/vscode-jupyter/issues/10900
    test('Automatically pick julia kernel when opening a Julia Notebook', async () => {
        const notebook = await TestNotebookDocument.openFile(testJuliaNb);
        await waitForCondition(
            async () => {
                const preferredController = await controllerPreferred.computePreferred(notebook);
                if (
                    preferredController.preferredConnection?.kind === 'startUsingLocalKernelSpec' &&
                    preferredController.preferredConnection.kernelSpec.language === 'julia'
                ) {
                    return preferredController.preferredConnection;
                }
            },
            defaultNotebookTestTimeout,
            `Preferred controller not found for Notebook, currently preferred ${controllerPreferred.getPreferred(
                notebook
            )?.connection.kind}:${controllerPreferred.getPreferred(notebook)?.connection.id}`,
            500
        );
    });
    test('Automatically pick csharp kernel when opening a csharp notebook', async function () {
        // C# Kernels can only be installed when you have Jupyter
        // On CI we install Jupyter only when testing with Python extension.
        if (!pythonChecker.isPythonExtensionInstalled) {
            return this.skip();
        }

        const notebook = await TestNotebookDocument.openFile(testCSharpNb);
        await waitForCondition(
            async () => {
                const preferredController = await controllerPreferred.computePreferred(notebook);
                if (
                    preferredController.preferredConnection?.kind === 'startUsingLocalKernelSpec' &&
                    preferredController.preferredConnection.kernelSpec.language === 'C#'
                ) {
                    return preferredController.preferredConnection;
                }
            },
            defaultNotebookTestTimeout,
            `Preferred controller not found for Notebook, currently preferred ${controllerPreferred.getPreferred(
                notebook
            )?.connection.kind}:${controllerPreferred.getPreferred(notebook)?.connection
                .id}, current controllers include ${controllerRegistration.all
                .map(
                    (item) =>
                        `${item.kind}:${item.id}(${
                            item.kind === 'startUsingLocalKernelSpec' ? item.kernelSpec.language : ''
                        })`
                )
                .join(',')}`,
            500
        );
    });
    test('Bogus test', noop);
    test('Can run a Julia notebook', async function () {
        const notebook = await TestNotebookDocument.openFile(testJuliaNb);
        const metadata = await waitForCondition(
            async () => {
                const preferredController = await controllerPreferred.computePreferred(notebook);
                if (
                    preferredController.preferredConnection?.kind === 'startUsingLocalKernelSpec' &&
                    preferredController.preferredConnection.kernelSpec.language === 'julia'
                ) {
                    return preferredController.preferredConnection;
                }
            },
            defaultNotebookTestTimeout,
            `Preferred controller not found for Notebook, currently preferred ${controllerPreferred.getPreferred(
                notebook
            )?.connection.kind}:${controllerPreferred.getPreferred(notebook)?.connection.id}`,
            500
        );
        const cell = await notebook.appendCodeCell('123456', 'julia');
        const kernel = kernelProvider.getOrCreate(notebook, {
            controller: createKernelController(),
            metadata,
            resourceUri: notebook.uri
        });
        const kernelExecution = kernelProvider.getKernelExecution(kernel);
        // Wait till execution count changes and status is success.
        await Promise.all([
            kernelExecution.executeCell(cell),
            waitForExecutionCompletedSuccessfully(cell, 60_000),
            waitForTextOutput(cell, '123456', 0, false)
        ]);
    });
    test('Can run a CSharp notebook', async function () {
        // C# Kernels can only be installed when you have Jupyter
        // On CI we install Jupyter only when testing with Python extension.
        if (!pythonChecker.isPythonExtensionInstalled) {
            return this.skip();
        }

        const notebook = await TestNotebookDocument.openFile(testCSharpNb);
        const metadata = await waitForCondition(
            async () => {
                const preferredController = await controllerPreferred.computePreferred(notebook);
                if (
                    preferredController.preferredConnection?.kind === 'startUsingLocalKernelSpec' &&
                    preferredController.preferredConnection.kernelSpec.language === 'C#'
                ) {
                    return preferredController.preferredConnection;
                }
            },
            defaultNotebookTestTimeout,
            `Preferred controller not found for Notebook, currently preferred ${controllerPreferred.getPreferred(
                notebook
            )?.connection.kind}:${controllerPreferred.getPreferred(notebook)?.connection.id}`,
            500
        );
        const kernel = kernelProvider.getOrCreate(notebook, {
            controller: createKernelController(),
            metadata,
            resourceUri: notebook.uri
        });
        const kernelExecution = kernelProvider.getKernelExecution(kernel);

        const cell = notebook.cellAt(0);
        // Wait till execution count changes and status is success.
        await Promise.all([kernelExecution.executeCell(cell), waitForExecutionCompletedSuccessfully(cell)]);

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
