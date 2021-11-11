// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import * as path from 'path';
import * as fs from 'fs-extra';
import { assert } from 'chai';
import * as sinon from 'sinon';
import { DataScience } from '../../../client/common/utils/localize';
import { IVSCodeNotebook } from '../../../client/common/application/types';
import { traceInfo } from '../../../client/common/logger';
import { IConfigurationService, IDisposable, IJupyterSettings, ReadWrite } from '../../../client/common/types';
import { captureScreenShot, IExtensionTestApi } from '../../common';
import { initialize } from '../../initialize';
import {
    canRunNotebookTests,
    closeNotebooksAndCleanUpAfterTests,
    runCell,
    insertCodeCell,
    startJupyterServer,
    prewarmNotebooks,
    hijackPrompt,
    createEmptyPythonNotebook,
    workAroundVSCodeNotebookStartPages,
    waitForExecutionCompletedSuccessfully,
    runAllCellsInActiveNotebook,
    waitForKernelToGetAutoSelected
} from './helper';
import { EXTENSION_ROOT_DIR_FOR_TESTS, IS_NON_RAW_NATIVE_TEST, IS_REMOTE_NATIVE_TEST } from '../../constants';
import * as dedent from 'dedent';
import { IKernelProvider } from '../../../client/datascience/jupyter/kernels/types';
import { createDeferred } from '../../../client/common/utils/async';
import { sleep } from '../../core';
import { getDisplayNameOrNameOfKernelConnection } from '../../../client/datascience/jupyter/kernels/helpers';
import { INotebookEditorProvider } from '../../../client/datascience/types';
import { Uri, workspace } from 'vscode';
import { getDisplayPath } from '../../../client/common/platform/fs-paths';

const codeToKillKernel = dedent`
import IPython
app = IPython.Application.instance()
app.kernel.do_shutdown(True)
`;

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataScience - VSCode Notebook Kernel Error Handling - (Execution) (slow)', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
    let kernelProvider: IKernelProvider;
    let config: IConfigurationService;

    this.timeout(120_000);
    suiteSetup(async function () {
        traceInfo('Suite Setup');
        this.timeout(120_000);
        try {
            api = await initialize();
            if (!(await canRunNotebookTests())) {
                return this.skip();
            }
            kernelProvider = api.serviceContainer.get<IKernelProvider>(IKernelProvider);
            config = api.serviceContainer.get<IConfigurationService>(IConfigurationService);
            await workAroundVSCodeNotebookStartPages();
            await startJupyterServer();
            await prewarmNotebooks();
            sinon.restore();
            vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
            traceInfo('Suite Setup (completed)');
        } catch (e) {
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
            assert.isOk(vscodeNotebook.activeNotebookEditor, 'No active notebook');
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
        const settings = config.getSettings() as ReadWrite<IJupyterSettings>;
        settings.disablePythonDaemon = false;
        // Added temporarily to identify why tests are failing.
        process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT = undefined;
        await closeNotebooksAndCleanUpAfterTests(disposables);
        sinon.restore();
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));
    suite('Jupyter Kernels', () => {
        setup(function () {
            if (!IS_REMOTE_NATIVE_TEST && !IS_NON_RAW_NATIVE_TEST) {
                return this.skip();
            }
        });
        test('Ensure kernel is automatically restarted by jupyter & we get a status of restarting & autorestarting when kernel dies while executing a cell', async function () {
            await insertCodeCell('print("123412341234")', { index: 0 });
            await insertCodeCell(codeToKillKernel, { index: 1 });
            const [cell1, cell2] = vscodeNotebook.activeNotebookEditor!.document.getCells();

            await Promise.all([runCell(cell1), waitForExecutionCompletedSuccessfully(cell1)]);
            const kernel = kernelProvider.get(vscodeNotebook.activeNotebookEditor!.document)!;
            const restartingEventFired = createDeferred<boolean>();
            const autoRestartingEventFired = createDeferred<boolean>();

            kernel.onStatusChanged((status) => {
                if (status === 'restarting') {
                    restartingEventFired.resolve();
                }
                if (status === 'autorestarting') {
                    autoRestartingEventFired.resolve();
                }
            });
            // Run cell that will kill the kernel.
            await Promise.all([runCell(cell2), waitForExecutionCompletedSuccessfully(cell2)]);

            // Confirm we get the terminating & dead events.
            // Kernel must die immediately, lets just wait for 10s.
            await Promise.race([
                Promise.all([restartingEventFired, autoRestartingEventFired]),
                sleep(10_000).then(() => Promise.reject(new Error('Did not fail')))
            ]);
        });
    });

    suite('Raw Kernels', () => {
        setup(function () {
            if (IS_REMOTE_NATIVE_TEST || IS_NON_RAW_NATIVE_TEST) {
                return this.skip();
            }
        });
        async function runAndFailWithKernelCrash() {
            await insertCodeCell('print("123412341234")', { index: 0 });
            await insertCodeCell(codeToKillKernel, { index: 1 });
            const [cell1, cell2] = vscodeNotebook.activeNotebookEditor!.document.getCells();

            await Promise.all([runCell(cell1), waitForExecutionCompletedSuccessfully(cell1)]);
            const kernel = kernelProvider.get(vscodeNotebook.activeNotebookEditor!.document)!;
            const terminatingEventFired = createDeferred<boolean>();
            const deadEventFired = createDeferred<boolean>();
            const expectedErrorMessage = DataScience.kernelDiedWithoutError().format(
                getDisplayNameOrNameOfKernelConnection(kernel.kernelConnectionMetadata)
            );
            const prompt = await hijackPrompt(
                'showErrorMessage',
                {
                    exactMatch: expectedErrorMessage
                },
                { dismissPrompt: true },
                disposables
            );

            kernel.onStatusChanged((status) => {
                if (status === 'terminating') {
                    terminatingEventFired.resolve();
                }
                if (status === 'dead') {
                    deadEventFired.resolve();
                }
            });
            // Run cell that will kill the kernel.
            await Promise.all([runCell(cell2), waitForExecutionCompletedSuccessfully(cell2)]);

            // Confirm we get the terminating & dead events.
            // Kernel must die immediately, lets just wait for 10s.
            await Promise.race([
                Promise.all([terminatingEventFired, deadEventFired, prompt.displayed]),
                sleep(10_000).then(() => Promise.reject(new Error('Did not fail')))
            ]);
            prompt.dispose();
        }
        test('Ensure we get an error message & a status of terminating & dead when kernel dies while executing a cell', async function () {
            await runAndFailWithKernelCrash();
        });
        test('Ensure we get a modal prompt to restart kernel when running cells against a dead kernel', async function () {
            await runAndFailWithKernelCrash();
            await insertCodeCell('print("123412341234")', { index: 2 });
            const cell3 = vscodeNotebook.activeNotebookEditor!.document.cellAt(2);
            const kernel = kernelProvider.get(vscodeNotebook.activeNotebookEditor!.document)!;

            const expectedErrorMessage = DataScience.cannotRunCellKernelIsDead().format(
                getDisplayNameOrNameOfKernelConnection(kernel.kernelConnectionMetadata)
            );
            const restartPrompt = await hijackPrompt(
                'showErrorMessage',
                {
                    exactMatch: expectedErrorMessage
                },
                { text: DataScience.restartKernel(), clickImmediately: true },
                disposables
            );
            // Confirm we get a prompt to restart the kernel, and it gets restarted.
            // & also confirm the cell completes execution with an execution count of 1 (thats how we tell kernel restarted).
            await Promise.all([restartPrompt.displayed, runCell(cell3), waitForExecutionCompletedSuccessfully(cell3)]);
            // If execution order is 1, then we know the kernel restarted.
            assert.strictEqual(cell3.executionSummary?.executionOrder, 1);
        });
        test('Ensure cell outupt does not have errors when execution fails due to dead kernel', async function () {
            await runAndFailWithKernelCrash();
            await insertCodeCell('print("123412341234")', { index: 2 });
            const cell3 = vscodeNotebook.activeNotebookEditor!.document.cellAt(2);
            const kernel = kernelProvider.get(vscodeNotebook.activeNotebookEditor!.document)!;

            const expectedErrorMessage = DataScience.cannotRunCellKernelIsDead().format(
                getDisplayNameOrNameOfKernelConnection(kernel.kernelConnectionMetadata)
            );
            const restartPrompt = await hijackPrompt(
                'showErrorMessage',
                {
                    exactMatch: expectedErrorMessage
                },
                { dismissPrompt: true, clickImmediately: true },
                disposables
            );
            // Confirm we get a prompt to restart the kernel, dismiss the prompt.
            // Confirm the cell isn't executed & there's no output (in the past we'd have s stack trace with errors indicating session has been disposed).
            await Promise.all([restartPrompt.displayed, runCell(cell3)]);
            await sleep(1_000);
            assert.isUndefined(cell3.executionSummary?.executionOrder, 'Should not have an execution order');
            assert.strictEqual(cell3.outputs.length, 0, 'Should not have any outputs');
        });
        test('Ensure we get only one prompt to restart kernel when running all cells against a dead kernel', async function () {
            await runAndFailWithKernelCrash();
            await insertCodeCell('print("123412341234")', { index: 2 });
            const kernel = kernelProvider.get(vscodeNotebook.activeNotebookEditor!.document)!;

            const expectedErrorMessage = DataScience.cannotRunCellKernelIsDead().format(
                getDisplayNameOrNameOfKernelConnection(kernel.kernelConnectionMetadata)
            );
            const restartPrompt = await hijackPrompt(
                'showErrorMessage',
                {
                    exactMatch: expectedErrorMessage
                },
                { dismissPrompt: true, clickImmediately: true },
                disposables
            );
            // Confirm we get a prompt to restart the kernel, dismiss the prompt.
            // Confirm the cell isn't executed & there's no output (in the past we'd have s stack trace with errors indicating session has been disposed).
            await Promise.all([restartPrompt.displayed, runAllCellsInActiveNotebook()]);
            // Wait a while, it shouldn't take 1s, but things could be slow on CI, hence wait a bit longer.
            await sleep(1_000);

            assert.strictEqual(restartPrompt.getDisplayCount(), 1, 'Should only have one restart prompt');
        });
        async function createAndOpenTemporaryNotebookForKernelCrash(nbFileName: string) {
            const { serviceContainer } = await initialize();
            const editorProvider = serviceContainer.get<INotebookEditorProvider>(INotebookEditorProvider);
            const vscodeNotebook = serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
            const nbFile = path.join(
                EXTENSION_ROOT_DIR_FOR_TESTS,
                `src/test/datascience/notebook/kernelFailures/overrideBuiltinModule/${nbFileName}`
            );
            fs.ensureDirSync(path.dirname(nbFile));
            fs.writeFileSync(nbFile, '');
            disposables.push({ dispose: () => fs.unlinkSync(nbFile) });
            // Open a python notebook and use this for all tests in this test suite.
            await editorProvider.open(Uri.file(nbFile));
            assert.isOk(vscodeNotebook.activeNotebookEditor, 'No active notebook');
            await waitForKernelToGetAutoSelected();
        }
        async function displayErrorAboutOverriddenBuiltInModules(disablePythonDaemon: boolean) {
            await closeNotebooksAndCleanUpAfterTests(disposables);

            const settings = config.getSettings() as ReadWrite<IJupyterSettings>;
            settings.disablePythonDaemon = disablePythonDaemon;

            const randomFile = path.join(
                EXTENSION_ROOT_DIR_FOR_TESTS,
                'src/test/datascience/notebook/kernelFailures/overrideBuiltinModule/random.py'
            );
            const expectedErrorMessage = `${DataScience.fileSeemsToBeInterferingWithKernelStartup().format(
                getDisplayPath(randomFile, workspace.workspaceFolders || [])
            )} \n${DataScience.viewJupyterLogForFurtherInfo()}`;

            const prompt = await hijackPrompt(
                'showErrorMessage',
                {
                    exactMatch: expectedErrorMessage
                },
                { dismissPrompt: true },
                disposables
            );

            await createAndOpenTemporaryNotebookForKernelCrash(`nb${disablePythonDaemon}.ipynb`);
            await insertCodeCell('print("123412341234")');
            await runAllCellsInActiveNotebook();
            // Wait for a max of 1s for error message to be dispalyed.
            await Promise.race([prompt.displayed, sleep(5_000).then(() => Promise.reject('Prompt not displayed'))]);
            prompt.dispose();
        }
        test('Display error about overriding builtin modules (with Python daemon', () =>
            displayErrorAboutOverriddenBuiltInModules(false));
        test('Display error about overriding builtin modules (without Python daemon', () =>
            displayErrorAboutOverriddenBuiltInModules(true));
    });
});
