// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { traceInfo } from '../../client/common/logger';
import { initialize, IS_REMOTE_NATIVE_TEST } from '../initialize';
import { runCellInInteractiveWindow } from './interactiveWindow.vscode.test';
import {
    assertHasTextOutputInVSCode,
    closeNotebooksAndCleanUpAfterTests,
    startJupyterServer,
    waitForExecutionCompletedSuccessfully
} from './notebook/helper';

suite('Interactive window', async () => {
    setup(async function () {
        if (!IS_REMOTE_NATIVE_TEST) {
            return this.skip();
        }
        await initialize();
        await startJupyterServer();
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        await closeNotebooksAndCleanUpAfterTests();
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests());

    test('Execute cell from Python file', async () => {
        const source = 'a="Hello World"\nprint(a)';
        const { notebookDocument } = await runCellInInteractiveWindow(source);

        const secondCell = notebookDocument?.cellAt(1);
        await waitForExecutionCompletedSuccessfully(secondCell!);
        assertHasTextOutputInVSCode(secondCell!, '42');
    });
});
