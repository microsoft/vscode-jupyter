// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Contents } from '@jupyterlab/services';
import { Event, FileSystemProvider, Uri } from 'vscode';
import { IDisposable } from '../../common/types';

export interface IFileSystemProvider extends FileSystemProvider, IDisposable {}

export const IRemoteJupyterConnectionsService = Symbol('IRemoteJupyterConnectionsService');
export type JupyterServerConnection = {
    id: string;
    displayName: string;
    fileScheme: string;
};
export const IJupyterServerConnectionService = Symbol('IJupyterServerConnectionService');
export interface IJupyterServerConnectionService {
    onDidAddServer: Event<JupyterServerConnection>;
    onDidRemoveServer: Event<JupyterServerConnection | undefined>;
    getConnections(): Promise<JupyterServerConnection[]>;
    /**
     * Whether we're connected to a remote server that can handle a specific Remote Uri.
     */
    isConnected(remoteFileUri: Uri): boolean;
    /**
     * Add a new server to the list, if a base url is provided use that instead of asking user to enter it.
     * At this point, user is merely prompted to enter the credentials/token (if required).
     */
    addServer(baseUrl?: string): Promise<void>;
    logout(id: string): Promise<void>;
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
