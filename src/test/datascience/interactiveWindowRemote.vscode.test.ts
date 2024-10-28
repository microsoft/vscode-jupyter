// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { workspace, Disposable } from 'vscode';
import { IInteractiveWindowProvider } from '../../interactive-window/types';
import { logger } from '../../platform/logging';
import { testMandatory } from '../common';
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
        logger.info(`Start Test ${this.currentTest?.title}`);
        const api = await initialize();
        interactiveWindowProvider = api.serviceContainer.get<IInteractiveWindowProvider>(IInteractiveWindowProvider);
        await startJupyterServer();
        logger.info(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        logger.info(`Ended Test ${this.currentTest?.title}`);
        await closeNotebooksAndCleanUpAfterTests();
        logger.info(`Ended Test (completed) ${this.currentTest?.title}`);
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

    testMandatory('Execute cell from Python file', async () => {
        const source = 'print("Hello World")';
        const { notebookDocument } = await runCellInRemoveInteractiveWindow(source);

        const secondCell = notebookDocument?.cellAt(1);
        await waitForExecutionCompletedSuccessfully(secondCell!);
        await waitForTextOutput(secondCell!, 'Hello World');
    });
});
