// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as sinon from 'sinon';
import { languages } from 'vscode';
import { traceInfo } from '../../../../client/common/logger';
import { IDisposable } from '../../../../client/common/types';
import { IInterpreterService } from '../../../../client/interpreter/contracts';
import { captureScreenShot, getOSType, IExtensionTestApi, OSType, waitForCondition } from '../../../common';
import { EXTENSION_ROOT_DIR_FOR_TESTS, IS_REMOTE_NATIVE_TEST } from '../../../constants';
import { initialize, IS_CI_SERVER } from '../../../initialize';
import {
    canRunNotebookTests,
    closeNotebooksAndCleanUpAfterTests,
    insertCodeCell,
    startJupyterServer,
    prewarmNotebooks,
    createEmptyPythonNotebook,
    waitForKernelToChange,
    waitForDiagnostics,
    defaultNotebookTestTimeout,
    waitForExecutionCompletedSuccessfully
} from '../helper';
import { IVSCodeNotebook } from '../../../../client/common/application/types';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataScience - Intellisense Switch interpreters in a notebook', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    const executable = getOSType() === OSType.Windows ? 'Scripts/python.exe' : 'bin/python'; // If running locally on Windows box.
    const venvNoKernelPython = path.join(
        EXTENSION_ROOT_DIR_FOR_TESTS,
        'src/test/datascience/.venvnokernel',
        executable
    );
    const venvKernelPython = path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src/test/datascience/.venvkernel', executable);
    let venvNoKernelPythonPath: string;
    let venvKernelPythonPath: string;
    let vscodeNotebook: IVSCodeNotebook;

    this.timeout(120_000);
    suiteSetup(async function () {
        traceInfo(`Start Suite Intellisense Switch interpreters in a notebook`);
        this.timeout(120_000);
        api = await initialize();
        if (IS_REMOTE_NATIVE_TEST) {
            // https://github.com/microsoft/vscode-jupyter/issues/6331
            return this.skip();
        }
        if (!(await canRunNotebookTests())) {
            return this.skip();
        }
        // These are slow tests, hence lets run only on linux on CI.
        if (
            (IS_CI_SERVER && getOSType() !== OSType.Linux) ||
            !fs.pathExistsSync(venvNoKernelPython) ||
            !fs.pathExistsSync(venvKernelPython)
        ) {
            // Virtual env does not exist.
            return this.skip();
        }
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        const interpreterService = api.serviceContainer.get<IInterpreterService>(IInterpreterService);
        // Wait for all interpreters so we can make sure we can get details on the paths we have
        await interpreterService.getInterpreters();
        const [activeInterpreter, interpreter1, interpreter2] = await Promise.all([
            interpreterService.getActiveInterpreter(),
            interpreterService.getInterpreterDetails(venvNoKernelPython),
            interpreterService.getInterpreterDetails(venvKernelPython)
        ]);
        if (!activeInterpreter || !interpreter1 || !interpreter2) {
            throw new Error('Unable to get information for interpreter 1');
        }
        venvNoKernelPythonPath = interpreter1.path;
        venvKernelPythonPath = interpreter2.path;

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
        process.env.VSC_JUPYTER_IntellisenseTimeout = '30000';
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        delete process.env.VSC_JUPYTER_IntellisenseTimeout;
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this.currentTest?.title);
        }
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));
    test('Check diagnostics with and without an import', async () => {
        // Make sure .venvkernel is selected
        await waitForKernelToChange({ interpreterPath: venvKernelPythonPath });
        let cell = await insertCodeCell('import pandas as pd');

        // There should be no diagnostics at the moment
        let diagnostics = languages.getDiagnostics(cell.document.uri);
        assert.isEmpty(diagnostics, 'No diagnostics should be found in the first cell');

        // Switch to the other kernel
        await waitForKernelToChange({ interpreterPath: venvNoKernelPythonPath });

        // List pip results
        const listCell = await insertCodeCell('%pip list');
        await waitForExecutionCompletedSuccessfully(listCell);

        // Insert a cell that explicitly removes pandas to make sure it isn't there (not sure if pylance will pick up on this or not)
        const removeCell = await insertCodeCell('%pip uninstall pandas');
        await waitForExecutionCompletedSuccessfully(removeCell);

        // Wait for an error to show up
        cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;
        diagnostics = await waitForDiagnostics(cell.document.uri);
        assert.ok(diagnostics, 'Import pandas should generate a diag error on first cell');
        assert.ok(
            diagnostics.find((item) => item.message.includes('pandas')),
            'Pandas message not found'
        );

        // Switch back to the first kernel.
        await waitForKernelToChange({ interpreterPath: venvKernelPythonPath });

        // Now there should be no errors
        await waitForCondition(
            async () => {
                diagnostics = languages.getDiagnostics(cell.document.uri);
                return !diagnostics || diagnostics.length == 0;
            },
            defaultNotebookTestTimeout,
            `Import pandas after switching final time should not cause an error`
        );
    });
});
