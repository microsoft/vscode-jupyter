// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// import type * as nbformat from '@jupyterlab/nbformat';
// import { assert } from 'chai';
// import * as fs from 'fs-extra';
// import * as path from '../../platform/vscode-path/path';
// import * as sinon from 'sinon';
// import { commands, notebook, NotebookController, workspace, WorkspaceEdit } from 'vscode';
// import { boolean } from 'yargs';
// import { IPythonExtensionChecker } from '../../../platform/api/types';
// import { IVSCodeNotebook } from '../../../platform/common/application/types';
// import { BufferDecoder } from '../../../platform/common/process/decoder';
// import { ProcessService } from '../../../platform/common/process/proc';
// import { IDisposable } from '../../../platform/common/types';
// import { JupyterNotebookView } from '../../../notebooks/constants';
// import { getTextOutputValue } from '../../../notebooks/helpers';
// import { IInterpreterService } from '../../../platform/interpreter/contracts';
// import { getOSType, IExtensionTestApi, OSType, waitForCondition } from '../../common';
// import { EXTENSION_ROOT_DIR_FOR_TESTS, IS_REMOTE_NATIVE_TEST } from '../../constants';
// import { closeActiveWindows, initialize, IS_CI_SERVER } from '../../initialize';
// import { openNotebook } from '../helpers';
// import {
//     assertHasTextOutputInVSCode,
//     canRunNotebookTests,
//     closeNotebooksAndCleanUpAfterTests,
//     createEmptyPythonNotebook,
//     createTemporaryNotebook,
//     runAllCellsInActiveNotebook,
//     insertCodeCell,
//     startJupyterServer,
//     waitForExecutionCompletedSuccessfully,
//     waitForKernelToChange,
//     waitForKernelToGetAutoSelected
// } from './helper';

// /* eslint-disable no-invalid-this, , , @typescript-eslint/no-explicit-any */
// suite('DataScience - VSCode Notebook - Kernel Selection', function () {
//     const disposables: IDisposable[] = [];
//     const templateIPynbFile = path.join(
//         EXTENSION_ROOT_DIR_FOR_TESTS,
//         'src/test/datascience/notebook/nbWithMetadata.ipynb'
//     );
//     let nbFile1: string;
//     let api: IExtensionTestApi;
//     let activeInterpreterPath: string;
//     let venvNoKernelPythonPath: string;
//     let venvKernelPythonPath: string;
//     let venvNoRegPythonPath: string;
//     let venvNoKernelDisplayName: string;
//     let venvKernelDisplayName: string;
//     let vscodeNotebook: IVSCodeNotebook;
//     this.timeout(60_000); // Slow test, we need to uninstall/install ipykernel.
//     let bogusController: NotebookController;
//     let bogusControllerSelected: boolean | undefined;
//     /*
//     This test requires a virtual environment to be created & registered as a kernel.
//     It also needs to have ipykernel installed in it.
//     */
//     suiteSetup(async function () {
//         this.timeout(120_000);
//         if (IS_REMOTE_NATIVE_TEST) {
//             return this.skip();
//         }
//         api = await initialize();
//         if (!(await canRunNotebookTests())) {
//             return this.skip();
//         }

//         const pythonChecker = api.serviceContainer.get<IPythonExtensionChecker>(IPythonExtensionChecker);
//         vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);

//         if (!pythonChecker.isPythonExtensionInstalled) {
//             return this.skip();
//         }

//         sinon.restore();
//     });

//     setup(async function () {
//         console.log(`Start test ${this.currentTest?.title}`);
//         bogusController = notebook.createNotebookController(
//             'bogusControllerForTests',
//             { viewType: JupyterNotebookView },
//             'Bogus'
//         );
//         disposables.push(bogusController);
//         bogusController.onDidChangeNotebookAssociation(
//             async ({ notebook, selected }) => {
//                 if (!selected) {
//                     return;
//                 }
//                 bogusControllerSelected = true;
//                 const edit = new WorkspaceEdit();
//                 const oldCustomMetadata: nbformat.INotebookContent = ((notebook.metadata
//                     .custom as unknown) as nbformat.INotebookContent) || {
//                     cells: [],
//                     metadata: {
//                         orig_nbformat: 1
//                     },
//                     nbformat: 4,
//                     nbformat_minor: 2
//                 };
//                 const notebookMetadata: nbformat.INotebookMetadata = {
//                     orig_nbformat: 4,
//                     kernelspec: {
//                         display_name: 'Custom',
//                         name: 'custom'
//                     },
//                     language_info: {
//                         name: 'cs'
//                     }
//                 };
//                 const updatedMetadata = notebook.metadata.with({
//                     custom: { ...oldCustomMetadata, ...notebookMetadata }
//                 });
//                 edit.replaceNotebookMetadata(notebook.uri, updatedMetadata);
//                 await workspace.applyEdit(edit);
//             },
//             undefined,
//             disposables
//         );
//         // Don't use same file (due to dirty handling, we might save in dirty.)
//         // Coz we won't save to file, hence extension will backup in dirty file and when u re-open it will open from dirty.
//         nbFile1 = await createTemporaryNotebook(templateIPynbFile, disposables, venvNoKernelDisplayName);
//         await closeActiveWindows();
//         sinon.restore();
//         console.log(`Start Test completed ${this.currentTest?.title}`);
//     });
//     teardown(async function () {
//         console.log(`End test ${this.currentTest?.title}`);
//         await closeNotebooksAndCleanUpAfterTests(disposables);
//         console.log(`End test completed ${this.currentTest?.title}`);
//     });

//     test('Validate custom notebook metadata (from 3rd party extension) is saved into ipynb', async function () {
//         await openNotebook(nbFile1);
//         await waitForKernelToGetAutoSelected(undefined);

//         // Verify the bogus controller is not selected.
//         assert.isFalse(bogusControllerSelected);
//         bogusController.
//         // Run all cells
//         await runAllCellsInActiveNotebook();
//         const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;
//         await waitForExecutionCompletedSuccessfully(cell);

//         // Confirm the executable printed as a result of code in cell `import sys;sys.executable`
//         assertHasTextOutputInVSCode(cell, venvNoKernelPythonPath, 0, false);
//     });
// });
