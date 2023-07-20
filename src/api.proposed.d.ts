// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Disposable, Event, Uri } from 'vscode';

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
    readonly token?: string;
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
    readonly label: string;
    /**
     * Returns the connection information for this server.
     */
    resolveConnectionInformation: () => Promise<JupyterServerConnectionInformation>;
}

/**
 * Creates an entry in the list of servers that the user can pick from to create/select a Jupyter Server.
 * Selecting this item results in eventually creating a Jupyter Server.
 */
export interface JupyterServerCreationItem {
    /**
     * A human-readable string which is rendered prominent. Supports rendering of {@link ThemeIcon theme icons} via
     * the `$(<name>)`-syntax.
     */
    readonly label: string;
    /**
     * A human-readable string which is rendered less prominent in a separate line. Supports rendering of
     * {@link ThemeIcon theme icons} via the `$(<name>)`-syntax.
     */
    readonly detail?: string;
    /**
     * A string that should be used when comparing this item with other items.
     * When `falsy` the label is used.
     */
    readonly sortText?: string;
    /**
     * Optional flag indicating if this item is picked by default.
     * If there are no existing servers, and this flag is true, then this item will be picked by default.
     *
     * This property is ignored when there are some Jupyter Servers.
     */
    readonly picked?: boolean;
    /**
     * Called when this item is selected by the user to create a Jupyter Server.
     */
    createJupyterServer: () => Promise<JupyterServer | undefined>;
}

export interface JupyterServerProvider {
    /**
     * A human-readable string which is rendered prominent.
     */
    readonly label: string;
    /**
     * A link to a page providing more information to the user about this item.
     */
    readonly documentation?: Uri;

    /**
     * Emitted when a new Jupyter Server is created.
     */
    readonly onDidCreateJupyterServer: Event<JupyterServer>;
    /**
     * Emitted when a new Jupyter Server is deleted...
     */
    readonly onDidDeleteJupyterServer: Event<JupyterServer>;
    /**
     * List of the Jupyter Servers.
     */
    readonly servers: JupyterServer[];

    /**
     * Emitted when a new Jupyter Server Creation Item is created.
     */
    readonly onDidCreateJupyterServerCreationItem: Event<JupyterServerCreationItem>;
    /**
     * Emitted when a new Jupyter Server Creation Item is deleted.
     */
    readonly onDidDeleteJupyterServerCreationItem: Event<JupyterServerCreationItem>;
    /**
     * List of the Jupyter Server Creation Items.
     */
    readonly serverCreationItems: JupyterServerCreationItem[];
}

/**
 * Sample usage extensions.getExtension<JupyterAPI>('ms-ai-tools.jupyter')?.exports;
 */
export interface JupyterAPI {
    /**
     * Registers a new Provider for Jupyter Servers.
     *
     * @param id
     * @param provider
     */
    registerJupyterServerProvider(id: string, provider: JupyterServerProvider): Disposable;
}
