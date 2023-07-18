// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Disposable, Event, QuickPick, QuickPickItem, Uri } from 'vscode';

export interface JupyterServer {
    /**
     * Name of the server.
     */
    name: string;
    baseUrl: Uri;
    /**
     * Jupyter auth Token
     */
    token: string;
    /**
     * Authorization header to be used when connecting to the server.
     */
    authorizationHeader?: Record<string, string>;
    /**
     * The local directory that maps to the remote directory of the Jupyter Server.
     * E.g. assume you start Jupyter Notebook with --notebook-dir=/foo/bar,
     * and you have a file named /foo/bar/sample.ipynb, /foo/bar/sample2.ipynb and the like.
     * Then assume the mapped local directory will be /users/xyz/remoteServer and the files sample.ipynb and sample2.ipynb
     * are in the above local directory.
     *
     * Using this setting one can map the local directory to the remote directory.
     * In this case the value of this property would be /users/xyz/remoteServer.
     *
     * Note: A side effect of providing this value is the session names are generated the way they are in Jupyter Notebook/Lab.
     * I.e. the session names map to the relative path of the notebook file.
     * As a result when attempting to create a new session for a notebook/file, Jupyter will
     * first check if a session already exists for the same file and same kernel, and if so, will re-use that session.
     */
    mappedRemoteNotebookDir?: string;
    /**
     * Returns the sub-protocols to be used. See details of `protocols` here https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/WebSocket
     * Useful if there is a custom authentication scheme that needs to be used for WebSocket connections.
     * Note: The client side npm package @jupyterlab/services uses WebSockets to connect to remote Kernels.
     */
    webSocketProtocols?: string[];
}

export type ProviderResult<T> = T | undefined | null | Promise<T | undefined | null>;

export interface JupyterServerProvider {
    /**
     * Needs to be unique and the same across sessions.
     */
    readonly id: string;
    /**
     * Display name.
     */
    readonly name: string;
    /**
     * Detailed description.
     */
    readonly detail: string;
    /**
     * List of all known servers.
     */
    readonly servers: JupyterServer[];
    /**
     * Triggered when servers are added/removed.
     */
    onDidChangeServers?: Event<void>;
    /**
     * Called when the auth information needs to be populated for a server.
     */
    resolveServer(server: JupyterServer): Promise<JupyterServer>;
    /**
     * Called when a server is to be removed from the list of servers.
     */
    removeServer(server: JupyterServer): Promise<void>;
    /**
     * Provides full control of the quick pick to the extension, so that it can add additional buttons, etc.
     * The result of this promise should be the selected server or undefined if no server was selected.
     *
     * If nothing is selected, then the quick pick reverts back to the previous View before this method was invoked.
     */
    handleQuickPick?(quickPick: QuickPick<QuickPickItem>): ProviderResult<JupyterServer>;
}

export interface JupyterAPI {
    /**
     * Registers a remote server provider component that's used to pick remote jupyter server URIs
     * Useful if an extension supports connecting to multiple servers, this way
     * the extension can prompt the user to select a server.
     */
    registerRemoteServerProvider(serverProvider: JupyterServerProvider): Disposable;
    /**
     * Adds a remote Jupyter Server to the list of Remote Jupyter servers.
     * This will result in the Jupyter extension listing kernels from this server as items in the kernel picker.
     *
     * Useful when an extension would like to manually add a server to the list of servers.
     * I.e. bypassing the user from selecting a server.
     */
    addRemoteJupyterServer(server: JupyterServer): Promise<void>;
}
