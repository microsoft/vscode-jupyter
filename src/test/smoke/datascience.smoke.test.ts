// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
/* eslint-disable , no-invalid-this, @typescript-eslint/no-explicit-any */
import * as os from 'os';
import * as fs from 'fs-extra';
import * as path from '../../platform/vscode-path/path';
import * as vscode from 'vscode';
import { traceInfo, traceVerbose } from '../../platform/logging';
import { PYTHON_PATH, openFile, setAutoSaveDelayInWorkspaceRoot, waitForCondition } from '../common.node';
import { EXTENSION_ROOT_DIR_FOR_TESTS, IS_SMOKE_TEST } from '../constants.node';
import { sleep } from '../core';
import { closeActiveWindows, initialize, initializeTest } from '../initialize.node';
import { captureScreenShot } from '../common';
import { getCachedEnvironments } from '../../platform/interpreter/helpers';

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
        traceInfo(`End Test Complete ${this.currentTest?.title}`);
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
        traceInfo(`Opening notebook file ${file}`);
        await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(file), 'jupyter-notebook');

        // Wait for 15 seconds for notebook to launch.
        // Unfortunately there's no way to know for sure it has completely loaded.
        await sleep(60_000);

        let controllerId = '';
        let pythonPath = PYTHON_PATH;
        let hash = await getInterpreterHash(vscode.Uri.file(pythonPath));
        traceInfo(`Hash of old path ${pythonPath} is ${hash}`);
        if (os.platform() === 'darwin' || os.platform() === 'linux') {
            if (pythonPath.endsWith('/bin/python')) {
                // have a look at the code in getNormalizedInterpreterPath
                pythonPath = pythonPath.replace('/bin/python', '/python');
            }
        } else {
            pythonPath = `${PYTHON_PATH.substring(0, 1).toLowerCase()}${PYTHON_PATH.substring(1)}`;
        }
        hash = await getInterpreterHash(vscode.Uri.file(pythonPath));
        controllerId = `.jvsc74a57bd0${hash}.${pythonPath}.${pythonPath}.-m#ipykernel_launcher`;
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
    async function computeHash(data: string, algorithm: 'SHA-512' | 'SHA-256' | 'SHA-1'): Promise<string> {
        const inputBuffer = new TextEncoder().encode(data);
        const hashBuffer = await require('node:crypto').webcrypto.subtle.digest({ name: algorithm }, inputBuffer);

        // Turn into hash string (got this logic from https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest)
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    function getInterpreterHash(uri: vscode.Uri) {
        const interpreterPath = getNormalizedInterpreterPath(uri);
        return computeHash(interpreterPath.path, 'SHA-256');
    }
    /**
     * Sometimes on CI, we have paths such as (this could happen on user machines as well)
     *  - /opt/hostedtoolcache/Python/3.8.11/x64/python
     *  - /opt/hostedtoolcache/Python/3.8.11/x64/bin/python
     *  They are both the same.
     * This function will take that into account.
     */
    function getNormalizedInterpreterPath(path: vscode.Uri, forceLowerCase: boolean = false) {
        let fsPath = getFilePath(path);
        if (forceLowerCase) {
            fsPath = fsPath.toLowerCase();
        }

        // No need to generate hashes, its unnecessarily slow.
        if (!fsPath.endsWith('/bin/python')) {
            return vscode.Uri.file(fsPath);
        }
        // Sometimes on CI, we have paths such as (this could happen on user machines as well)
        // - /opt/hostedtoolcache/Python/3.8.11/x64/python
        // - /opt/hostedtoolcache/Python/3.8.11/x64/bin/python
        // They are both the same.
        // To ensure we treat them as the same, lets drop the `bin` on unix.
        const isWindows = /^win/.test(process.platform);
        if (!isWindows) {
            // We need to exclude paths such as `/usr/bin/python`
            return fsPath.endsWith('/bin/python') && fsPath.split('/').length > 4
                ? vscode.Uri.file(fsPath.replace('/bin/python', '/python'))
                : vscode.Uri.file(fsPath);
        }
        return vscode.Uri.file(fsPath);
    }
    function getFilePath(file: vscode.Uri | undefined) {
        const isWindows = /^win/.test(process.platform);
        if (file) {
            const fsPath = file.path;

            // Remove separator on the front if not a network drive.
            // Example, if you create a URI with Uri.file('hello world'), the fsPath will come out as '\Hello World' on windows. We don't want that
            // However if you create a URI from a network drive, like '\\mydrive\foo\bar\python.exe', we want to keep the \\ on the front.
            if (fsPath && fsPath.startsWith(path.sep) && fsPath.length > 1 && fsPath[1] !== path.sep && isWindows) {
                return fsPath.slice(1);
            }
            return fsPath || '';
        }
        return '';
    }
});
