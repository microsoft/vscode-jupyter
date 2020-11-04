// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Contents, ServerConnection } from '@jupyterlab/services';
import { Event, FileSystemProvider, Uri } from 'vscode';
import { IDisposable } from '../../common/types';

export type JupyterServerConnectionId = string;
/**
 * fileScheme & baseUrl are considered unique across all Servers.
 * fileScheme = baseUrl (without any of the special characters)
 */
export interface IJupyterServerConnectionInfo {
    id: JupyterServerConnectionId;
    fileScheme: string;
    settings: Readonly<ServerConnection.ISettings>;
}

export function getJupyterServerAuthInfoId(authInfo: IJupyterServerConnectionInfo) {
    return authInfo.fileScheme;
}
export interface IFileSystemProvider extends FileSystemProvider, IDisposable {}

export const IJupyterServerAuthServiceProvider = Symbol('IJupyterServerAuthServiceProvider');
export interface IJupyterServerAuthServiceProvider {
    onDidAddServer: Event<IJupyterServerConnectionInfo>;
    onDidRemoveServer: Event<IJupyterServerConnectionInfo | undefined>;
    getRemoteConnections(): Promise<IJupyterServerConnectionInfo[]>;
    /**
     * Whether we're connected to a remote server that can handle a specific Remote Uri.
     */
    isConnected(remoteFileUri: Uri): boolean;
    addServer(baseUrl?: string): Promise<void>;
    logout(id: JupyterServerConnectionId): Promise<void>;
}

export type FileEntry = Contents.IModel & {
    type: 'file' | 'notebook';
    size: number;
};
export type DirectoryEntry = Contents.IModel & {
    type: 'directory';
    size: number;
    readonly content?: (DirectoryEntry | FileEntry)[];
};
export type DirectoryResponse = Contents.IModel & {
    readonly content: (DirectoryEntry | FileEntry)[];
};
