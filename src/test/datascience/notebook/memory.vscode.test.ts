// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as fs from 'fs-extra';
import * as v8 from 'v8';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { IVSCodeNotebook } from '../../../platform/common/application/types';
import { traceInfo } from '../../../platform/common/logger';
import { IDisposable } from '../../../platform/common/types';
import { captureScreenShot, IExtensionTestApi, waitForCondition } from '../../common';
import { EXTENSION_ROOT_DIR_FOR_TESTS, initialize } from '../../initialize';
import {
    closeNotebooksAndCleanUpAfterTests,
    runCell,
    insertCodeCell,
    startJupyterServer,
    prewarmNotebooks,
    createEmptyPythonNotebook,
    workAroundVSCodeNotebookStartPages,
    waitForTextOutput,
    defaultNotebookTestTimeout
} from './helper';

// Force GC to be available
require('expose-gc');

const LAST_SIZE_MEASURED = 18616320;

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataScience - Memory Test', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
    const snapshot = takeSnapshot();

    this.timeout(120_000);

    function takeSnapshot() {
        if (global.gc) {
            // Force a gc if possible
            global.gc();
        }
        return v8.getHeapStatistics();
    }

    async function writeDiffSnapshot() {
        if (global.gc) {
            // Force a gc if possible
            global.gc();
        }
        const current = v8.getHeapStatistics();
        const diff = {
            size_diff: current.total_heap_size - snapshot.total_heap_size,
            malloced_diff: current.malloced_memory - snapshot.malloced_memory,
            native_context_diff: current.number_of_native_contexts - snapshot.number_of_native_contexts,
            detached_context_diff: current.number_of_detached_contexts - snapshot.number_of_detached_contexts
        };
        const file = path.join(EXTENSION_ROOT_DIR_FOR_TESTS, `SD-memtest.json`);
        await fs.writeFile(file, JSON.stringify(diff), { encoding: 'utf-8' }).ignoreErrors();
        return diff;
    }

    suiteSetup(async function () {
        traceInfo('Suite Setup');
        this.timeout(120_000);
        try {
            api = await initialize();
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
        // Added temporarily to identify why tests are failing.
        process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT = undefined;
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(async () => {
        await closeNotebooksAndCleanUpAfterTests(disposables);
    });
    test('Track memory usage of standard test', async () => {
        await insertCodeCell('print("123412341234")', { index: 0 });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;
        await Promise.all([runCell(cell), waitForTextOutput(cell, '123412341234')]);
        // Wait for tokens on the first cell (it works with just plain pylance)
        await waitForCondition(
            async () => {
                const promise = vscode.commands.executeCommand(
                    'vscode.provideDocumentSemanticTokens',
                    cell.document.uri
                );
                const result = (await promise) as any;
                return result && result.data.length > 0;
            },
            defaultNotebookTestTimeout,
            `Tokens never appear for first cell`,
            100,
            true
        );

        // Get the diff snapshot after we run.
        const diff = await writeDiffSnapshot();
        assert.ok(diff.malloced_diff < LAST_SIZE_MEASURED * 2, `Malloced memory has doubled`);
        assert.ok(diff.native_context_diff < 1, `Native context has gone up`);
        assert.ok(diff.detached_context_diff < 1, `Detached context has gone up`);
    });
});
