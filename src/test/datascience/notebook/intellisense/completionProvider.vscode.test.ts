// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import * as path from '../../../../platform/vscode-path/path';
import * as sinon from 'sinon';
import {
    CancellationToken,
    commands,
    CompletionContext,
    ConfigurationTarget,
    Position,
    TextDocument,
    Uri,
    workspace,
    WorkspaceConfiguration,
    WorkspaceEdit
} from 'vscode';
import { IVSCodeNotebook } from '../../../../platform/common/application/types';
import { traceInfo } from '../../../../platform/logging';
import { IDisposable } from '../../../../platform/common/types';
import {
    PythonKernelCompletionProvider,
    setIntellisenseTimeout
} from '../../../../standalone/intellisense/pythonKernelCompletionProvider';
import { IExtensionTestApi } from '../../../common.node';
import { IS_REMOTE_NATIVE_TEST } from '../../../constants.node';
import { EXTENSION_ROOT_DIR_FOR_TESTS, initialize } from '../../../initialize.node';
import {
    closeNotebooksAndCleanUpAfterTests,
    runCell,
    insertCodeCell,
    startJupyterServer,
    waitForExecutionCompletedSuccessfully,
    prewarmNotebooks,
    createEmptyPythonNotebook,
    getCellOutputs,
    waitForCompletions
} from '../helper.node';
import { Settings } from '../../../../platform/common/constants';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
[true, false].forEach((useJedi) => {
    suite(
        `DataScience - VSCode Intellisense Notebook - (Code Completion via Jupyter) ${
            useJedi ? 'withJedi' : 'withoutJedi'
        } @lsp`,
        function () {
            let api: IExtensionTestApi;
            const disposables: IDisposable[] = [];
            let vscodeNotebook: IVSCodeNotebook;
            let completionProvider: PythonKernelCompletionProvider;
            this.timeout(120_000);
            let previousPythonCompletionTriggerCharactersValue: string | undefined;
            let jupyterConfig: WorkspaceConfiguration;
            let previousJediSetting: boolean | undefined;

            suiteSetup(async function () {
                traceInfo(`Start Suite Code Completion via Jupyter`);
                this.timeout(120_000);
                jupyterConfig = workspace.getConfiguration('jupyter', undefined);
                previousPythonCompletionTriggerCharactersValue = jupyterConfig.get<string>(
                    'pythonCompletionTriggerCharacters'
                );
                previousJediSetting = jupyterConfig.get<boolean>('enableExtendedKernelCompletions');
                await jupyterConfig.update('enableExtendedKernelCompletions', useJedi, ConfigurationTarget.Global);
                await jupyterConfig.update('pythonCompletionTriggerCharacters', '.%"\'', ConfigurationTarget.Global);
                api = await initialize();
                if (IS_REMOTE_NATIVE_TEST()) {
                    // https://github.com/microsoft/vscode-jupyter/issues/6331
                    return this.skip();
                }
                await startJupyterServer();
                await prewarmNotebooks();
                sinon.restore();
                vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
                completionProvider =
                    api.serviceContainer.get<PythonKernelCompletionProvider>(PythonKernelCompletionProvider);
                traceInfo(`Start Suite (Completed) Code Completion via Jupyter`);
            });
            // Use same notebook without starting kernel in every single test (use one for whole suite).
            setup(async function () {
                traceInfo(`Start Test ${this.currentTest?.title}`);
                sinon.restore();
                await startJupyterServer();
                await createEmptyPythonNotebook(disposables, Uri.file(path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'tmp'))); // TODO, can't do this on web tests
                setIntellisenseTimeout(30000);
                traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
            });
            teardown(async function () {
                sinon.restore();
                traceInfo(`Ended Test ${this.currentTest?.title}`);
                setIntellisenseTimeout(Settings.IntellisenseTimeout);
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
                await jupyterConfig.update(
                    'enableExtendedKernelCompletions',
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
                await insertCodeCell('%pip install pandas', {
                    index: 0
                });
                const cell = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(0)!;

                await runCell(cell);

                const namesCsvPath = path.join(__dirname, 'names.csv').replace(/\\/g, '/').replace('out', 'src');

                // Wait till execution count changes and status is success.
                await waitForExecutionCompletedSuccessfully(cell);
                await insertCodeCell(`import pandas as pd\ndf = pd.read_csv("${namesCsvPath}")\n`, {
                    index: 1
                });
                const cell2 = vscodeNotebook.activeNotebookEditor?.notebook.cellAt(1)!;

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
                const cell4 = vscodeNotebook.activeNotebookEditor!.notebook.cellAt(3);
                // If we're testing string completions, ensure the cursor position is inside the string quotes.
                let position = new Position(
                    0,
                    cellCode.includes('"') || cellCode.includes("'") ? cellCode.length - 1 : cellCode.length
                );
                traceInfo('Get completions in test');
                let completions = await waitForCompletions(completionProvider, cell4, position, triggerCharacter);
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
                completions = await waitForCompletions(completionProvider, cell4, position, triggerCharacter);
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
                const fileName = path.basename(vscodeNotebook.activeNotebookEditor!.notebook.uri.fsPath);
                await testCompletions('df.', '.', fileName, 'Age', 'S', 'Sex');
            });
            test('Dataframe column completions', async () => {
                const fileName = path.basename(vscodeNotebook.activeNotebookEditor!.notebook.uri.fsPath);
                await testCompletions('df.Name.', '.', fileName, 'add_prefix', 'add_s', 'add_suffix');
            });
            test('Dataframe assignment completions', async () => {
                const fileName = path.basename(vscodeNotebook.activeNotebookEditor!.notebook.uri.fsPath);
                await testCompletions('var_name = df.', '.', fileName, 'Age', 'S', 'Sex');
            });
            test('Dataframe assignment column completions', async () => {
                const fileName = path.basename(vscodeNotebook.activeNotebookEditor!.notebook.uri.fsPath);
                await testCompletions(fileName.substring(0, 1), fileName);
            });
            test('File path completions with double quotes', async () => {
                const fileName = path.basename(vscodeNotebook.activeNotebookEditor!.notebook.uri.fsPath);
                await testCompletions(`"${fileName.substring(0, 1)}"`, undefined, fileName);
            });
            test('File path completions with single quotes', async () => {
                const fileName = path.basename(vscodeNotebook.activeNotebookEditor!.notebook.uri.fsPath);
                await testCompletions(`'${fileName.substring(0, 1)}'`, undefined, fileName);
            });
            test('Provider is registered', async () => {
                await insertCodeCell('print(1)', {
                    index: 0
                });
                let stubCalled = false;
                const stub = sinon.stub(completionProvider, 'provideCompletionItems');
                stub.callsFake(
                    async (
                        _document: TextDocument,
                        _position: Position,
                        _token: CancellationToken,
                        _context: CompletionContext
                    ) => {
                        stubCalled = true;
                        return [];
                    }
                );
                await insertCodeCell('a.', { index: 1 });
                const cell2 = vscodeNotebook.activeNotebookEditor!.notebook.cellAt(1);

                const position = new Position(0, 2);
                traceInfo('Get completions in test');
                // Executing the command `vscode.executeCompletionItemProvider` to simulate triggering completion
                await commands.executeCommand('vscode.executeCompletionItemProvider', cell2.document.uri, position);
                assert.ok(stubCalled, 'Completion provider not registered');
            });
        }
    );
});
