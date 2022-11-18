// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as path from '../../../../platform/vscode-path/path';
import * as fs from 'fs-extra';
import * as sinon from 'sinon';
import { languages, Uri } from 'vscode';
import { traceInfo } from '../../../../platform/logging';
import { IDisposable } from '../../../../platform/common/types';
import { IInterpreterService } from '../../../../platform/interpreter/contracts';
import { captureScreenShot, IExtensionTestApi, waitForCondition } from '../../../common.node';
import { EXTENSION_ROOT_DIR_FOR_TESTS, IS_REMOTE_NATIVE_TEST } from '../../../constants.node';
import { initialize, IS_CI_SERVER } from '../../../initialize.node';
import {
    closeNotebooksAndCleanUpAfterTests,
    insertCodeCell,
    startJupyterServer,
    prewarmNotebooks,
    createEmptyPythonNotebook,
    waitForKernelToChange,
    waitForDiagnostics,
    defaultNotebookTestTimeout
} from '../helper.node';
import { IVSCodeNotebook } from '../../../../platform/common/application/types';
import { IPythonExecutionFactory } from '../../../../platform/common/process/types.node';
import { PythonEnvironment } from '../../../../platform/pythonEnvironments/info';
import { setIntellisenseTimeout } from '../../../../standalone/intellisense/pythonKernelCompletionProvider';
import { Settings } from '../../../../platform/common/constants';
import { getOSType, OSType } from '../../../../platform/common/utils/platform';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('Intellisense Switch interpreters in a notebook @lsp', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    const executable = getOSType() === OSType.Windows ? 'Scripts/python.exe' : 'bin/python'; // If running locally on Windows box.
    const venvNoKernelPython = Uri.file(
        path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src/test/datascience/.venvnokernel', executable)
    );
    const venvKernelPython = Uri.file(
        path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src/test/datascience/.venvkernel', executable)
    );
    let venvNoKernelPythonPath: Uri;
    let venvKernelPythonPath: Uri;
    let vscodeNotebook: IVSCodeNotebook;

    this.timeout(120_000);
    suiteSetup(async function () {
        traceInfo(`Start Suite Intellisense Switch interpreters in a notebook`);
        this.timeout(120_000);
        api = await initialize();
        if (IS_REMOTE_NATIVE_TEST()) {
            // https://github.com/microsoft/vscode-jupyter/issues/6331
            return this.skip();
        }
        // These are slow tests, hence lets run only on linux on CI.
        if (
            (IS_CI_SERVER && getOSType() !== OSType.Linux) ||
            !fs.pathExistsSync(venvNoKernelPython.fsPath) ||
            !fs.pathExistsSync(venvKernelPython.fsPath)
        ) {
            // Virtual env does not exist.
            return this.skip();
        }
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        const interpreterService = api.serviceContainer.get<IInterpreterService>(IInterpreterService);
        await waitForCondition(
            async () => {
                if ((await interpreterService.getActiveInterpreter()) !== undefined) {
                    return true;
                }
                return false;
            },
            defaultNotebookTestTimeout,
            'Waiting for interpreters to be discovered'
        );

        let lastError: Error | undefined = undefined;
        const [activeInterpreter, interpreter1, interpreter2] = await waitForCondition(
            async () => {
                try {
                    return await Promise.all([
                        interpreterService.getActiveInterpreter(),
                        interpreterService.getInterpreterDetails(venvNoKernelPython),
                        interpreterService.getInterpreterDetails(venvKernelPython)
                    ]);
                } catch (ex) {
                    lastError = ex;
                }
            },
            defaultNotebookTestTimeout,
            () => `Failed to get interpreter information for 1,2 &/or 3, ${lastError?.toString()}`
        );

        if (!activeInterpreter || !interpreter1 || !interpreter2) {
            throw new Error('Unable to get information for interpreter 1');
        }
        venvNoKernelPythonPath = interpreter1.uri;
        venvKernelPythonPath = interpreter2.uri;

        // Make sure to remove pandas from the venvnokernel. This test relies on it.
        const factory = api.serviceContainer.get<IPythonExecutionFactory>(IPythonExecutionFactory);
        const process = await factory.create({ interpreter: { uri: venvNoKernelPythonPath } as PythonEnvironment });
        await process.execModule('pip', ['uninstall', 'pandas'], { throwOnStdErr: false });

        await startJupyterServer();
        await prewarmNotebooks();
        sinon.restore();
        traceInfo(`Start Suite (Completed) Intellisense Switch interpreters in a notebook`);
    });
    // Use same notebook without starting kernel in every single test (use one for whole suite).
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        sinon.restore();
        await startJupyterServer();
        await createEmptyPythonNotebook(disposables);
        setIntellisenseTimeout(30000);
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        setIntellisenseTimeout(Settings.IntellisenseTimeout);
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this);
        }
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));
    test('Check diagnostics with and without an import', async () => {
        // Make sure .venvkernel is selected
        await waitForKernelToChange({ interpreterPath: venvKernelPythonPath });
        let cell = await insertCodeCell('import pandas as pd');

        // There should be 1 diagnostic at the moment
        let diagnostics = await waitForDiagnostics(cell.document.uri);
        assert.isOk(diagnostics, 'No diagnostics found in the first cell');

        // Switch to the other kernel
        await waitForKernelToChange({ interpreterPath: venvNoKernelPythonPath });

        // Wait for an error to show up
        cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;
        await waitForCondition(
            async () => {
                diagnostics = languages.getDiagnostics(cell.document.uri);
                return diagnostics && diagnostics.length > 1;
            },
            defaultNotebookTestTimeout,
            `Diagnostics did not change after switching kernels`
        );

        // Switch back to the first kernel.
        await waitForKernelToChange({ interpreterPath: venvKernelPythonPath });

        // Now there should be 1 error again
        cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;
        await waitForCondition(
            async () => {
                diagnostics = languages.getDiagnostics(cell.document.uri);
                return diagnostics && diagnostics.length == 1;
            },
            defaultNotebookTestTimeout,
            `Diagnostics did not change after switching back`
        );
    });
});
