// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export const __ = '';
// import assert from 'assert';
// import { ReactWrapper } from 'enzyme';
// import * as React from 'react';
// import { CodeLens, Uri } from 'vscode';

// import { ICommandManager, IDocumentManager } from '../../platform/common/application/types';
// import { Resource } from '../../platform/common/types';
// import { InteractiveWindow } from '../../platform/datascience/interactive-window/interactiveWindow';
// import {
//     ICodeWatcher,
//     IDataScienceCodeLensProvider,
//     IInteractiveWindow,
//     IInteractiveWindowProvider,
//     IJupyterExecution
// } from '../../platform/datascience/types';
// import { DataScienceIocContainer } from './dataScienceIocContainer';
// import { MockDocumentManager } from './mockDocumentManager';
// import { IMountedWebView } from './mountedWebView';
// import { addMockData, getCellResults } from './testHelpers';
// import { TestInteractiveWindowProvider } from './testInteractiveWindowProvider';

// export async function getInteractiveCellResults(
//     ioc: DataScienceIocContainer,
//     updater: () => Promise<void>,
//     window?: IInteractiveWindow | undefined
// ): Promise<ReactWrapper> {
//     const mountedWebView = ioc.get<TestInteractiveWindowProvider>(IInteractiveWindowProvider).getMountedWebView(window);
//     return getCellResults(mountedWebView, 'InteractiveCell', updater);
// }

// export async function getOrCreateInteractiveWindow(
//     ioc: DataScienceIocContainer,
//     owner?: Resource
// ): Promise<{ window: IInteractiveWindow; mount: IMountedWebView }> {
//     const interactiveWindowProvider = ioc.get<TestInteractiveWindowProvider>(IInteractiveWindowProvider);
//     const window = (await interactiveWindowProvider.getOrCreate(owner)) as InteractiveWindow;
//     const mount = interactiveWindowProvider.getMountedWebView(window);
//     await window.show();
//     return { window, mount };
// }

// export function createCodeWatcher(
//     docText: string,
//     docName: string,
//     ioc: DataScienceIocContainer
// ): ICodeWatcher | undefined {
//     const doc = ioc.addDocument(docText, docName);
//     const codeLensProvider = ioc.get<IDataScienceCodeLensProvider>(IDataScienceCodeLensProvider);
//     return codeLensProvider.getCodeWatcher(doc);
// }

// export async function runCodeLens(
//     uri: Uri,
//     codeLens: CodeLens | undefined,
//     ioc: DataScienceIocContainer
// ): Promise<void> {
//     const documentManager = ioc.get<MockDocumentManager>(IDocumentManager);
//     await documentManager.showTextDocument(uri);
//     const commandManager = ioc.get<ICommandManager>(ICommandManager);
//     if (codeLens && codeLens.command) {
//         // eslint-disable-next-line @typescript-eslint/no-explicit-any
//         await commandManager.executeCommand(codeLens.command.command as any, ...codeLens.command.arguments);
//     }
// }

// export function closeInteractiveWindow(ioc: DataScienceIocContainer, window: IInteractiveWindow) {
//     const promise = window.dispose();
//     ioc.get<TestInteractiveWindowProvider>(IInteractiveWindowProvider).getMountedWebView(window).dispose();
//     return promise;
// }

// export function runTest(
//     name: string,
//     // eslint-disable-next-line @typescript-eslint/no-explicit-any
//     testFunc: (context: Mocha.Context) => Promise<void>,
//     getIOC: () => DataScienceIocContainer
// ) {
//     test(name, async function () {
//         const ioc = getIOC();
//         const jupyterExecution = ioc.get<IJupyterExecution>(IJupyterExecution);
//         if (await jupyterExecution.isNotebookSupported()) {
//             addMockData(ioc, 'a=1\na', 1);
//             // eslint-disable-next-line no-invalid-this
//             await testFunc(this);
//         } else {
//             // eslint-disable-next-line no-invalid-this
//             this.skip();
//         }
//     });
// }

// export async function addCode(
//     ioc: DataScienceIocContainer,
//     code: string,
//     expectError: boolean = false,
//     uri: Uri = Uri.file('foo.py')
//     // eslint-disable-next-line @typescript-eslint/no-explicit-any
// ): Promise<ReactWrapper<any, Readonly<{}>, React.Component>> {
//     const { window } = await getOrCreateInteractiveWindow(ioc);
//     return getInteractiveCellResults(ioc, async () => {
//         const success = await window.addCode(code, uri, 2);
//         if (expectError) {
//             assert.equal(success, false, `${code} did not produce an error`);
//         }
//     });
// }
