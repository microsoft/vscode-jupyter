// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
/* eslint-disable , no-invalid-this, @typescript-eslint/no-explicit-any */
import * as os from 'os';
import * as fs from 'fs-extra';
import * as path from '../../platform/vscode-path/path';
import * as vscode from 'vscode';
import { IInteractiveWindowProvider } from '../../interactive-window/types';
import { traceInfo, traceVerbose } from '../../platform/logging';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { IExtensionTestApi, PYTHON_PATH, setAutoSaveDelayInWorkspaceRoot, waitForCondition } from '../common.node';
import { EXTENSION_ROOT_DIR_FOR_TESTS, IS_SMOKE_TEST } from '../constants.node';
import { sleep } from '../core';
import { closeActiveWindows, initialize, initializeTest } from '../initialize.node';
import { captureScreenShot } from '../common';

const timeoutForCellToRun = 3 * 60 * 1_000;
suite('Smoke Tests', () => {
    let api: IExtensionTestApi;
    suiteSetup(async function () {
        if (!IS_SMOKE_TEST()) {
            return this.skip();
        }
        api = await initialize();
        await setAutoSaveDelayInWorkspaceRoot(1);
    });
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        await initializeTest();
        traceInfo(`Start Test Completed ${this.currentTest?.title}`);
    });
    suiteTeardown(closeActiveWindows);
    teardown(async function () {
        traceInfo(`End Test ${this.currentTest?.title}`);
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this);
        }
        await closeActiveWindows();
        traceInfo(`End Test Compelete ${this.currentTest?.title}`);
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
        await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(file), 'jupyter-notebook');

        // Wait for 15 seconds for notebook to launch.
        // Unfortunately there's no way to know for sure it has completely loaded.
        await sleep(15_000);

        let controllerId = '';
        let pythonPath = PYTHON_PATH;
        if (os.platform() === 'darwin') {
            controllerId = `.jvsc74a57bd0396cba01897a9f2acbbfe0a6dcd789f4a066d92b27f41a29bade356faf26eba1.${pythonPath}.${pythonPath}.-m#ipykernel_launcher`;
        } else if (os.platform() === 'linux') {
            controllerId = `.jvsc74a57bd066f2b7bf0b1c80ed7c830b1a5555ddbc4af5468303d89f7ea039ef5384a7a529.${pythonPath}.${pythonPath}.-m#ipykernel_launcher`;
        } else {
            pythonPath = `${PYTHON_PATH.substring(0, 1).toLowerCase()}${PYTHON_PATH.substring(1)}`;
            controllerId = `.jvsc74a57bd0d7b94230321e1e373f0403eaf807487012707ff7aa985439f4989b5650fe770c.${pythonPath}.${pythonPath}.-m#ipykernel_launcher`;
        }
        traceVerbose(`Before selected kernel ${controllerId}`);
        await vscode.commands.executeCommand('notebook.selectKernel', {
            id: controllerId,
            extension: 'ms-toolsai.jupyter'
        });

        traceVerbose(`Selected kernel ${controllerId}`);
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
        const provider = api.serviceManager.get<IInteractiveWindowProvider>(IInteractiveWindowProvider);
        assert.ok(provider.windows.length === 1, 'Unexpected number of interactive windows created');
        // const currentWindow = provider.windows[0];
        // const interpreterForCurrentWindow = currentWindow.notebook?.getMatchingInterpreter();
        // assert.ok(interpreterForCurrentWindow !== undefined, 'Unable to get matching interpreter for current window');

        // Now change active interpreter
        const interpreterService = api.serviceManager.get<IInterpreterService>(IInterpreterService);
        await waitForCondition(
            async () => interpreterService.resolvedEnvironments.length > 0,
            15_000,
            'Waiting for interpreters to be discovered'
        );

        assert.ok(
            interpreterService.resolvedEnvironments.length > 1,
            'Not enough interpreters to run interactive window smoke test'
        );
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
