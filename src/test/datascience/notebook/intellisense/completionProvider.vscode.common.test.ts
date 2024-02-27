// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as path from '../../../../platform/vscode-path/path';
import * as sinon from 'sinon';
import { ConfigurationTarget, Position, window, workspace, WorkspaceConfiguration, WorkspaceEdit } from 'vscode';
import { traceInfo } from '../../../../platform/logging';
import { IDisposable } from '../../../../platform/common/types';
import { IS_REMOTE_NATIVE_TEST } from '../../../constants';
import {
    closeNotebooksAndCleanUpAfterTests,
    runCell,
    insertCodeCell,
    waitForExecutionCompletedSuccessfully,
    prewarmNotebooks,
    createEmptyPythonNotebook,
    getCellOutputs,
    waitForCompletions
} from '../helper';
import { IExtensionTestApi, initialize, startJupyterServer } from '../../../common';
import { KernelCompletionProvider } from '../../../../standalone/intellisense/kernelCompletionProvider';
import { IKernelProvider } from '../../../../kernels/types';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
[true, false].forEach((useJedi) => {
    suite(
        `DataScience - VSCode Intellisense Notebook - (Code Completion via Jupyter) ${
            useJedi ? 'withJedi' : 'withoutJedi'
        } @lsp`,
        function () {
            let api: IExtensionTestApi;
            const disposables: IDisposable[] = [];
            let kernelCompletionProviderRegistry: KernelCompletionProvider;
            this.timeout(120_000);
            let jupyterConfig: WorkspaceConfiguration;
            let previousJediSetting: boolean | undefined;

            suiteSetup(async function () {
                if (IS_REMOTE_NATIVE_TEST()) {
                    return this.skip();
                }
                traceInfo(`Start Suite Code Completion via Jupyter`);
                this.timeout(120_000);
                jupyterConfig = workspace.getConfiguration('jupyter', undefined);
                previousJediSetting = jupyterConfig.get<boolean>('enableExtendedPythonKernelCompletions');
                await jupyterConfig.update(
                    'enableExtendedPythonKernelCompletions',
                    useJedi,
                    ConfigurationTarget.Global
                );
                api = await initialize();
                await startJupyterServer();
                await prewarmNotebooks();
                sinon.restore();
                kernelCompletionProviderRegistry =
                    api.serviceContainer.get<KernelCompletionProvider>(KernelCompletionProvider);
                traceInfo(`Start Suite (Completed) Code Completion via Jupyter`);
            });
            // Use same notebook without starting kernel in every single test (use one for whole suite).
            setup(async function () {
                traceInfo(`Start Test ${this.currentTest?.title}`);
                sinon.restore();
                await startJupyterServer();
                await createEmptyPythonNotebook(disposables, undefined, true);
                traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
            });
            teardown(async function () {
                sinon.restore();
                traceInfo(`Ended Test ${this.currentTest?.title}`);
                await closeNotebooksAndCleanUpAfterTests(disposables);
                traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
            });
            suiteTeardown(async () => {
                await jupyterConfig.update(
                    'enableExtendedPythonKernelCompletions',
                    previousJediSetting,
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
                await insertCodeCell(
                    `import pandas as pd\ndf = pd.DataFrame({'Name': ['Foo', 'Bar', 'Baz'],'Sex': ['Male', 'Female', 'Male'],'Age': [1,2,3]})`,
                    {
                        index: 1
                    }
                );
                const cell = window.activeNotebookEditor?.notebook.cellAt(1)!;

                await runCell(cell);

                // Wait till execution count changes and status is success.
                await waitForExecutionCompletedSuccessfully(cell);
                const cell2 = await insertCodeCell('import os\nprint(os.getcwd())\n');
                await runCell(cell2);

                // Wait till execution count changes and status is success.
                await waitForExecutionCompletedSuccessfully(cell2);
                traceInfo(`last cell output: ${getCellOutputs(cell2)}`);

                // Now add the cell to check intellisense.
                await insertCodeCell(cellCode);
                const cell3 = window.activeNotebookEditor!.notebook.cellAt(3);
                // If we're testing string completions, ensure the cursor position is inside the string quotes.
                let position = new Position(
                    0,
                    cellCode.includes('"') || cellCode.includes("'") ? cellCode.length - 1 : cellCode.length
                );
                traceInfo('Get completions in test');
                const kernel = api.serviceContainer
                    .get<IKernelProvider>(IKernelProvider)
                    .get(window.activeNotebookEditor!.notebook)!;
                const completionProvider = kernelCompletionProviderRegistry.kernelCompletionProviders.get(kernel)!;
                let completions = await waitForCompletions(completionProvider, cell3, position, triggerCharacter);
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
                edit.insert(cell3.document.uri, new Position(cellCode.length, 0), textToFilterCompletions);
                await workspace.applyEdit(edit);
                position = new Position(0, cellCode.length + textToFilterCompletions.length);
                completions = await waitForCompletions(completionProvider, cell3, position, triggerCharacter);
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
                const fileName = path.basename(window.activeNotebookEditor!.notebook.uri.fsPath);
                await testCompletions('df.', '.', fileName, 'Age', 'S', 'Sex');
            });
            test.skip('Dataframe column completions', async () => {
                // https://github.com/microsoft/vscode-jupyter/issues/14012
                const fileName = path.basename(window.activeNotebookEditor!.notebook.uri.fsPath);
                await testCompletions('df.Name.', '.', fileName, 'add_prefix', 'add_s', 'add_suffix');
            });
            test('Dataframe assignment completions', async () => {
                const fileName = path.basename(window.activeNotebookEditor!.notebook.uri.fsPath);
                await testCompletions('var_name = df.', '.', fileName, 'Age', 'S', 'Sex');
            });
            test('Dataframe assignment column completions', async () => {
                const fileName = path.basename(window.activeNotebookEditor!.notebook.uri.fsPath);
                await testCompletions(fileName.substring(0, 1), fileName);
            });
            test('File path completions with double quotes', async () => {
                const fileName = path.basename(window.activeNotebookEditor!.notebook.uri.fsPath);
                await testCompletions(`"${fileName.substring(0, 1)}"`, undefined, fileName);
            });
            test('File path completions with single quotes', async () => {
                const fileName = path.basename(window.activeNotebookEditor!.notebook.uri.fsPath);
                await testCompletions(`'${fileName.substring(0, 1)}'`, undefined, fileName);
            });
        }
    );
});
