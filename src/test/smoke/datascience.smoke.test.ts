// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
/* eslint-disable , no-invalid-this, @typescript-eslint/no-explicit-any */
import * as fs from 'fs-extra';
import * as path from '../../platform/vscode-path/path';
import * as vscode from 'vscode';
import { logger } from '../../platform/logging';
import { PYTHON_PATH, setAutoSaveDelayInWorkspaceRoot, waitForCondition } from '../common.node';
import { EXTENSION_ROOT_DIR_FOR_TESTS, IS_SMOKE_TEST, JVSC_EXTENSION_ID_FOR_TESTS } from '../constants.node';
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
        const file = path.join(
            EXTENSION_ROOT_DIR_FOR_TESTS,
            'src',
            'test',
            'pythonFiles',
            'datascience',
            'simple_nb.ipynb'
        );
        const fileContents = await fs.readFile(file, { encoding: 'utf-8' });
        const outputFile = path.join(path.dirname(file), 'ds_n.log');
        await fs.writeFile(file, fileContents.replace("'ds_n.log'", `'${outputFile.replace(/\\/g, '/')}'`), {
            encoding: 'utf-8'
        });
        if (await fs.pathExists(outputFile)) {
            await fs.unlink(outputFile);
        }
        logger.info(`Opening notebook file ${file}`);
        const notebook = await vscode.workspace.openNotebookDocument(vscode.Uri.file(file));
        await vscode.window.showNotebookDocument(notebook);

        let pythonPath = PYTHON_PATH;
        const nb = vscode.window.activeNotebookEditor?.notebook;
        if (!nb) {
            throw new Error('No active notebook');
        }
        const pythonEnv = await PythonExtension.api().then((api) => api.environments.resolveEnvironment(pythonPath));
        if (!pythonEnv) {
            throw new Error(`Python environment not found ${pythonPath}`);
        }
        const jupyterExt = vscode.extensions.getExtension<JupyterApi>(JVSC_EXTENSION_ID_FOR_TESTS);
        if (!jupyterExt) {
            throw new Error('Jupyter extension not found');
        }
        await jupyterExt?.activate();
        await jupyterExt.exports.openNotebook(nb.uri, pythonEnv);

        await vscode.commands.executeCommand<void>('notebook.execute');
        const checkIfFileHasBeenCreated = () => fs.pathExists(outputFile);
        await waitForCondition(checkIfFileHasBeenCreated, timeoutForCellToRun, `"${outputFile}" file not created`);

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
