// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
/* eslint-disable , no-invalid-this, @typescript-eslint/no-explicit-any */

import * as fs from 'fs-extra';
import * as path from 'path';
import * as vscode from 'vscode';
import { ISystemPseudoRandomNumberGenerator } from '../../client/datascience/types';
import { IExtensionTestApi, openFile, setAutoSaveDelayInWorkspaceRoot, waitForCondition } from '../common';
import { EXTENSION_ROOT_DIR_FOR_TESTS, IS_SMOKE_TEST } from '../constants';
import { noop, sleep } from '../core';
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
    setup(initializeTest);
    suiteTeardown(closeActiveWindows);
    teardown(closeActiveWindows);

    test('Random bytes generation', async () => {
        // We do have a unit test testing this, however create a smoke test to
        // ensure that the bundling of the native node modules worked
        const numRequestedBytes = 1024;
        if (!api) {
            api = await initialize();
        }
        const prng = api.serviceManager.get<ISystemPseudoRandomNumberGenerator>(ISystemPseudoRandomNumberGenerator);
        const generatedKey = await prng.generateRandomKey(numRequestedBytes);
        const generatedKeyLength = generatedKey.length;
        assert.ok(
            generatedKeyLength === numRequestedBytes * 2, // *2 because the bytes are returned as hex
            `Expected to generate ${numRequestedBytes} random bytes but instead generated ${generatedKeyLength} random bytes`
        );
        assert.ok(generatedKey !== '', `Generated key is null`);
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
        await sleep(1_000);

        await vscode.commands.executeCommand<void>('jupyter.runallcells', textDocument.uri);
        const checkIfFileHasBeenCreated = () => fs.pathExists(outputFile);
        await waitForCondition(checkIfFileHasBeenCreated, timeoutForCellToRun, `"${outputFile}" file not created`);
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
        // Ignore exceptions (as native editor closes the document as soon as its opened);
        await openFile(file).catch(noop);

        // Wait for 15 seconds for notebook to launch.
        // Unfortunately there's no way to know for sure it has completely loaded.
        await sleep(15_000);

        await vscode.commands.executeCommand<void>('jupyter.notebookeditor.runallcells');
        const checkIfFileHasBeenCreated = () => fs.pathExists(outputFile);
        await waitForCondition(checkIfFileHasBeenCreated, timeoutForCellToRun, `"${outputFile}" file not created`);

        // Give time for the file to be saved before we shutdown
        await sleep(300);
    }).timeout(timeoutForCellToRun);
});
