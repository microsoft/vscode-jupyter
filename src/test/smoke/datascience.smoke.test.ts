// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
/* eslint-disable , no-invalid-this, @typescript-eslint/no-explicit-any */
import * as vscode from 'vscode';
import { logger } from '../../platform/logging';
import { PYTHON_PATH, setAutoSaveDelayInWorkspaceRoot, waitForCondition } from '../common.node';
import { IS_SMOKE_TEST, JVSC_EXTENSION_ID_FOR_TESTS } from '../constants.node';
import { sleep } from '../core';
import { closeActiveWindows, initialize, initializeTest } from '../initialize.node';
import { captureScreenShot } from '../common';
import { getCachedEnvironments } from '../../platform/interpreter/helpers';
import { PythonExtension, type EnvironmentPath } from '@vscode/python-extension';

type JupyterApi = {
    openNotebook(uri: vscode.Uri, env: EnvironmentPath): Promise<void>;
};

const timeoutForCellToRun = 3 * 60 * 1_000;
suite('Smoke Tests', function () {
    this.timeout(timeoutForCellToRun);
    suiteSetup(async function () {
        this.timeout(timeoutForCellToRun);
        if (!IS_SMOKE_TEST()) {
            return this.skip();
        }
        await initialize();
        await setAutoSaveDelayInWorkspaceRoot(1);
    });
    setup(async function () {
        logger.info(`Start Test ${this.currentTest?.title}`);
        await initializeTest();
        logger.info(`Start Test Completed ${this.currentTest?.title}`);
    });
    suiteTeardown(closeActiveWindows);
    teardown(async function () {
        logger.info(`End Test ${this.currentTest?.title}`);
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this);
        }
        await closeActiveWindows();
        logger.info(`End Test Complete ${this.currentTest?.title}`);
    });

    // test('Run Cell in interactive window', async () => {
    //     const file = path.join(
    //         EXTENSION_ROOT_DIR_FOR_TESTS,
    //         'src',
    //         'test',
    //         'pythonFiles',
    //         'datascience',
    //         'simple_note_book.py'
    //     );
    //     const outputFile = path.join(path.dirname(file), 'ds.log');
    //     if (await fs.pathExists(outputFile)) {
    //         await fs.unlink(outputFile);
    //     }
    //     const textDocument = await openFile(file);

    //     // Wait for code lenses to get detected.
    //     console.log('Step0');
    //     await sleep(1_000);
    //     console.log('Step1');
    //     await vscode.commands.executeCommand<void>('jupyter.runallcells', textDocument.uri);
    //     console.log('Step2');
    //     const checkIfFileHasBeenCreated = () => fs.pathExists(outputFile);
    //     console.log('Step3');
    //     await waitForCondition(checkIfFileHasBeenCreated, timeoutForCellToRun, `"${outputFile}" file not created`);
    //     console.log('Step4');
    // }).timeout(timeoutForCellToRun);

    test('Run Cell in Notebook', async function () {
        const cell = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'print("Hello World")', 'python');
        const notebook = await vscode.workspace.openNotebookDocument(
            'jupyter-notebook',
            new vscode.NotebookData([cell])
        );
        const jupyterExt = vscode.extensions.getExtension<JupyterApi>(JVSC_EXTENSION_ID_FOR_TESTS);
        if (!jupyterExt) {
            throw new Error('Jupyter extension not found');
        }
        const [pythonEnv] = await Promise.all([
            PythonExtension.api().then((api) => api.environments.resolveEnvironment(PYTHON_PATH)),
            vscode.window.showNotebookDocument(notebook),
            jupyterExt.activate()
        ]);

        const nb = vscode.window.activeNotebookEditor?.notebook;
        if (!nb) {
            throw new Error('No active notebook');
        }
        if (!pythonEnv) {
            throw new Error(`Python environment not found ${PYTHON_PATH}`);
        }
        await jupyterExt.exports.openNotebook(nb.uri, pythonEnv);

        await vscode.commands.executeCommand<void>('notebook.execute');
        await new Promise<void>((resolve) => {
            const disposable = vscode.workspace.onDidChangeNotebookDocument((e) => {
                if (e.cellChanges.length) {
                    const cellChange = e.cellChanges[0];
                    if (
                        cellChange.outputs?.length &&
                        cellChange.outputs.some((o) =>
                            o.items.some((i) => Buffer.from(i.data).toString('utf-8').includes('Hello World'))
                        )
                    ) {
                        disposable.dispose();
                        resolve();
                    }
                }
            });
        });

        // Give time for the file to be saved before we shutdown
        await sleep(300);
    }).timeout(timeoutForCellToRun);

    test('Interactive window should always pick up current active interpreter', async function () {
        return this.skip(); // See https://github.com/microsoft/vscode-jupyter/issues/5478

        // Make an interactive window
        await vscode.commands.executeCommand<void>('jupyter.createnewinteractive');
        assert.ok(vscode.workspace.notebookDocuments.length === 1, 'Unexpected number of notebook documents created');
        // const currentWindow = provider.windows[0];
        // const interpreterForCurrentWindow = currentWindow.notebook?.getMatchingInterpreter();
        // assert.ok(interpreterForCurrentWindow !== undefined, 'Unable to get matching interpreter for current window');

        // Now change active interpreter
        await waitForCondition(
            async () => getCachedEnvironments().length > 0,
            15_000,
            'Waiting for interpreters to be discovered'
        );

        assert.ok(getCachedEnvironments().length > 1, 'Not enough interpreters to run interactive window smoke test');
        // const differentInterpreter = allInterpreters.find((interpreter) => interpreter !== interpreterForCurrentWindow);
        // await vscode.commands.executeCommand<void>('python.setInterpreter', differentInterpreter); // Requires change to Python extension

        // // Now make another interactive window and confirm it's using the newly selected interpreter
        // await vscode.commands.executeCommand<void>('jupyter.createnewinteractive');
        // assert.ok(provider.windows.length === 2, 'Unexpected number of interactive windows created');
        // const newWindow = provider.windows.find((window) => window !== currentWindow);
        // const interpreterForNewWindow = newWindow?.notebook?.getMatchingInterpreter();
        // assert.ok(interpreterForNewWindow !== undefined, 'Unable to get matching interpreter for current window');
        // assert.ok(
        //     interpreterForNewWindow === differentInterpreter,
        //     'Interactive window not created with newly selected interpreter'
        // );
    });
});
