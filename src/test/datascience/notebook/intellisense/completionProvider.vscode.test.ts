// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as path from 'path';
import * as sinon from 'sinon';
import { CancellationTokenSource, CompletionContext, CompletionTriggerKind, Position, Uri } from 'vscode';
import { CellDisplayOutput } from '../../../../../types/vscode-proposed';
import { IVSCodeNotebook } from '../../../../client/common/application/types';
import { traceInfo } from '../../../../client/common/logger';
import { IDisposable } from '../../../../client/common/types';
import { NotebookCompletionProvider } from '../../../../client/datascience/notebook/intellisense/completionProvider';
import { INotebookEditorProvider } from '../../../../client/datascience/types';
import { IExtensionTestApi } from '../../../common';
import { EXTENSION_ROOT_DIR_FOR_TESTS, initialize } from '../../../initialize';
import {
    canRunNotebookTests,
    closeNotebooksAndCleanUpAfterTests,
    deleteAllCellsAndWait,
    executeCell,
    insertCodeCell,
    trustAllNotebooks,
    startJupyterServer,
    waitForExecutionCompletedSuccessfully,
    waitForKernelToGetAutoSelected,
    prewarmNotebooks,
    createTemporaryNotebook
} from '../helper';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataScience - VSCode Notebook - (Code Completion via Jupyter) (slow)', function () {
    let api: IExtensionTestApi;
    let editorProvider: INotebookEditorProvider;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
    let completionProvider: NotebookCompletionProvider;
    this.timeout(120_000);
    const templatePythonNbFile = path.join(
        EXTENSION_ROOT_DIR_FOR_TESTS,
        'src/test/datascience/notebook/emptyPython.ipynb'
    );
    let nbFile: string;
    suiteSetup(async function () {
        this.timeout(120_000);
        api = await initialize();
        if (!(await canRunNotebookTests())) {
            return this.skip();
        }
        await trustAllNotebooks();
        await startJupyterServer();
        await prewarmNotebooks();
        sinon.restore();
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        editorProvider = api.serviceContainer.get<INotebookEditorProvider>(INotebookEditorProvider);
        completionProvider = api.serviceContainer.get<NotebookCompletionProvider>(NotebookCompletionProvider);
    });
    // Use same notebook without starting kernel in every single test (use one for whole suite).
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        sinon.restore();
        // Don't use same file (due to dirty handling, we might save in dirty.)
        // Coz we won't save to file, hence extension will backup in dirty file and when u re-open it will open from dirty.
        nbFile = await createTemporaryNotebook(templatePythonNbFile, disposables);
        await startJupyterServer();
        // Open a python notebook and use this for all tests in this test suite.
        await editorProvider.open(Uri.file(nbFile));
        await waitForKernelToGetAutoSelected(undefined);
        await deleteAllCellsAndWait();
        assert.isOk(vscodeNotebook.activeNotebookEditor, 'No active notebook');
        process.env.VSC_JUPYTER_IntellisenseTimeout = '30000';
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        delete process.env.VSC_JUPYTER_IntellisenseTimeout;
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));
    test('Execute cell and get completions for variable', async () => {
        // Print sys.executable for debugging purposes (some times on CI we weren't using the right kernel).
        await insertCodeCell('import sys\nprint(sys.executable)\na = 1', { index: 0 });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cells![0]!;

        await executeCell(cell);

        // Wait till execution count changes and status is success.
        await waitForExecutionCompletedSuccessfully(cell);
        const outputText: string = (cell.outputs[0] as CellDisplayOutput).data['text/plain'].trim();
        traceInfo(`Cell Output ${outputText}`);

        await insertCodeCell('a.', { index: 1 });
        const cell2 = vscodeNotebook.activeNotebookEditor!.document.cells[1];

        const token = new CancellationTokenSource().token;
        const position = new Position(0, 2);
        const context: CompletionContext = {
            triggerKind: CompletionTriggerKind.TriggerCharacter,
            triggerCharacter: '.'
        };
        traceInfo('Get completions in test');
        const completions = await completionProvider.provideCompletionItems(cell2.document, position, token, context);
        console.log(JSON.stringify(completions));
        const items = completions.map((item) => item.label);
        assert.isOk(items.length);
        assert.include(items, 'bit_length');
        assert.include(items, 'to_bytes');
    });
});
