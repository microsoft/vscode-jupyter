// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as sinon from 'sinon';
import { window } from 'vscode';
import { traceInfo } from '../../../platform/logging';
import { IDisposable } from '../../../platform/common/types';
import { captureScreenShot, IExtensionTestApi, waitForCondition } from '../../common.node';
import { initialize } from '../../initialize.node';
import {
    closeNotebooksAndCleanUpAfterTests,
    runAllCellsInActiveNotebook,
    insertCodeCell,
    startJupyterServer,
    waitForExecutionCompletedSuccessfully,
    prewarmNotebooks,
    createEmptyPythonNotebook,
    defaultNotebookTestTimeout
} from './helper.node';
import { IS_CONDA_TEST } from '../../constants.node';
import { EnvironmentType } from '../../../platform/pythonEnvironments/info';
import { JupyterNotebookView } from '../../../platform/common/constants';
import { IControllerRegistry } from '../../../notebooks/controllers/types';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('Conda Env Detection @kernelPicker', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let controllerRegistration: IControllerRegistry;
    this.timeout(120_000);
    suiteSetup(async function () {
        if (!IS_CONDA_TEST()) {
            return this.skip();
        }
        traceInfo('Suite Setup VS Code Notebook - Execution');
        this.timeout(120_000);
        try {
            api = await initialize();
            controllerRegistration = api.serviceContainer.get<IControllerRegistry>(IControllerRegistry);
            await startJupyterServer();
            await prewarmNotebooks();
            sinon.restore();
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
            assert.isOk(window.activeNotebookEditor, 'No active notebook');
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

    test('New Conda Environment should be detected', async () => {
        const uniqueCondaEnvName = `bogustTestEnv${Date.now()}`;
        await insertCodeCell(`!conda create -n ${uniqueCondaEnvName} python -y`, { index: 0 });

        const cells = window.activeNotebookEditor!.notebook.getCells();
        await Promise.all([runAllCellsInActiveNotebook(), waitForExecutionCompletedSuccessfully(cells[0])]);

        // Wait for this conda env to get added to the list of kernels.
        await waitForCondition(
            async () => {
                return (
                    controllerRegistration.registered.filter(
                        (item) =>
                            item.controller.notebookType === JupyterNotebookView &&
                            item.connection.kind === 'startUsingPythonInterpreter' &&
                            item.connection.interpreter.envType === EnvironmentType.Conda &&
                            item.connection.interpreter.envName === uniqueCondaEnvName
                    ).length > 0
                );
            },
            defaultNotebookTestTimeout * 2,
            `Conda Environment ${uniqueCondaEnvName} not detected`
        );
    });
});
