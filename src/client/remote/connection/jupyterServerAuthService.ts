// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { ServerConnection } from '@jupyterlab/services';
import { inject, injectable } from 'inversify';
import { Event, EventEmitter, Uri, window } from 'vscode';
import { IDisposable, IDisposableRegistry } from '../../common/types';
import {
    IJupyterServerAuthServiceProvider,
    IJupyterServerConnectionInfo,
    JupyterServerConnectionId
} from '../ui/types';

let remoteConnections: IJupyterServerConnectionInfo[] = [];

export function getRemoteConnection(id: JupyterServerConnectionId): IJupyterServerConnectionInfo | undefined {
    return remoteConnections.find((item) => item.id === id);
}
@injectable()
export class JupyterServerAuthService implements IJupyterServerAuthServiceProvider, IDisposable {
    public get onDidAddServer(): Event<IJupyterServerConnectionInfo> {
        return this._onDidAddServer.event;
    }
    public get onDidRemoveServer(): Event<IJupyterServerConnectionInfo | undefined> {
        return this._onDidRemoveServer.event;
    }
    private readonly _onDidAddServer = new EventEmitter<IJupyterServerConnectionInfo>();
    private readonly _onDidRemoveServer = new EventEmitter<IJupyterServerConnectionInfo | undefined>();
    constructor(@inject(IDisposableRegistry) disposables: IDisposableRegistry) {
        disposables.push(this._onDidAddServer);
        disposables.push(this._onDidRemoveServer);
    }
    public isConnected(remoteFileUri: Uri): boolean {
        return remoteConnections.some((item) => item.fileScheme.toLowerCase() === remoteFileUri.scheme.toLowerCase());
    }
    public dispose() {
        remoteConnections = [];
    }
    public async getRemoteConnections(): Promise<Readonly<IJupyterServerConnectionInfo>[]> {
        return [...remoteConnections];
    }
    public async addServer(baseUrl?: string): Promise<void> {
        if (!baseUrl || typeof baseUrl !== 'string') {
            baseUrl = await window.showInputBox({ prompt: 'Enter Remote Url' });
        }
        if (!baseUrl) {
            return;
        }
        const token = await window.showInputBox({ prompt: 'Token', password: true });

        const settings = ServerConnection.makeSettings({ baseUrl, token });
        let fileScheme = Uri.parse(settings.baseUrl).authority.replace(/[^a-z0-9+]+/gi, '');
        // if we have other servers with the same scheme, then use the full url.
        if (remoteConnections.some((item) => item.fileScheme === fileScheme)) {
            fileScheme = settings.baseUrl.replace(/[^a-z0-9+]+/gi, '');
        }
        const info = {
            id: settings.baseUrl,
            fileScheme,
            settings
        };
        remoteConnections.push(info);
        this._onDidAddServer.fire(info);
    }
    public async logout(id: JupyterServerConnectionId): Promise<void> {
        const itemToRemove = remoteConnections.find((item) => item.id === id);
        remoteConnections = remoteConnections.filter((item) => item !== itemToRemove);
        this._onDidRemoveServer.fire(itemToRemove);
    }
}
