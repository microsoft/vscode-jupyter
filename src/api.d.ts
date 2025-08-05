// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CancellationToken, ProviderResult, CancellationError, Event, Uri } from 'vscode';

export interface Jupyter {
    /**
     * Access to the Jupyter Kernels API.
     */
    readonly kernels: Kernels;
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
    createJupyterServerCollection(
        id: string,
        label: string,
        serverProvider: JupyterServerProvider
    ): JupyterServerCollection;
}

// #region JupyterServersCollections API
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
    resolveJupyterServer(server: JupyterServer, token: CancellationToken): ProviderResult<JupyterServer>;
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
     * If no servers are returned by {@link JupyterServerProvider.provideJupyterServers} and
     * only one of the commands returned by {@link JupyterServerCommandProvider.provideCommands} is initialized with `canBeAutoSelected=true`,
     * then that command is automatically selected without displaying it to the user.
     *
     * In all other cases initializing this property is a no-op.
     */
    canBeAutoSelected?: boolean;
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
    provideCommands(value: string | undefined, token: CancellationToken): ProviderResult<JupyterServerCommand[]>;
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
     * Provider of {@link JupyterServerCommand Commands}. This can be read and updated by the extension.
     */
    commandProvider?: JupyterServerCommandProvider;
    /**
     * Removes this Server Collection.
     */
    dispose(): void;
}
// #endregion

// #region Kernels API
interface Output {
    /**
     * The output items of this output.
     */
    items: OutputItem[];
    /**
     * Arbitrary metadata for this cell output. Can be anything but must be JSON-stringifyable.
     */
    metadata?: { [key: string]: any };
}
interface OutputItem {
    /**
     * The mime type of the output.
     * Includes standard mime types (but not limited to) `text/plain`, `application/json`, `text/html`, etc.
     *
     * Special mime types are:
     * - `application/x.notebook.stream.stdout`: The output is a stream of stdout. (same as `NotebookCellOutputItem.stdout('').mime`)
     * - `application/x.notebook.stream.stderr`: The output is a stream of stderr. (same as `NotebookCellOutputItem.stderr('').mime`)
     * - `application/vnd.code.notebook.error`: The output is a stream of stderr. (same as `NotebookCellOutputItem.error(...).mime`)
     *
     */
    mime: string;
    /**
     * The data of this output item.
     */
    data: Uint8Array;
}
export type KernelStatus =
    | 'unknown'
    | 'starting'
    | 'idle'
    | 'busy'
    | 'terminating'
    | 'restarting'
    | 'autorestarting'
    | 'dead';

/**
 * Represents a Jupyter Kernel.
 */
export interface Kernel {
    /**
     * An event emitted when the kernel status changes.
     */
    onDidChangeStatus: Event<KernelStatus>;
    /**
     * The current status of the kernel.
     */
    readonly status: KernelStatus;
    /**
     * Language of the kernel.
     * E.g. python, r, julia, etc.
     */
    readonly language: string;
    /**
     * Executes code in the kernel without affecting the execution count & execution history.
     *
     * @param code Code to be executed.
     * @param token Triggers the cancellation of the execution.
     * @returns Async iterable of outputs, that completes when the execution is complete.
     */
    executeCode(code: string, token: CancellationToken): AsyncIterable<Output>;
}
export interface Kernels {
    /**
     * Gets an the kernel associated with a given resource.
     * For instance if the resource is a notebook, then get the kernel associated with the given Notebook document.
     * Only kernels which have already been started by the user and belonging to Notebooks that are currently opened will be returned.
     */
    getKernel(uri: Uri): Thenable<Kernel | undefined>;
}
// #endregion Kernels API
