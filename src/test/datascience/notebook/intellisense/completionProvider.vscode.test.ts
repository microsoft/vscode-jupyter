// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as path from 'path';
import * as sinon from 'sinon';
import {
    CancellationTokenSource,
    CompletionContext,
    CompletionTriggerKind,
    ConfigurationTarget,
    Position,
    workspace,
    WorkspaceEdit
} from 'vscode';
import { IVSCodeNotebook } from '../../../../client/common/application/types';
import { traceInfo } from '../../../../client/common/logger';
import { IDisposable } from '../../../../client/common/types';
import { PythonKernelCompletionProvider } from '../../../../client/datascience/notebook/intellisense/pythonKernelCompletionProvider';
import { IExtensionTestApi, sleep } from '../../../common';
import { IS_REMOTE_NATIVE_TEST } from '../../../constants';
import { initialize } from '../../../initialize';
import {
    closeNotebooksAndCleanUpAfterTests,
    runCell,
    insertCodeCell,
    startJupyterServer,
    waitForExecutionCompletedSuccessfully,
    prewarmNotebooks,
    createEmptyPythonNotebook,
    getCellOutputs
} from '../helper';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataScience - VSCode Intellisense Notebook - (Code Completion via Jupyter) (slow)', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let vscodeNotebook: IVSCodeNotebook;
    let completionProvider: PythonKernelCompletionProvider;
    this.timeout(120_000);
    let previousPythonCompletionTriggerCharactersValue: string | undefined;
    suiteSetup(async function () {
        traceInfo(`Start Suite Code Completion via Jupyter`);
        this.timeout(120_000);
        api = await initialize();
        if (IS_REMOTE_NATIVE_TEST) {
            // https://github.com/microsoft/vscode-jupyter/issues/6331
            return this.skip();
        }
        previousPythonCompletionTriggerCharactersValue = workspace
            .getConfiguration('jupyter', undefined)
            .get<string>('pythonCompletionTriggerCharacters');
        await workspace
            .getConfiguration('jupyter', undefined)
            .update('pythonCompletionTriggerCharacters', '.%"\'', ConfigurationTarget.Global);
        await startJupyterServer();
        await prewarmNotebooks();
        sinon.restore();
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        completionProvider = api.serviceContainer.get<PythonKernelCompletionProvider>(PythonKernelCompletionProvider);
        traceInfo(`Start Suite (Completed) Code Completion via Jupyter`);
    });
    // Use same notebook without starting kernel in every single test (use one for whole suite).
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        sinon.restore();
        await startJupyterServer();
        await createEmptyPythonNotebook(disposables);
        process.env.VSC_JUPYTER_IntellisenseTimeout = '30000';
        traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        delete process.env.VSC_JUPYTER_IntellisenseTimeout;
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(async () => {
        await workspace
            .getConfiguration('jupyter', undefined)
            .update(
                'pythonCompletionTriggerCharacters',
                previousPythonCompletionTriggerCharactersValue,
                ConfigurationTarget.Global
            );

        await closeNotebooksAndCleanUpAfterTests(disposables);
    });
    /**
     * Test completions.
     * @param {string} cellCode e.g. `df.`
     * @param {string} itemToExistInCompletion E.g. `Name`, `Age`
     * @param {string} textToFilterCompletions The text typed to filter the list, e.g. `N`.
     * @param {string} itemToExistInCompletionAfterFilter The filtered list, e.g. if user types `N`, then `Age` will not show up, but `Name` will.
     */
    async function testCompletions(
        cellCode: string,
        triggerCharacter: string | undefined,
        itemToNotExistInCompletion?: string,
        itemToExistInCompletion?: string,
        textToFilterCompletions?: string,
        itemToExistInCompletionAfterFilter?: string
    ) {
        await insertCodeCell('%pip install pandas', {
            index: 0
        });
        const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;

        await runCell(cell);

        // Wait till execution count changes and status is success.
        await waitForExecutionCompletedSuccessfully(cell);
        await insertCodeCell(
            `import pandas as pd\ndf = pd.read_csv("../src/test/datascience/notebook/intellisense/names.csv")\n`,
            {
                index: 1
            }
        );
        const cell2 = vscodeNotebook.activeNotebookEditor?.document.cellAt(1)!;

        await runCell(cell2);

        // Wait till execution count changes and status is success.
        await waitForExecutionCompletedSuccessfully(cell2);
        const cell3 = await insertCodeCell('import os\nprint(os.getcwd())\n');
        await runCell(cell3);

        // Wait till execution count changes and status is success.
        await waitForExecutionCompletedSuccessfully(cell3);
        traceInfo(`last cell output: ${getCellOutputs(cell3)}`);

        // Now add the cell to check intellisense.
        await insertCodeCell(cellCode);
        const cell4 = vscodeNotebook.activeNotebookEditor!.document.cellAt(3);

        const token = new CancellationTokenSource().token;
        // If we're testing string completions, ensure the cursor position is inside the string quotes.
        let position = new Position(
            0,
            cellCode.includes('"') || cellCode.includes("'") ? cellCode.length - 1 : cellCode.length
        );
        let context: CompletionContext = {
            triggerKind: triggerCharacter ? CompletionTriggerKind.TriggerCharacter : CompletionTriggerKind.Invoke,
            triggerCharacter
        };
        traceInfo('Get completions in test');
        let completions = await completionProvider.provideCompletionItems(cell4.document, position, token, context);
        await sleep(500);
        // Ask a second time as Jupyter can sometimes not be ready
        traceInfo('Get completions second time in test');
        completions = await completionProvider.provideCompletionItems(cell4.document, position, token, context);
        let items = completions.map((item) => item.label);
        assert.isOk(items.length);
        if (itemToExistInCompletion) {
            assert.ok(
                items.find((item) =>
                    typeof item === 'string'
                        ? item.includes(itemToExistInCompletion)
                        : item.label.includes(itemToExistInCompletion)
                )
            );
        } else {
            return;
        }
        if (itemToNotExistInCompletion) {
            assert.isUndefined(
                items.find((item) =>
                    typeof item === 'string'
                        ? item.includes(itemToNotExistInCompletion)
                        : item.label.includes(itemToNotExistInCompletion)
                )
            );
        }
        // Make sure it is skipping items that are already provided by pylance (no dupes)
        // Pylance isn't returning them right now: https://github.com/microsoft/vscode-jupyter/issues/8842
        // assert.notOk(
        //     items.find((item) => (typeof item === 'string' ? item.includes('Name') : item.label.includes('Name')))
        // );

        if (!textToFilterCompletions || !itemToExistInCompletionAfterFilter) {
            return;
        }
        // Add some text after the . and make sure we still get completions
        const edit = new WorkspaceEdit();
        edit.insert(cell4.document.uri, new Position(cellCode.length, 0), textToFilterCompletions);
        await workspace.applyEdit(edit);
        position = new Position(0, cellCode.length + textToFilterCompletions.length);
        completions = await completionProvider.provideCompletionItems(cell4.document, position, token, context);
        items = completions.map((item) => item.label);
        assert.isOk(items.length);
        assert.isUndefined(
            // Since we've filtered the completion the old item will no longer exist.
            items.find((item) =>
                typeof item === 'string'
                    ? item.includes(itemToExistInCompletion)
                    : item.label.includes(itemToExistInCompletion)
            )
        );
        assert.ok(
            items.find((item) =>
                typeof item === 'string'
                    ? item.includes(itemToExistInCompletionAfterFilter)
                    : item.label.includes(itemToExistInCompletionAfterFilter)
            )
        );
    }
    test('Dataframe completions', async () => {
        const fileName = path.basename(vscodeNotebook.activeNotebookEditor!.document.uri.fsPath);
        await testCompletions('df.', '.', fileName, 'Age', 'N', 'Name');
    });
    test('Dataframe column completions', async () => {
        const fileName = path.basename(vscodeNotebook.activeNotebookEditor!.document.uri.fsPath);
        await testCompletions('df.Name.', '.', fileName, 'add_prefix', 'add_s', 'add_suffix');
    });
    test('Dataframe assignment completions', async () => {
        const fileName = path.basename(vscodeNotebook.activeNotebookEditor!.document.uri.fsPath);
        await testCompletions('var_name = df.', '.', fileName, 'Age', 'N', 'Name');
    });
    test('Dataframe assignment column completions', async () => {
        const fileName = path.basename(vscodeNotebook.activeNotebookEditor!.document.uri.fsPath);
        await testCompletions(fileName.substring(0, 1), fileName);
    });
    test('File path completions with double quotes', async () => {
        const fileName = path.basename(vscodeNotebook.activeNotebookEditor!.document.uri.fsPath);
        await testCompletions(`"${fileName.substring(0, 1)}"`, undefined, fileName);
    });
    test('File path completions with single quotes', async () => {
        const fileName = path.basename(vscodeNotebook.activeNotebookEditor!.document.uri.fsPath);
        await testCompletions(`'${fileName.substring(0, 1)}'`, undefined, fileName);
    });
});
