// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as sinon from 'sinon';
import { window } from 'vscode';
import { traceInfo } from '../../../platform/common/logger';
import { IDisposable } from '../../../platform/common/types';
import { captureScreenShot, IExtensionTestApi, waitForCondition } from '../../common';
import { initialize } from '../../initialize';
import {
    closeNotebooksAndCleanUpAfterTests,
    runAllCellsInActiveNotebook,
    insertCodeCell,
    startJupyterServer,
    waitForExecutionCompletedSuccessfully,
    prewarmNotebooks,
    createEmptyPythonNotebook,
    workAroundVSCodeNotebookStartPages,
    defaultNotebookTestTimeout
} from './helper';
import { IS_CONDA_TEST } from '../../constants';
import { EnvironmentType } from '../../../platform/pythonEnvironments/info';
import { JupyterNotebookView } from '../../../notebooks/constants';
import { INotebookControllerManager } from '../../../notebooks/types';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataScience - VSCode Notebook - (Conda Env Detection) (slow)', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let controllerManager: INotebookControllerManager;
    this.timeout(120_000);
    suiteSetup(async function () {
        if (!IS_CONDA_TEST) {
            return this.skip();
        }
        traceInfo('Suite Setup VS Code Notebook - Execution');
        this.timeout(120_000);
        try {
            api = await initialize();
            controllerManager = api.serviceContainer.get<INotebookControllerManager>(INotebookControllerManager);
            await workAroundVSCodeNotebookStartPages();
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
            await captureScreenShot(this.currentTest?.title || 'unknown');
            throw e;
        }
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this.currentTest?.title);
        }
        // Added temporarily to identify why tests are failing.
        process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT = undefined;
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));

    test('New Conda Environment should be detected', async () => {
        const uniqueCondaEnvName = `bogustTestEnv${Date.now()}`;
        await insertCodeCell(`!conda create -n ${uniqueCondaEnvName} python -y`, { index: 0 });

        const cells = window.activeNotebookEditor!.document.getCells();
        await Promise.all([runAllCellsInActiveNotebook(), waitForExecutionCompletedSuccessfully(cells[0])]);

        // Wait for this conda env to get added to the list of kernels.
        await waitForCondition(
            async () => {
                return (
                    controllerManager
                        .registeredNotebookControllers()
                        .filter(
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
