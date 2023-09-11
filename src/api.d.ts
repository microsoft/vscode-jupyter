// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken, ProviderResult, CancellationError } from 'vscode';
import { Event, Uri } from 'vscode';

export interface JupyterAPI {
    /**
     * Creates a Jupyter Server Collection that can be displayed in the Notebook Kernel Picker.
     *
     * The ideal time to invoke this method would be when a Notebook Document has been opened.
     * Calling this during activation of the extension might not be ideal, as this would result in
     * unnecessarily activating the Jupyter extension as well.
     *
     * Extensions can use this API to provide a list of Jupyter Servers to VS Code users with custom authentication schemes.
     * E.g. one could provide a list of Jupyter Servers that require Kerberos authentication or other.
     */
    createJupyterServerCollection(id: string, label: string): JupyterServerCollection;
}

/**
 * Provides information required to connect to a Jupyter Server.
 */
export interface JupyterServerConnectionInformation {
    /**
     * Base Url of the Jupyter Server.
     * E.g. http://localhost:8888 or http://remoteServer.com/hub/user/, etc.
     */
    readonly baseUrl: Uri;
    /**
     * Jupyter Authentication Token.
     * When starting Jupyter Notebook/Lab, this can be provided using the --NotebookApp.token=<token> argument.
     * Also when starting Jupyter Notebook/Lab in CLI the token is part of the query string, see here: http://localhost:8888/lab?token=<token>
     */
    readonly token?: string;
    /**
     * HTTP header to be used when connecting to the server.
     * If a {@link token token} is not provided, then headers will be used to connect to the server.
     */
    readonly headers?: Record<string, string>;
    /**
     * The local directory that maps to the remote directory of the Jupyter Server.
     * E.g. assume you start Jupyter Notebook on a remote machine with --notebook-dir=/foo/bar,
     * and you have a file named /foo/bar/sample.ipynb, /foo/bar/sample2.ipynb and the like.
     * Next assume you have local directory named /users/xyz/remoteServer with the files with the same names, sample.ipynb and sample2.ipynb
     *
     *
     * Using this setting one can map the local directory to the remote directory.
     * With the previous example in mind, the value of this property would be Uri.file('/users/xyz/remoteServer').
     *
     * This results in Jupyter Session names being generated in a way thats is consistent with Jupyter Notebook/Lab.
     * I.e. the session names map to the relative path of the notebook file.
     * Taking the previous example into account, if one were to start a Remote Kernel for the local file `/users/xyz/remoteServer/sample2.ipynb`,
     * then the name of the remote Jupyter Session would be `sample2.ipynb`.
     *
     * This is useful in the context where the remote Jupyter Server is running on the same machine as VS Code, but the files are mapped on different directories.
     */
    readonly mappedRemote?: Uri;
    /**
     * Returns the sub-protocols to be used. See details of `protocols` here https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/WebSocket
     * Useful if there is a custom authentication scheme that needs to be used for WebSocket connections.
     * Note: The client side npm package @jupyterlab/services uses WebSockets to connect to remote Kernels.
     *
     * This is useful in the context of vscode.dev or github.dev or the like where the remote Jupyter Server is unable to read the cookies/headers sent from client as part of {@link JupyterServerConnectionInformation.headers headers}.
     */
    readonly webSocketProtocols?: string[];
}

/**
 * Represents a Jupyter Server displayed in the list of Servers.
 * Each server can have its own authentication scheme (token based, username/password or other).
 * See {@link JupyterServerProvider.resolveJupyterServer} for more information.
 */
export interface JupyterServer {
    /**
     * Unique identifier for this server.
     */
    readonly id: string;
    /**
     * A human-readable string representing the name of the Server.
     */
    readonly label: string;
    /**
     * Information required to Connect to the Jupyter Server.
     * This can be eagerly provided by the extension or lazily provided by the extension.
     * For instance of the authentication mechanism is straight forward (e.g. token based), then the extension can provide this information eagerly.
     * Else then information required to connect to the server will be retrieved via {@link JupyterServerProvider.resolveJupyterServer}.
     */
    readonly connectionInformation?: JupyterServerConnectionInformation;
}

/**
 * Represents a Jupyter Server with certain information that cannot be `undefined`.
 * For instance the {@link connectionInformation} cannot be `undefined` as this is required to connect to the server.
 */
export interface ResolvedJupyterServer {
    /**
     * Unique identifier for this server.
     */
    readonly id: string;
    /**
     * A human-readable string representing the name of the Server.
     */
    readonly label: string;
    /**
     * Information required to Connect to the Jupyter Server.
     */
    readonly connectionInformation: JupyterServerConnectionInformation;
}

/**
 * Provider of Jupyter Servers.
 */
export interface JupyterServerProvider {
    /**
     * Event fired when the list of servers change.
     * Note: The method {@link provideJupyterServers} will not be called unless changes are detected.
     */
    onDidChangeServers?: Event<void>;
    /**
     * Returns the list of {@link JupyterServer Jupyter Servers} or a thenable that resolves to such. The lack of a result can be
     * signaled by returning `undefined` or `null`.
     */
    provideJupyterServers(token: CancellationToken): ProviderResult<JupyterServer[]>;
    /**
     * Returns the connection information for the Jupyter server.
     * It is OK to return the given `server`. When no result is returned, the given `server` will be used.
     */
    resolveJupyterServer(server: JupyterServer, token: CancellationToken): ProviderResult<ResolvedJupyterServer>;
}

/**
 * Represents a reference to a Jupyter Server command.
 * Each command allows the user to perform an action, such as starting a new Jupyter Server.
 */
export interface JupyterServerCommand {
    /**
     * A human-readable string which is rendered prominent.
     */
    label: string;
    /**
     * A human-readable string which is rendered less prominent on the same line.
     */
    description?: string;
    /**
     * Human-readable detail message that is rendered less prominent.
     */
    detail?: string;
}

/**
 * Provider of {@link JupyterServerCommand Jupyter Server Commands}.
 * Each command allows the user to perform an action, such as starting a new Jupyter Server.
 */
export interface JupyterServerCommandProvider {
    /**
     * Returns a list of commands to be displayed to the user.
     * @param value The value entered by the user in the quick pick.
     */
    provideCommands(value: string | undefined, token: CancellationToken): Promise<JupyterServerCommand[]>;
    /**
     * Invoked when a {@link JupyterServerCommand command} has been selected.
     * @param command The {@link JupyterServerCommand command} selected by the user.
     * @returns The {@link JupyterServer Jupyter Server} or a thenable that resolves to such. The lack of a result can be
     * signaled by returning `undefined` or `null`.
     *
     * Returning `undefined` or `null` will result in the previous UI being displayed, this will most likely be the Notebook Kernel Picker.
     * Thus extensions can implement a back button like behavior in their UI by returning `undefined` or `null` from this method.
     * If however users exit the UI or workflow (if any provided by 3rd party extension) by selecting a close button or hitting the `ESC` key or the like,
     * extensions are then expected to throw a {@link CancellationError}, else the previous UI will be once again, which might not be desirable.
     */
    handleCommand(command: JupyterServerCommand, token: CancellationToken): ProviderResult<JupyterServer>;
}

/**
 * Represents a logical collection of {@link JupyterServer Jupyter Servers}.
 * Each collection is represented as a separate entry in the Notebook Kernel Picker.
 * Extensions can contribute multiple collections, each with one or more {@link JupyterServer Jupyter Servers}.
 */
export interface JupyterServerCollection {
    /**
     * Unique identifier of the Server Collection.
     */
    readonly id: string;
    /**
     * A human-readable string representing the collection of the Servers. This can be read and updated by the extension.
     */
    label: string;
    /**
     * A link to a resource containing more information. This can be read and updated by the extension.
     */
    documentation?: Uri;
    /**
     * Provider of {@link JupyterServer Jupyter Servers}. This can be read and updated by the extension.
     */
    serverProvider?: JupyterServerProvider;
    /**
     * Provider of {@link JupyterServerCommand Commands}. This can be read and updated by the extension.
     */
    commandProvider?: JupyterServerCommandProvider;
    /**
     * Removes this Server Collection.
     */
    dispose(): void;
}
