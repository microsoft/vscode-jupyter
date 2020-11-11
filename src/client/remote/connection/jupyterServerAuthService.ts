// // Copyright (c) Microsoft Corporation. All rights reserved.
// // Licensed under the MIT License.

// import { ServerConnection } from '@jupyterlab/services';
// import { inject, injectable } from 'inversify';
// import { Event, EventEmitter, Uri, window } from 'vscode';
// import { IExtensionSingleActivationService } from '../../activation/types';
// import { IWorkspaceService } from '../../common/application/types';
// import { IDisposable, IDisposableRegistry } from '../../common/types';
// import { Identifiers } from '../../datascience/constants';
// import { createRemoteConnectionInfo } from '../../datascience/jupyter/jupyterUtils';
// import { JupyterServerSelector } from '../../datascience/jupyter/serverSelector';
// import {
//     IJupyterServerUri,
//     IJupyterUriProviderRegistration,
//     INotebookServerOptions,
//     JupyterServerUriHandle
// } from '../../datascience/types';
// import {
//     IJupyterServerAuthServiceProvider,
//     IJupyterServerConnectionInfo,
//     JupyterServerConnectionId
// } from '../ui/types';

// let remoteConnections: IJupyterServerConnectionInfo[] = [];

// export function getRemoteConnection(id: JupyterServerConnectionId): IJupyterServerConnectionInfo | undefined {
//     return remoteConnections.find((item) => item.id === id);
// }
// @injectable()
// export class JupyterServerAuthService
//     implements IJupyterServerAuthServiceProvider, IDisposable, IExtensionSingleActivationService {
//     public get onDidAddServer(): Event<IJupyterServerConnectionInfo> {
//         return this._onDidAddServer.event;
//     }
//     public get onDidRemoveServer(): Event<IJupyterServerConnectionInfo | undefined> {
//         return this._onDidRemoveServer.event;
//     }
//     private readonly _onDidAddServer = new EventEmitter<IJupyterServerConnectionInfo>();
//     private readonly _onDidRemoveServer = new EventEmitter<IJupyterServerConnectionInfo | undefined>();
//     private uriToJupyterServerUri = new Map<string, IJupyterServerUri>();
//     private pendingTimeouts: (NodeJS.Timeout | number)[] = [];
//     constructor(
//         @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
//         @inject(IJupyterUriProviderRegistration)
//         private readonly jupyterPickerRegistration: IJupyterUriProviderRegistration,
//         @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
//         @inject(JupyterServerSelector) private readonly serverSelector: JupyterServerSelector
//     ) {
//         disposables.push(this._onDidAddServer);
//         disposables.push(this._onDidRemoveServer);
//     }
//     public async activate() {
//         this.workspace.onDidChangeConfiguration(
//             (e) => {
//                 if (e.affectsConfiguration('jupyter.jupyterServerType', undefined)) {
//                     // When server URI changes, clear our pending URI timeouts
//                     this.clearTimeouts();
//                 }
//             },
//             this,
//             this.disposables
//         );
//     }
//     public isConnected(remoteFileUri: Uri): boolean {
//         return remoteConnections.some((item) => item.fileScheme.toLowerCase() === remoteFileUri.scheme.toLowerCase());
//     }
//     public dispose() {
//         remoteConnections = [];
//         this.clearTimeouts();
//     }
//     public async getRemoteConnections(): Promise<Readonly<IJupyterServerConnectionInfo>[]> {
//         return [...remoteConnections];
//     }
//     public async addServer(baseUrl?: string): Promise<void> {
//         const uri = await this.serverSelector.selectJupyterURI(false);
//         // tslint:disable-next-line: no-console
//         console.log(uri);
//         if (!baseUrl || typeof baseUrl !== 'string') {
//             baseUrl = await window.showInputBox({ prompt: 'Enter Remote Url' });
//         }
//         if (!baseUrl) {
//             return;
//         }
//         const token = await window.showInputBox({ prompt: 'Token', password: true });

//         const settings = ServerConnection.makeSettings({ baseUrl, token });
//         let fileScheme = Uri.parse(settings.baseUrl).authority.replace(/[^a-z0-9+]+/gi, '');
//         // if we have other servers with the same scheme, then use the full url.
//         if (remoteConnections.some((item) => item.fileScheme === fileScheme)) {
//             fileScheme = settings.baseUrl.replace(/[^a-z0-9+]+/gi, '');
//         }
//         const info = {
//             id: settings.baseUrl,
//             fileScheme,
//             settings
//         };
//         remoteConnections.push(info);
//         this._onDidAddServer.fire(info);
//     }
//     public async logout(id: JupyterServerConnectionId): Promise<void> {
//         const itemToRemove = remoteConnections.find((item) => item.id === id);
//         remoteConnections = remoteConnections.filter((item) => item !== itemToRemove);
//         this._onDidRemoveServer.fire(itemToRemove);
//     }

//     public async getRemoteConnectionInfo(options: INotebookServerOptions & { uri: string }) {
//         await this.updateServerUri(options.uri);
//         const getServerUri = (uri: string): IJupyterServerUri | undefined => {
//             const idAndHandle = this.extractJupyterServerHandleAndId(uri);
//             if (idAndHandle) {
//                 return this.uriToJupyterServerUri.get(uri);
//             }
//         };
//         return createRemoteConnectionInfo(options.uri, getServerUri);
//     }
//     // private async addNewServer() {
//     //     const uri = await this.serverSelector.selectJupyterURI(false);
//     // }

//     private clearTimeouts() {
//         // tslint:disable-next-line: no-any
//         this.pendingTimeouts.forEach((t) => clearTimeout(t as any));
//         this.pendingTimeouts = [];
//     }
//     private async updateServerUri(uri: string): Promise<void> {
//         const idAndHandle = this.extractJupyterServerHandleAndId(uri);
//         if (idAndHandle) {
//             const serverUri = await this.jupyterPickerRegistration.getJupyterServerUri(
//                 idAndHandle.id,
//                 idAndHandle.handle
//             );
//             this.uriToJupyterServerUri.set(uri, serverUri);
//             // See if there's an expiration date
//             if (serverUri.expiration) {
//                 const timeoutInMS = serverUri.expiration.getTime() - Date.now();
//                 // Week seems long enough (in case the expiration is ridiculous)
//                 if (timeoutInMS > 0 && timeoutInMS < 604800000) {
//                     this.pendingTimeouts.push(setTimeout(() => this.updateServerUri(uri).ignoreErrors(), timeoutInMS));
//                 }
//             }
//         }
//     }
//     private extractJupyterServerHandleAndId(uri: string): { handle: JupyterServerUriHandle; id: string } | undefined {
//         const url: URL = new URL(uri);

//         // Id has to be there too.
//         const id = url.searchParams.get(Identifiers.REMOTE_URI_ID_PARAM);
//         const uriHandle = url.searchParams.get(Identifiers.REMOTE_URI_HANDLE_PARAM);
//         return id && uriHandle ? { handle: uriHandle, id } : undefined;
//     }
// }
