// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import * as vscode from 'vscode';
import { IVSCodeNotebook } from '../../../client/common/application/types';
import { traceInfo } from '../../../client/common/logger';
import { IDisposable } from '../../../client/common/types';
import { createJupyterCellFromVSCNotebookCell } from '../../../client/datascience/notebook/helpers/helpers';
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

suite('VSCode Notebook PlotViewer integration - VSCode Notebook', function () {
    let api: IExtensionTestApi;
    let vscodeNotebook: IVSCodeNotebook;
    const disposables: IDisposable[] = [];
    // On conda these take longer for some reason.
    this.timeout(120_000);

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
        traceInfo(`Start Test Completed ${this.currentTest?.title}`);
    });

    teardown(async function () {
        traceInfo(`End Test ${this.currentTest?.title}`);
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`End Test Completed ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));

    test('Verify plot viewer is active for PNG plots', async function () {
        await startJupyterServer();
        await closeActiveWindows();
        await createEmptyPythonNotebook(disposables);
        assert.isOk(vscodeNotebook.activeNotebookEditor, 'No active notebook');
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

        await waitForCondition(async () => plotCell?.outputs.length >= 1, 10000, 'Plot output not generated');
        // Sometimes on CI we end up with >1 output, and the test fails, but we're expecting just one.
        if (plotCell.outputs.length !== 1) {
            const jupyterCell = createJupyterCellFromVSCNotebookCell(plotCell);
            traceInfo(`Plot cell has ${plotCell.outputs.length} outputs, Cell JSON = ${JSON.stringify(jupyterCell)}`);
        }
        assert.strictEqual(plotCell.outputs.length, 1, 'Plot cell output incorrect count');

        // Check if our metadata has __displayOpenPlotIcon
        assert(plotCell.outputs[0]!.metadata!.__displayOpenPlotIcon == true, 'Open Plot Icon missing from metadata');
        // Check our output mime types
        assert(
            plotCell.outputs[0]!.items.some((outputItem) => outputItem.mime === 'image/png'),
            'PNG Mime missing'
        );
        assert(
            plotCell.outputs[0]!.items.some((outputItem) => outputItem.mime === 'text/plain'),
            'Plain Text Mime missing'
        );
    });
    test('Verify that we generate SVGs when the setting is on', async function () {
        const settings = vscode.workspace.getConfiguration('jupyter', null);
        await settings.update('generateSVGPlots', 'true');
        await startJupyterServer();
        await closeActiveWindows();
        await createEmptyPythonNotebook(disposables);
        assert.isOk(vscodeNotebook.activeNotebookEditor, 'No active notebook');
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

        await waitForCondition(async () => plotCell?.outputs.length >= 1, 10000, 'Plot output not generated');
        assert(plotCell.outputs.length === 1, 'Plot cell output incorrect count');

        // Check if our metadata has __displayOpenPlotIcon
        assert(plotCell.outputs[0]!.metadata!.__displayOpenPlotIcon == true, 'Open Plot Icon missing from metadata');
        // Check our output mime types
        assert(
            plotCell.outputs[0]!.items.some((outputItem) => outputItem.mime === 'image/png'),
            'PNG Mime missing'
        );
        assert(
            plotCell.outputs[0]!.items.some((outputItem) => outputItem.mime === 'image/svg+xml'),
            'SVG Mime missing'
        );
        assert(
            plotCell.outputs[0]!.items.some((outputItem) => outputItem.mime === 'text/plain'),
            'Plain Text Mime missing'
        );
        await settings.update('generateSVGPlots', 'false');
    });
});
