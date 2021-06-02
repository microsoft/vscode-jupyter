// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
/* eslint-disable , no-invalid-this, @typescript-eslint/no-explicit-any */

import * as fs from 'fs-extra';
import * as path from 'path';
import * as vscode from 'vscode';
import { traceInfo } from '../../client/common/logger';
import { IInteractiveWindowProvider } from '../../client/datascience/types';
import { IInterpreterService } from '../../client/interpreter/contracts';
import { IExtensionTestApi, openFile, setAutoSaveDelayInWorkspaceRoot, waitForCondition } from '../common';
import { EXTENSION_ROOT_DIR_FOR_TESTS, IS_SMOKE_TEST } from '../constants';
import { sleep } from '../core';
import { closeActiveWindows, initialize, initializeTest } from '../initialize';

const timeoutForCellToRun = 3 * 60 * 1_000;
suite('Smoke Tests', () => {
    let api: IExtensionTestApi;
    suiteSetup(async function () {
        if (!IS_SMOKE_TEST) {
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
        await closeActiveWindows();
        traceInfo(`End Test Compelete ${this.currentTest?.title}`);
    });

    test('Run Cell in interactive window', async () => {
        const file = path.join(
            EXTENSION_ROOT_DIR_FOR_TESTS,
            'src',
            'test',
            'pythonFiles',
            'datascience',
            'simple_note_book.py'
        );
        const outputFile = path.join(path.dirname(file), 'ds.log');
        if (await fs.pathExists(outputFile)) {
            await fs.unlink(outputFile);
        }
        const textDocument = await openFile(file);

        // Wait for code lenses to get detected.
        console.log('Step0');
        await sleep(1_000);
        console.log('Step1');
        await vscode.commands.executeCommand<void>('jupyter.runallcells', textDocument.uri);
        console.log('Step2');
        const checkIfFileHasBeenCreated = () => fs.pathExists(outputFile);
        console.log('Step3');
        await waitForCondition(checkIfFileHasBeenCreated, timeoutForCellToRun, `"${outputFile}" file not created`);
        console.log('Step4');
    }).timeout(timeoutForCellToRun);

    test('Run Cell in native editor', async () => {
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
        await vscode.commands.executeCommand('jupyter.opennotebook', vscode.Uri.file(file));

        // Wait for 15 seconds for notebook to launch.
        // Unfortunately there's no way to know for sure it has completely loaded.
        await sleep(15_000);

        await vscode.commands.executeCommand<void>('jupyter.notebookeditor.runallcells');
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
        const currentWindow = provider.windows[0];
        const interpreterForCurrentWindow = currentWindow.notebook?.getMatchingInterpreter();
        assert.ok(interpreterForCurrentWindow !== undefined, 'Unable to get matching interpreter for current window');

        // Now change active interpreter
        const interpreterService = api.serviceManager.get<IInterpreterService>(IInterpreterService);
        const allInterpreters = await interpreterService.getInterpreters();
        assert.ok(allInterpreters.length > 1, 'Not enough interpreters to run interactive window smoke test');
        const differentInterpreter = allInterpreters.find((interpreter) => interpreter !== interpreterForCurrentWindow);
        await vscode.commands.executeCommand<void>('python.setInterpreter', differentInterpreter); // Requires change to Python extension

        // Now make another interactive window and confirm it's using the newly selected interpreter
        await vscode.commands.executeCommand<void>('jupyter.createnewinteractive');
        assert.ok(provider.windows.length === 2, 'Unexpected number of interactive windows created');
        const newWindow = provider.windows.find((window) => window !== currentWindow);
        const interpreterForNewWindow = newWindow?.notebook?.getMatchingInterpreter();
        assert.ok(interpreterForNewWindow !== undefined, 'Unable to get matching interpreter for current window');
        assert.ok(
            interpreterForNewWindow === differentInterpreter,
            'Interactive window not created with newly selected interpreter'
        );
    });
});
