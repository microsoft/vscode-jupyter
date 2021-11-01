// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import { workspace, Disposable } from 'vscode';
import { traceInfo } from '../../client/common/logger';
import { IInteractiveWindowProvider } from '../../client/datascience/types';
import { initialize, IS_REMOTE_NATIVE_TEST } from '../initialize';
import { submitFromPythonFile } from './helpers';
import {
    assertHasTextOutputInVSCode,
    closeNotebooksAndCleanUpAfterTests,
    startJupyterServer,
    waitForExecutionCompletedSuccessfully
} from './notebook/helper';

suite('Interactive window (remote)', async () => {
    let interactiveWindowProvider: IInteractiveWindowProvider;
    let disposables: Disposable[] = [];
    setup(async function () {
        if (!IS_REMOTE_NATIVE_TEST) {
            return this.skip();
        }
        const api = await initialize();
        interactiveWindowProvider = api.serviceContainer.get<IInteractiveWindowProvider>(IInteractiveWindowProvider);
        await startJupyterServer();
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

    test('Execute cell from Python file', async () => {
        const source = 'print("Hello World")';
        const { notebookDocument } = await runCellInRemoveInteractiveWindow(source);

        const secondCell = notebookDocument?.cellAt(1);
        await waitForExecutionCompletedSuccessfully(secondCell!);
        assertHasTextOutputInVSCode(secondCell!, 'Hello World');
    });
});
