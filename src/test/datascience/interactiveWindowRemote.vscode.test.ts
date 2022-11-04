// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import { workspace, Disposable } from 'vscode';
import { IInteractiveWindowProvider } from '../../interactive-window/types';
import { traceInfo } from '../../platform/logging';
import { initialize, IS_REMOTE_NATIVE_TEST } from '../initialize.node';
import { submitFromPythonFile } from './helpers.node';
import {
    closeNotebooksAndCleanUpAfterTests,
    startJupyterServer,
    waitForExecutionCompletedSuccessfully,
    waitForTextOutput
} from './notebook/helper.node';

suite('Interactive window (remote) @iw', async () => {
    let interactiveWindowProvider: IInteractiveWindowProvider;
    let disposables: Disposable[] = [];
    setup(async function () {
        if (!IS_REMOTE_NATIVE_TEST()) {
            return this.skip();
        }
        traceInfo(`Start Test ${this.currentTest?.title}`);
        const api = await initialize();
        interactiveWindowProvider = api.serviceContainer.get<IInteractiveWindowProvider>(IInteractiveWindowProvider);
        await startJupyterServer();
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        await closeNotebooksAndCleanUpAfterTests();
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));

    async function runCellInRemoveInteractiveWindow(source: string) {
        const { activeInteractiveWindow } = await submitFromPythonFile(interactiveWindowProvider, source, disposables);
        const notebookDocument = workspace.notebookDocuments.find(
            (doc) => doc.uri.toString() === activeInteractiveWindow?.notebookUri?.toString()
        );

        // Verify executed cell input and output
        const secondCell = notebookDocument?.cellAt(1);
        const actualSource = secondCell?.document.getText();
        assert.equal(actualSource, source, `Executed cell has unexpected source code`);

        return { notebookDocument };
    }

    test('Execute cell from Python file @mandatory', async () => {
        const source = 'print("Hello World")';
        const { notebookDocument } = await runCellInRemoveInteractiveWindow(source);

        const secondCell = notebookDocument?.cellAt(1);
        await waitForExecutionCompletedSuccessfully(secondCell!);
        await waitForTextOutput(secondCell!, 'Hello World');
    });
});
