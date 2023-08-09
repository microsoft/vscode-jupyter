// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken } from 'vscode';
import { Command, Event, Uri } from 'vscode';

declare module './api' {
    /**
     * Provides information required to connect to a Jupyter Server.
     */
    export interface JupyterServerConnectionInformation {
        /**
         * Base Url of the Jupyter Server
         */
        readonly baseUrl: Uri;
        /**
         * Jupyter auth Token
         */
        readonly token: string;
        /**
         * Authorization header to be used when connecting to the server.
         */
        readonly authorizationHeader?: Record<string, string>;
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
        readonly mappedRemoteNotebookDir?: Uri;
        /**
         * Returns the sub-protocols to be used. See details of `protocols` here https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/WebSocket
         * Useful if there is a custom authentication scheme that needs to be used for WebSocket connections.
         * Note: The client side npm package @jupyterlab/services uses WebSockets to connect to remote Kernels.
         */
        readonly webSocketProtocols?: string[];
    }

    /**
     * Represents a Jupyter Server displayed in the list of Servers.
     */
    export interface JupyterServer {
        /**
         * Unique identifier for this server.
         */
        readonly id: string;
        /**
         * A human-readable string which is rendered prominent.
         */
        label: string;
        /**
         * Returns the connection information for this server.
         */
        resolveConnectionInformation(token: CancellationToken): Promise<JupyterServerConnectionInformation>;
        /**
         * Removes this from the list of Servers.
         */
        dispose(): void;
    }

    export interface JupyterServerProvider {
        onDidChangeServers: Event<void>;
        getJupyterServers(token: CancellationToken): Promise<JupyterServer[]>;
    }
    export interface JupyterServerCommandProvider {
        selected?: Command;
        getCommands(token: CancellationToken): Promise<Command[]>;
    }
    export interface JupyterServerCollection {
        readonly id: string;
        label: string;
        documentation?: Uri;
        serverProvider?: JupyterServerProvider;
        commandProvider?: JupyterServerCommandProvider;
        dispose(): void;
    }
    export interface JupyterAPI {
        createJupyterServerCollection(id: string, label: string): Promise<JupyterServerCollection>;
    }
}
