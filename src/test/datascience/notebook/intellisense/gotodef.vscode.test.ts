// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { traceInfo } from '../../../../platform/logging';
import { IDisposable } from '../../../../platform/common/types';
import { captureScreenShot, createEventHandler, waitForCondition } from '../../../common.node';
import { IS_REMOTE_NATIVE_TEST } from '../../../constants.node';
import {
    closeNotebooksAndCleanUpAfterTests,
    insertCodeCell,
    startJupyterServer,
    prewarmNotebooks,
    createEmptyPythonNotebook,
    defaultNotebookTestTimeout
} from '../helper.node';
import { setIntellisenseTimeout } from '../../../../standalone/intellisense/pythonKernelCompletionProvider';
import { Settings } from '../../../../platform/common/constants';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('VSCode Intellisense Notebook and Interactive Goto Definition @lsp', function () {
    const disposables: IDisposable[] = [];
    this.timeout(120_000);
    suiteSetup(async function () {
        traceInfo(`Start Suite Code Completion via Jupyter`);
        this.timeout(120_000);
        if (IS_REMOTE_NATIVE_TEST()) {
            // https://github.com/microsoft/vscode-jupyter/issues/6331
            return this.skip();
        }
        await startJupyterServer();
        await prewarmNotebooks();
        sinon.restore();
        traceInfo(`Start Suite (Completed) Goto Definition`);
    });
    // Use same notebook without starting kernel in every single test (use one for whole suite).
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        sinon.restore();
        await startJupyterServer();
        await createEmptyPythonNotebook(disposables);
        setIntellisenseTimeout(30000);
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        setIntellisenseTimeout(Settings.IntellisenseTimeout);
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this);
        }
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));
    test.skip('Define something in another cell and goto it', async () => {
        // Do we need this test? This should be a test for pylance. We're not involved.
        const cell1 = await insertCodeCell('def foo():\n  print("foo")');
        const cell2 = await insertCodeCell('foo()');

        // Give focus to the second cell
        await vscode.commands.executeCommand('notebook.focusNextEditor');
        await vscode.commands.executeCommand('notebook.cell.edit');

        // Change the active selection
        await waitForCondition(
            async () => {
                return vscode.window.activeTextEditor?.document === cell2.document;
            },
            defaultNotebookTestTimeout,
            `Waiting for editor to switch`
        );
        vscode.window.activeTextEditor!.selection = new vscode.Selection(
            new vscode.Position(0, 1),
            new vscode.Position(0, 1)
        );

        const onDidSwitchNotebooks = createEventHandler(vscode.window, 'onDidChangeNotebookEditorSelection');

        // Executing the command `editor.action.revealDefinition` to simulate going to definition
        await vscode.commands.executeCommand('editor.action.revealDefinition');

        // Wait for the active cell to change
        await waitForCondition(
            async () => {
                return onDidSwitchNotebooks.fired;
            },
            defaultNotebookTestTimeout,
            `Waiting for switch notebook cells`
        );

        // Verify we are in cell1
        await waitForCondition(
            async () => {
                assert.equal(vscode.window.activeTextEditor?.document, cell1.document, 'Text editor did not switch');
                return true;
            },
            5_000,
            'Text editor did not switch'
        );
    });

    test.skip('Import pandas and goto it', async () => {
        await insertCodeCell('import pandas as pd');
        const cell2 = await insertCodeCell('pd.read_csv');

        // Give focus to the second cell
        await vscode.commands.executeCommand('notebook.focusNextEditor');
        await vscode.commands.executeCommand('notebook.cell.edit');

        // Change the active selection
        await waitForCondition(
            async () => {
                return vscode.window.activeTextEditor?.document === cell2.document;
            },
            defaultNotebookTestTimeout,
            `Waiting for editor to switch`
        );
        vscode.window.activeTextEditor!.selection = new vscode.Selection(
            new vscode.Position(0, 4),
            new vscode.Position(0, 4)
        );

        const onDidSwitchActiveEditor = createEventHandler(vscode.window, 'onDidChangeActiveTextEditor');

        // Executing the command `editor.action.revealDefinition` to simulate going to definition
        await vscode.commands.executeCommand('editor.action.revealDefinition');

        // Wait for the active cell to change
        await waitForCondition(
            async () => {
                return onDidSwitchActiveEditor.fired;
            },
            defaultNotebookTestTimeout,
            `Waiting for editor to switch`
        );

        // Verify we are in cell1
        assert.ok(
            vscode.window.activeTextEditor?.document.fileName.includes('pandas'),
            'Did not go to pandas definition for read_csv'
        );
    });
});
