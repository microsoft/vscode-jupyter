// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// import { Uri } from 'vscode';
// import {
//     JupyterServer,
//     JupyterServerCollection,
//     JupyterServerConnectionInformation,
//     JupyterServerCreationItem
// } from '../../../api.proposed';
// import { Disposables } from '../../../platform/common/utils';

// class JupyterServerImpl extends Disposables implements JupyterServer {
//     id: string;
//     label: string;
//     constructor(
//         id: string,
//         label: string,
//         public resolveConnectionInformation: () => Promise<JupyterServerConnectionInformation>
//     ) {
//         super();
//         this.id = id;
//         this.label = label;
//     }
// }
// class JupyterServerCreationItemImpl extends Disposables implements JupyterServerCreationItem {
//     label: string;
//     detail?: string | undefined;
//     sortText?: string | undefined;
//     picked?: boolean | undefined;
//     constructor(
//         label: string,
//         public readonly onSelect: () => Promise<JupyterServer | undefined>
//     ) {
//         super();
//         this.label = label;
//     }
// }
// class JupyterServerCollectionImpl extends Disposables implements JupyterServerCollection {
//     public documentation?: Uri;
//     private _servers = new Set<JupyterServer>();
//     public get servers(): JupyterServer[] {
//         return Array.from(this._servers);
//     }
//     private _creationItems = new Set<JupyterServerCreationItem>();
//     public get creationItems(): JupyterServerCreationItem[] {
//         return Array.from(this._creationItems);
//     }

//     constructor(
//         public readonly id: string,
//         public label: string,
//         public readonly extensionId: string
//     ) {
//         super();
//     }
//     createServer(
//         id: string,
//         label: string,
//         resolveConnectionInformation: () => Promise<JupyterServerConnectionInformation>
//     ): JupyterServer {
//         const item = new JupyterServerImpl(id, label, resolveConnectionInformation);
//         this._servers.add(item);
//         item.onDidDispose(() => this._servers.delete(item));
//         return item;
//     }
//     createServerCreationItem(
//         label: string,
//         onDidSelect: () => Promise<JupyterServer | undefined>
//     ): JupyterServerCreationItem {
//         const item = new JupyterServerCreationItemImpl(label, onDidSelect);
//         this._creationItems.add(item);
//         item.onDidDispose(() => this._creationItems.delete(item));
//         return item;
//     }
// }
// export class JupyterServerRegistry {
//     _collections = new Set<JupyterServerCollection>();
//     get collections(): JupyterServerCollection[] {
//         return Array.from(this._collections);
//     }
//     createServerCollection(id: string, label: string, extensionId: string): Promise<JupyterServerCollection> {
//         const collection = new JupyterServerCollectionImpl(id, label, extensionId);
//         this._collections.add(collection);
//         collection.onDidDispose(() => this._collections.delete(collection));

//         return Promise.resolve(collection);
//     }
// }
