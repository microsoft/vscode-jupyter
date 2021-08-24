// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import { ICommandManager, IVSCodeNotebook } from '../../../client/common/application/types';
import { traceInfo } from '../../../client/common/logger';
import { IDisposable } from '../../../client/common/types';
import { IExtensionTestApi, waitForCondition } from '../../common';
import { closeActiveWindows, initialize } from '../../initialize';
import {
    closeNotebooksAndCleanUpAfterTests,
    insertCodeCell,
    startJupyterServer,
    waitForExecutionCompletedSuccessfully,
    createEmptyPythonNotebook,
    runAllCellsInActiveNotebook,
    canRunNotebookTests
} from '../notebook/helper';

suite('IANHU VSCode Notebook PlotViewer integration', function () {
    let api: IExtensionTestApi;
    let vscodeNotebook: IVSCodeNotebook;
    const disposables: IDisposable[] = [];
    // On conda these take longer for some reason.
    this.timeout(60_000);

    suiteSetup(async function () {
        api = await initialize();
        if (!(await canRunNotebookTests())) {
            return this.skip();
        }
        await startJupyterServer();
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
    });

    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        await startJupyterServer();
        await closeActiveWindows();
        await createEmptyPythonNotebook(disposables);
        assert.isOk(vscodeNotebook.activeNotebookEditor, 'No active notebook');
        traceInfo(`Start Test Completed ${this.currentTest?.title}`);
    });

    teardown(async function () {
        traceInfo(`End Test ${this.currentTest?.title}`);
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`End Test Completed ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));

    test('Verify plot viewer is active for PNG plots', async function () {
        await insertCodeCell(
            `import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
x = np.linspace(0, 20, 100)
plt.plot(x, np.sin(x))
plt.show()`,
            { index: 0 }
        );

        const plotCell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;

        await runAllCellsInActiveNotebook();
        await waitForExecutionCompletedSuccessfully(plotCell);

        await waitForCondition(async () => plotCell?.outputs.length > 1, 10000, 'Plot output not generated');
        assert(plotCell.outputs.length === 1, 'Plot cell output incorrect count');
    });
});
