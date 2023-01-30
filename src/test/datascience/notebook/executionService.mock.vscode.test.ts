// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

//
// /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
// import { assert } from 'chai';
// import * as sinon from 'sinon';
// import { Common } from '../../../platform/common/utils/localize';
// import { IVSCodeNotebook } from '../../../platform/common/application/types';
// import { traceInfo } from '../../../platform/common/logger.node';
// import { IDisposable, Product } from '../../../platform/common/types';
// import { IExtensionTestApi } from '../../common';
// import { initialize } from '../../initialize';
// import {
//     canRunNotebookTests,
//     closeNotebooksAndCleanUpAfterTests,
//     insertCodeCell,
//     startJupyterServer,
//     waitForExecutionCompletedSuccessfully,
//     hijackPrompt,
//     createEmptyPythonNotebook,
// //     waitForTextOutput
// } from './helper';
// import { ProductNames } from '../../../platform/common/installer/productNames';
// import { INotebookControllerManager } from '../../../notebooks/types';
// import { IKernelProvider } from '../../../kernels/types';
// import {
//     IJupyterKernelConnectionSession,
//     INotebook,
//     INotebookProvider,
//     KernelSocketInformation
// } from '../../../platform/datascience/types';
// import { instance, mock, when } from 'ts-mockito';
// import { Subject } from 'rxjs-compat/Subject';
// import { EventEmitter, NotebookDocument } from 'vscode';
// import { ServerStatus } from '../../../webviews/webview-side/interactive-common/mainState';
// import { MockJupyterSession } from '../mockJupyterSession';
// import type * as nbformat from '@jupyterlab/nbformat';

// // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
// const expectedPromptMessageSuffix = `requires ${ProductNames.get(Product.ipykernel)!} to be installed.`;

// /* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
// suite('VSCode Notebook -', function () {
//     let api: IExtensionTestApi;
//     const disposables: IDisposable[] = [];
//     let vscodeNotebook: IVSCodeNotebook;
//     // const templateNbPath = path.join(
//     //     EXTENSION_ROOT_DIR_FOR_TESTS,
//     //     'src',
//     //     'test',
//     //     'datascience',
//     //     'notebook',
//     //     'emptyCellWithOutput.ipynb'
//     // );

//     this.timeout(120_000);
//     let controllerManager: INotebookControllerManager;
//     let inotebook: INotebook;
//     let notebookProvider: INotebookProvider;
//     suiteSetup(async function () {
//         return this.skip();
//         traceInfo('Suite Setup');
//         this.timeout(120_000);
//         api = await initialize();
//         if (!(await canRunNotebookTests())) {
//             return this.skip();
//         }
// //         await hijackPrompt(
//             'showErrorMessage',
//             { endsWith: expectedPromptMessageSuffix },
//             { text: Common.install, clickImmediately: true },
//             disposables
//         );

//         await startJupyterServer();
//         // await prewarmNotebooks();
//         sinon.restore();
//         vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
//         controllerManager = api.serviceContainer.get<INotebookControllerManager>(INotebookControllerManager);
//         notebookProvider = api.serviceContainer.get<INotebookProvider>(INotebookProvider);
//         traceInfo('Suite Setup (completed)');
//     });
//     // Use same notebook without starting kernel in every single test (use one for whole suite).
//     setup(async function () {
//         traceInfo(`Start Test ${this.currentTest?.title}`);
//         sinon.restore();
//         await startJupyterServer();
//         await createEmptyPythonNotebook(disposables);
//         assert.isOk(vscodeNotebook.activeNotebookEditor, 'No active notebook');
//         traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
//     });
//     teardown(async function () {
//         traceInfo(`Ended Test ${this.currentTest?.title}`);
//         // Added temporarily to identify why tests are failing.
//         process.env.VSC_JUPYTER_LOG_KERNEL_OUTPUT = undefined;
//         await closeNotebooksAndCleanUpAfterTests(disposables);
//         traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
//     });
//     suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));
//     function createKernelWithMockJupyterSession(notebook: NotebookDocument, session: IJupyterKernelConnectionSession) {
//         const controller = controllerManager.getSelectedNotebookController(notebook);
//         if (!controller) {
//             return;
//         }
//         const kernelProvider = api.serviceContainer.get<IKernelProvider>(IKernelProvider);
//         void kernelProvider.get(notebook)?.dispose();
//         inotebook = mock<INotebook>();
//         const notebookInstance = instance(inotebook);
//         (notebookInstance as any).then = undefined;
//         sinon.stub(notebookProvider, 'getOrCreateNotebook').resolves(notebookInstance);

//         const onDisposed = new EventEmitter<void>();
//         disposables.push(onDisposed);
//         when(inotebook.dispose()).thenResolve();
//         when(inotebook.onDisposed).thenReturn(onDisposed.event);
//         when(inotebook.connection).thenReturn(undefined);
//         const observableResult = new Subject();
//         observableResult.next();
//         observableResult.complete();
//         const kernelSocket = new Subject<KernelSocketInformation>();
//         kernelSocket.next();
//         kernelSocket.complete();
//         // when(inotebook.kernelSocket).thenReturn(kernelSocket.asObservable());
//         // const statusChange = ServerStatus.Idle;
//         // when(inotebook.status).thenReturn(statusChange);
//         const statusEvent = new EventEmitter<ServerStatus>();
//         disposables.push(statusEvent);
//         // when(inotebook.onSessionStatusChanged).thenReturn(statusEvent.event);
//         // when(inotebook.setLaunchingFile(anything())).thenResolve();
//         // when(inotebook.requestKernelInfo()).thenResolve({
//         //     channel: 'shell',
//         //     content: {
//         //         banner: '',
//         //         help_links: [],
//         //         implementation: '',
//         //         implementation_version: '',
//         //         language_info: { name: '', version: '' },
//         //         protocol_version: '',
//         //         status: 'ok'
//         //     },
//         //     header: {
//         //         date: '',
//         //         msg_id: '',
//         //         msg_type: 'kernel_info_reply',
//         //         session: '',
//         //         username: '',
//         //         version: ''
//         //     },
//         //     metadata: {},
//         //     parent_header: {
//         //         date: '',
//         //         msg_id: '',
//         //         msg_type: 'kernel_info_request',
//         //         session: '',
//         //         username: '',
//         //         version: ''
//         //     }
//         // });
//         // when(inotebook.waitForIdle(anything())).thenResolve();
//         when(inotebook.session).thenReturn(session);
//         return kernelProvider.getOrCreate(notebook, {
//             controller: controller.controller,
//             resourceUri: notebook.uri,
//             metadata: controller.connection
//         });
//     }
//     test('Execute cell', async () => {
//         await insertCodeCell('print("123412341234")', { index: 0 });
//         const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;

//         const nbCell: nbformat.ICodeCell = {
//             cell_type: 'code',
//             execution_count: 1,
//             metadata: {},
//             outputs: [<nbformat.IStream>{ name: 'stdout', output_type: 'stream', text: '123412341234' }],
//             source: 'print("123412341234")'
//         };
//         const session = new MockJupyterSession([nbCell], 0);
//         const kernel = createKernelWithMockJupyterSession(cell.notebook, session);

//         // Wait till execution count changes and status is success.
//         await Promise.all([
//             kernel?.executeCell(cell),
//             waitForTextOutput(cell, '123412341234', 0, false),
//             waitForExecutionCompletedSuccessfully(cell)
//         ]);
//     });
//     test('Execute a cell that prints and clears the output 100s of times (once each iteration)', async () => {
//         const source = 'large forloop, in each cell we clear and print, then finally print a completed message';
//         await insertCodeCell(source, { index: 0 });
//         const cell = vscodeNotebook.activeNotebookEditor?.document.cellAt(0)!;
//         const nbCell: nbformat.ICodeCell = {
//             cell_type: 'code',
//             execution_count: 1,
//             metadata: {},
//             outputs: [],
//             source
//         };
//         for (let i = 0; i < 100; i++) {
//             nbCell.outputs.push({ output_type: 'clear_true', text: '' }); // Special message for our stubs..
//             nbCell.outputs.push(<nbformat.IStream>{ name: 'stdout', output_type: 'stream', text: `${i}\n` });
//         }
//         nbCell.outputs.push(<nbformat.IStream>{ name: 'stdout', output_type: 'stream', text: 'Completed\n' });
//         const session = new MockJupyterSession([nbCell], 0);
//         const kernel = createKernelWithMockJupyterSession(cell.notebook, session);

//         await Promise.all([
//             kernel?.executeCell(cell),
//             waitForExecutionCompletedSuccessfully(cell),
//             waitForTextOutput(cell, 'Completed', 0, false),
//             waitForTextOutput(cell, '99', 0, false)
//         ]);
//     });
// });
