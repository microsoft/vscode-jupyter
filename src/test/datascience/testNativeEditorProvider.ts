// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
export const __ = '';
// import { inject, injectable } from 'inversify';
// import uuid from 'uuid/v4';
// import { CustomDocument, Uri, WebviewPanel } from 'vscode';

// import { ICommandManager, IDocumentManager, IWorkspaceService } from '../../platform/common/application/types';
// import { IFileSystem } from '../../platform/common/platform/types.node';
// import { IAsyncDisposableRegistry, IConfigurationService, IDisposableRegistry } from '../../platform/common/types';
// import { createDeferred, Deferred } from '../../platform/common/utils/async';
// import { NativeEditor } from '../../platform/datascience/interactive-ipynb/nativeEditor';
// import { NativeEditorProviderOld } from '../../platform/datascience/interactive-ipynb/nativeEditorProviderOld';
// import { NativeEditorProvider } from '../../notebooksStorage/nativeEditorProvider';
// import { NativeEditorNotebookModel } from '../../notebooksStorage/notebookModel';
// import { INotebookStorageProvider } from '../../notebooksStorage/notebookStorageProvider';
// import {
//     IDataScienceErrorHandler,
//     INotebookEditor,
//     INotebookEditorProvider,
//     INotebookProvider
// } from '../../platform/datascience/types';
// import { ClassType, IServiceContainer } from '../../platform/ioc/types';
// import { DataScienceIocContainer } from './dataScienceIocContainer';
// import { IMountedWebView, WaitForMessageOptions } from './mountedWebView';
// import { mountConnectedMainPanel } from './testHelpers';

// export interface ITestNativeEditorProvider extends INotebookEditorProvider {
//     getMountedWebView(window: INotebookEditor | undefined): IMountedWebView;
//     waitForMessage(file: Uri | undefined, message: string, options?: WaitForMessageOptions): Promise<void>;
//     getCustomDocument(file: Uri): CustomDocument | undefined;
// }

// // Mixin class to provide common functionality between the two different native editor providers.
// function TestNativeEditorProviderMixin<T extends ClassType<NativeEditorProvider>>(SuperClass: T) {
//     return class extends SuperClass implements ITestNativeEditorProvider {
//         private windowToMountMap = new Map<string, IMountedWebView>();
//         private pendingMessageWaits: {
//             message: string;
//             options?: WaitForMessageOptions;
//             deferred: Deferred<void>;
//         }[] = [];

//         // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-useless-constructor
//         constructor(...rest: any[]) {
//             super(...rest);
//         }
//         public getMountedWebView(window: INotebookEditor | undefined): IMountedWebView {
//             const key = window ? window.file.toString() : this.editors[0].file.toString();
//             if (!this.windowToMountMap.has(key)) {
//                 throw new Error('Test Failure: Window not mounted yet.');
//             }
//             return this.windowToMountMap.get(key)!;
//         }
//         public waitForMessage(file: Uri | undefined, message: string, options?: WaitForMessageOptions): Promise<void> {
//             // We may already have this editor. Check
//             const key = file ? file.toString() : undefined;
//             if (key && this.windowToMountMap.has(key)) {
//                 return this.windowToMountMap.get(key)!.waitForMessage(message, options);
//             }

//             // Otherwise pend for the next create.
//             this.pendingMessageWaits.push({ message, options, deferred: createDeferred() });
//             return this.pendingMessageWaits[this.pendingMessageWaits.length - 1].deferred.promise;
//         }

//         public getCustomDocument(file: Uri) {
//             return this.customDocuments.get(file.fsPath);
//         }

//         protected createNotebookEditor(model: NativeEditorNotebookModel, panel?: WebviewPanel): NativeEditor {
//             // Generate the mount wrapper using a custom id
//             const id = uuid();
//             const mounted = this.ioc!.createWebView(() => mountConnectedMainPanel('native'), id);

//             // Might have a pending wait for message
//             if (this.pendingMessageWaits.length) {
//                 const list = [...this.pendingMessageWaits];
//                 this.pendingMessageWaits = [];
//                 list.forEach((p) => {
//                     mounted
//                         .waitForMessage(p.message, p.options)
//                         .then(() => {
//                             p.deferred.resolve();
//                         })
//                         .catch((e) => p.deferred.reject(e));
//                 });
//             }

//             // Create the real editor.
//             const result = super.createNotebookEditor(model, panel);

//             // Associate the real create with our mount in order to find the wrapper
//             const key = result.file.toString();
//             this.windowToMountMap.set(key, mounted);
//             mounted.onDisposed(() => this.windowToMountMap.delete(key));

//             // Also need the css request so that other messages can go through
//             const webHost = result as NativeEditor;
//             webHost.setTheme(false);

//             return result;
//         }
//         private get ioc(): DataScienceIocContainer | undefined {
//             return this.serviceContainer.get<DataScienceIocContainer>(DataScienceIocContainer);
//         }
//     };
// }

// @injectable()
// export class TestNativeEditorProvider extends TestNativeEditorProviderMixin(NativeEditorProvider) {
//     // eslint-disable-next-line @typescript-eslint/no-useless-constructor
//     constructor(
//         @inject(IServiceContainer) serviceContainer: IServiceContainer,
//         @inject(IAsyncDisposableRegistry) asyncRegistry: IAsyncDisposableRegistry,
//         @inject(IDisposableRegistry) disposables: IDisposableRegistry,
//         @inject(IWorkspaceService) workspace: IWorkspaceService,
//         @inject(IConfigurationService) configuration: IConfigurationService,
//         @inject(INotebookStorageProvider) storage: INotebookStorageProvider,
//         @inject(INotebookProvider) notebookProvider: INotebookProvider,
//         @inject(IFileSystem) fs: IFileSystem
//     ) {
//         super(serviceContainer, asyncRegistry, disposables, workspace, configuration, storage, notebookProvider, fs);
//     }
// }

// @injectable()
// export class TestNativeEditorProviderOld extends TestNativeEditorProviderMixin(NativeEditorProviderOld) {
//     // eslint-disable-next-line @typescript-eslint/no-useless-constructor
//     constructor(
//         @inject(IServiceContainer) serviceContainer: IServiceContainer,
//         @inject(IAsyncDisposableRegistry) asyncRegistry: IAsyncDisposableRegistry,
//         @inject(IDisposableRegistry) disposables: IDisposableRegistry,
//         @inject(IWorkspaceService) workspace: IWorkspaceService,
//         @inject(IConfigurationService) configuration: IConfigurationService,
//         @inject(IFileSystem) fs: IFileSystem,
//         @inject(IDocumentManager) documentManager: IDocumentManager,
//         @inject(ICommandManager) cmdManager: ICommandManager,
//         @inject(IDataScienceErrorHandler) dataScienceErrorHandler: IDataScienceErrorHandler,
//         @inject(INotebookStorageProvider) storage: INotebookStorageProvider,
//         @inject(INotebookProvider) notebookProvider: INotebookProvider
//     ) {
//         super(
//             serviceContainer,
//             asyncRegistry,
//             disposables,
//             workspace,
//             configuration,
//             fs,
//             documentManager,
//             cmdManager,
//             dataScienceErrorHandler,
//             storage,
//             notebookProvider
//         );
//     }
// }
