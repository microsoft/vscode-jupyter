// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as sinon from 'sinon';
import { commands, CompletionList, Position, window } from 'vscode';
import { logger } from '../../../../platform/logging';
import { IDisposable } from '../../../../platform/common/types';
import {
    closeNotebooksAndCleanUpAfterTests,
    runCell,
    insertCodeCell,
    waitForExecutionCompletedSuccessfully,
    prewarmNotebooks,
    createEmptyPythonNotebook
} from '../helper';
import { captureScreenShot, initialize, startJupyterServer } from '../../../common';
import { getTextOutputValue } from '../../../../kernels/execution/helpers';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('VSCode Intellisense Notebook and Interactive Code Completion @lsp', function () {
    const disposables: IDisposable[] = [];
    this.timeout(120_000);
    suiteSetup(async function () {
        logger.info(`Start Suite Code Completion via Jupyter`);
        this.timeout(120_000);
        await initialize();
        await startJupyterServer();
        await prewarmNotebooks();
        sinon.restore();
        logger.info(`Start Suite (Completed) Code Completion via Jupyter`);
    });
    // Use same notebook without starting kernel in every single test (use one for whole suite).
    setup(async function () {
        logger.info(`Start Test ${this.currentTest?.title}`);
        sinon.restore();
        await startJupyterServer();
        await createEmptyPythonNotebook(disposables);
        logger.info(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        logger.info(`Ended Test ${this.currentTest?.title}`);
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this);
        }
        await closeNotebooksAndCleanUpAfterTests(disposables);
        logger.info(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));
    test('Execute cell and get completions for variable', async () => {
        await insertCodeCell('import sys\nprint(sys.executable)\na = 1', { index: 0 });
        const cell = window.activeNotebookEditor?.notebook.cellAt(0)!;

        await runCell(cell);

        // Wait till execution count changes and status is success.
        await waitForExecutionCompletedSuccessfully(cell);
        const outputText = getTextOutputValue(cell.outputs[0]).trim();
        logger.info(`Cell Output ${outputText}`);
        await insertCodeCell('a.', { index: 1 });
        const cell2 = window.activeNotebookEditor!.notebook.cellAt(1);

        const position = new Position(0, 2);
        logger.info('Get completions in test');
        // Executing the command `vscode.executeCompletionItemProvider` to simulate triggering completion
        const completions = (await commands.executeCommand(
            'vscode.executeCompletionItemProvider',
            cell2.document.uri,
            position
        )) as CompletionList;
        const items = completions.items.map((item) => item.label);
        assert.isOk(items.length);
        assert.ok(
            items.find((item) =>
                typeof item === 'string' ? item.includes('bit_length') : item.label.includes('bit_length')
            )
        );
        assert.ok(
            items.find((item) =>
                typeof item === 'string' ? item.includes('to_bytes') : item.label.includes('to_bytes')
            )
        );
    });
});
