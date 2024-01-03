// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import assert from 'assert';
import * as sinon from 'sinon';
import { Uri } from 'vscode';
import { IKernelProvider } from '../../../kernels/types';
import { PythonExtensionChecker } from '../../../platform/api/pythonApi';
import { IDisposable } from '../../../platform/common/types';
import { traceInfo } from '../../../platform/logging';
import * as path from '../../../platform/vscode-path/path';
import { IExtensionTestApi, waitForCondition } from '../../common.node';
import { EXTENSION_ROOT_DIR_FOR_TESTS, IS_NON_RAW_NATIVE_TEST, IS_REMOTE_NATIVE_TEST } from '../../constants.node';
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
    const denoNb = Uri.file(
        path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'test', 'datascience', 'notebook', 'simpleDeno.ipynb')
    );

    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let testDenoNb: Uri;
    let controllerPreferred: ControllerPreferredService;
    let kernelProvider: IKernelProvider;
    suiteSetup(async function () {
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
        kernelProvider = api.serviceContainer.get<IKernelProvider>(IKernelProvider);
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
        testDenoNb = await createTemporaryNotebookFromFile(denoNb, disposables);
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async () => {
        verifyPromptWasNotDisplayed();
        await closeNotebooksAndCleanUpAfterTests(disposables);
    });
    // https://github.com/microsoft/vscode-jupyter/issues/10900
    test('Automatically pick Deno kernel when opening a Deno Notebook', async () => {
        const notebook = await TestNotebookDocument.openFile(testDenoNb);
        await waitForCondition(
            async () => {
                const preferredController = await controllerPreferred.computePreferred(notebook);
                if (
                    preferredController.preferredConnection?.kind === 'startUsingLocalKernelSpec' &&
                    preferredController.preferredConnection.kernelSpec.language === 'typescript'
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
    test('Can run a Deno notebook', async function () {
        const notebook = await TestNotebookDocument.openFile(testDenoNb);
        const metadata = await waitForCondition(
            async () => {
                const preferredController = await controllerPreferred.computePreferred(notebook);
                if (
                    preferredController.preferredConnection?.kind === 'startUsingLocalKernelSpec' &&
                    preferredController.preferredConnection.kernelSpec.language === 'typescript'
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
        const cell = await notebook.appendCodeCell('123456', 'typescript');
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
});
