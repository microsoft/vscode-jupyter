// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * @fileoverview Public API for the Jupyter extension for VS Code.
 *
 * This file defines the stable public API that third-party extensions can use to interact
 * with Jupyter functionality in VS Code. The API provides two main areas:
 *
 * 1. **Jupyter Server Collections**: Allows extensions to contribute custom Jupyter servers
 *    with specialized authentication or connection mechanisms (e.g., Kerberos, SSO, cloud providers).
 *
 * 2. **Kernels API**: Provides programmatic access to running Jupyter kernels for code execution
 *    and status monitoring.
 *
 * @remarks
 * - This API is versioned and changes should maintain backward compatibility
 * - Extensions should activate the Jupyter extension only when needed (e.g., when a notebook is opened)
 * - All async operations support cancellation via CancellationToken
 *
 * @example
 * ```typescript
 * // Get the Jupyter API from the extension
 * const jupyterExt = vscode.extensions.getExtension('ms-toolsai.jupyter');
 * const jupyterApi = jupyterExt?.exports as Jupyter;
 *
 * // Create a custom server collection
 * const collection = jupyterApi.createJupyterServerCollection(
 *     'my-servers',
 *     'My Custom Servers',
 *     myServerProvider
 * );
 * ```
 */

import type { CancellationToken, ProviderResult, CancellationError, Event, Uri } from 'vscode';

/**
 * Main entry point for the Jupyter extension API.
 * Provides access to kernels and server collection management.
 */
export interface Jupyter {
    /**
     * Access to the Jupyter Kernels API.
     *
     * Use this to interact with running kernels, execute code, and monitor kernel status.
     * Only kernels from currently open notebooks are accessible.
     */
    readonly kernels: Kernels;

    /**
     * Creates a Jupyter Server Collection that can be displayed in the Notebook Kernel Picker.
     *
     * @param id - Unique identifier for this server collection. Must be unique across all extensions.
     * @param label - Display name shown in the kernel picker UI.
     * @param serverProvider - Implementation that provides the list of servers and handles connections.
     * @returns A JupyterServerCollection object that can be used to update the collection or dispose it.
     *
     * @remarks
     * **Timing considerations:**
     * - The ideal time to invoke this method is when a Notebook Document has been opened.
     * - Calling this during extension activation is not recommended, as it would unnecessarily
     *   activate the Jupyter extension as well.
     *
     * **Use cases:**
     * Extensions can use this API to provide Jupyter Servers with custom authentication schemes:
     * - Kerberos authentication
     * - SSO/OAuth providers
     * - Custom cloud providers
     * - Corporate proxy servers
     *
     * @example
     * ```typescript
     * // Create a collection for custom authenticated servers
     * const collection = jupyterApi.createJupyterServerCollection(
     *     'my-company-servers',
     *     'Company Jupyter Servers',
     *     {
     *         provideJupyterServers: async (token) => {
     *             // Return list of available servers
     *             return await fetchCompanyServers();
     *         },
     *         resolveJupyterServer: async (server, token) => {
     *             // Add connection info with custom auth
     *             return {
     *                 ...server,
     *                 connectionInformation: {
     *                     baseUrl: server.baseUrl,
     *                     headers: { 'Authorization': await getAuthToken() }
     *                 }
     *             };
     *         }
     *     }
     * );
     * ```
     */
    createJupyterServerCollection(
        id: string,
        label: string,
        serverProvider: JupyterServerProvider
    ): JupyterServerCollection;
}

// #region JupyterServersCollections API
/**
 * ============================================================================
 * JUPYTER SERVER COLLECTIONS API
 * ============================================================================
 * This section defines types for contributing custom Jupyter server connections.
 * Use these interfaces to provide servers with custom authentication schemes.
 */

/**
 * Provides information required to connect to a Jupyter Server.
 *
 * @remarks
 * Authentication can be provided in two ways:
 * 1. Token-based: Use the `token` property for standard Jupyter token authentication
 * 2. Header-based: Use the `headers` property for custom authentication schemes (OAuth, API keys, etc.)
 *
 * If both token and headers are provided, headers take precedence for authentication.
 */
export interface JupyterServerConnectionInformation {
    /**
     * Base URL of the Jupyter Server.
     *
     * @remarks
     * Should include the protocol, host, port, and any base path:
     * - Local: `http://localhost:8888`
     * - Remote: `https://jupyter.example.com`
     * - JupyterHub: `http://hub.example.com/user/username/`
     *
     * The URL should NOT include query parameters (use `token` or `headers` for authentication).
     */
    readonly baseUrl: Uri;

    /**
     * Jupyter Authentication Token (optional).
     *
     * @remarks
     * Standard Jupyter token authentication. The token can be obtained from:
     * - Server startup arguments: `--NotebookApp.token=<token>`
     * - Server URL query string: `http://localhost:8888/lab?token=<token>`
     * - Server configuration file
     *
     * **Note:** If both `token` and `headers` are provided, `headers` takes precedence.
     *
     * @example
     * ```typescript
     * const connectionInfo = {
     *     baseUrl: vscode.Uri.parse('http://localhost:8888'),
     *     token: 'abc123def456'
     * };
     * ```
     */
    readonly token?: string;

    /**
     * HTTP headers to be used when connecting to the server (optional).
     *
     * @remarks
     * Use this for custom authentication schemes that are not token-based:
     * - OAuth bearer tokens
     * - API keys
     * - Custom authentication headers
     * - Session cookies
     *
     * If a {@link token token} is not provided, then headers will be used to connect to the server.
     * If both are provided, headers take precedence.
     *
     * @example
     * ```typescript
     * // OAuth bearer token authentication
     * const connectionInfo = {
     *     baseUrl: vscode.Uri.parse('https://jupyter.example.com'),
     *     headers: {
     *         'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
     *     }
     * };
     *
     * // API key authentication
     * const connectionInfo = {
     *     baseUrl: vscode.Uri.parse('https://jupyter.example.com'),
     *     headers: {
     *         'X-API-Key': 'your-api-key-here'
     *     }
     * };
     * ```
     */
    readonly headers?: Record<string, string>;
}

/**
 * Represents a Jupyter Server displayed in the list of Servers.
 * Each server can have its own authentication scheme (token based, username/password or other).
 *
 * @remarks
 * Servers appear in the VS Code kernel picker UI and can be selected by users.
 * See {@link JupyterServerProvider.resolveJupyterServer} for more information on lazy connection resolution.
 */
export interface JupyterServer {
    /**
     * Unique identifier for this server.
     *
     * @remarks
     * Must be unique within the collection. Used to track server selection and cache connections.
     * Consider using a stable identifier like a server UUID or hash of connection details.
     */
    readonly id: string;

    /**
     * A human-readable string representing the name of the Server.
     *
     * @remarks
     * This is displayed to the user in the kernel picker. Should be descriptive enough
     * to distinguish between multiple servers (e.g., "Production Cluster", "Dev Server").
     */
    readonly label: string;

    /**
     * Information required to connect to the Jupyter Server (optional).
     *
     * @remarks
     * **Connection information can be provided in two ways:**
     *
     * 1. **Eager (Immediate):** Provide `connectionInformation` here when the authentication
     *    is straightforward (e.g., token-based or no authentication required).
     *
     * 2. **Lazy (On-demand):** Omit `connectionInformation` here and provide it later via
     *    {@link JupyterServerProvider.resolveJupyterServer}. Use this when:
     *    - Authentication requires user interaction (login prompt, OAuth flow)
     *    - Connection details need to be fetched from an external service
     *    - Authentication tokens need to be refreshed
     *
     * @example
     * ```typescript
     * // Eager connection info (simple token auth)
     * const server: JupyterServer = {
     *     id: 'server-1',
     *     label: 'Local Jupyter Server',
     *     connectionInformation: {
     *         baseUrl: vscode.Uri.parse('http://localhost:8888'),
     *         token: 'abc123'
     *     }
     * };
     *
     * // Lazy connection info (resolved later)
     * const server: JupyterServer = {
     *     id: 'server-2',
     *     label: 'Remote Server (Login Required)'
     *     // connectionInformation omitted, will be provided in resolveJupyterServer
     * };
     * ```
     */
    readonly connectionInformation?: JupyterServerConnectionInformation;
}

/**
 * Provider of Jupyter Servers.
 *
 * @remarks
 * Implement this interface to contribute a list of Jupyter servers to VS Code.
 * The provider follows a two-phase pattern:
 * 1. {@link provideJupyterServers} - Returns the list of available servers (can be cached)
 * 2. {@link resolveJupyterServer} - Resolves connection details for a specific server (called when needed)
 */
export interface JupyterServerProvider {
    /**
     * Event fired when the list of servers changes (optional).
     *
     * @remarks
     * Fire this event to notify VS Code that the server list should be refreshed.
     * The {@link provideJupyterServers} method will only be called after this event is fired.
     *
     * **Common scenarios for firing this event:**
     * - New servers are discovered
     * - Servers are removed or become unavailable
     * - Server configuration changes
     *
     * @example
     * ```typescript
     * private _onDidChangeServers = new vscode.EventEmitter<void>();
     * readonly onDidChangeServers = this._onDidChangeServers.event;
     *
     * // Later, when servers change:
     * this._onDidChangeServers.fire();
     * ```
     */
    onDidChangeServers?: Event<void>;

    /**
     * Returns the list of {@link JupyterServer Jupyter Servers} or a thenable that resolves to such.
     *
     * @param token - Cancellation token to abort the operation.
     * @returns Array of servers, or `undefined`/`null` if no servers are available.
     *
     * @remarks
     * **Timing:**
     * - Called when the kernel picker is opened or when {@link onDidChangeServers} is fired
     * - Not called on every kernel picker open if the list hasn't changed
     * - Results may be cached by VS Code
     *
     * **Performance:**
     * - Should return quickly (< 1 second if possible)
     * - Can return servers without connection information (provide later in {@link resolveJupyterServer})
     * - Heavy operations (authentication, network requests) should be deferred to {@link resolveJupyterServer}
     *
     * @example
     * ```typescript
     * async provideJupyterServers(token: CancellationToken): Promise<JupyterServer[]> {
     *     // Quick check for available servers
     *     const servers = await discoverServers();
     *     return servers.map(s => ({
     *         id: s.id,
     *         label: s.name
     *         // Connection info provided later in resolveJupyterServer
     *     }));
     * }
     * ```
     */
    provideJupyterServers(token: CancellationToken): ProviderResult<JupyterServer[]>;

    /**
     * Returns the connection information for the Jupyter server.
     *
     * @param server - The server to resolve, as previously returned by {@link provideJupyterServers}.
     * @param token - Cancellation token to abort the operation.
     * @returns A JupyterServer with connection information, or `undefined`/`null` to use the given server as-is.
     *
     * @remarks
     * **Purpose:**
     * - Called when a user selects a server from the kernel picker
     * - Provides opportunity to add connection information that was omitted in {@link provideJupyterServers}
     * - Can prompt for user credentials or perform authentication flows
     *
     * **Return value options:**
     * 1. Return a new server object with `connectionInformation` populated
     * 2. Return the given `server` object if it already has connection information
     * 3. Return `undefined`/`null` to use the server's existing connection information
     *
     * **Error handling:**
     * - If authentication fails, throw an error to display to the user
     * - If user cancels authentication, throw a {@link CancellationError}
     *
     * @example
     * ```typescript
     * async resolveJupyterServer(
     *     server: JupyterServer,
     *     token: CancellationToken
     * ): Promise<JupyterServer> {
     *     // Server already has connection info
     *     if (server.connectionInformation) {
     *         return server;
     *     }
     *
     *     // Perform authentication flow
     *     const authToken = await authenticateUser(server.id);
     *     if (token.isCancellationRequested) {
     *         throw new vscode.CancellationError();
     *     }
     *
     *     return {
     *         ...server,
     *         connectionInformation: {
     *             baseUrl: vscode.Uri.parse(server.url),
     *             headers: { 'Authorization': `Bearer ${authToken}` }
     *         }
     *     };
     * }
     * ```
     */
    resolveJupyterServer(server: JupyterServer, token: CancellationToken): ProviderResult<JupyterServer>;
}

/**
 * Represents a reference to a Jupyter Server command.
 * Each command allows the user to perform an action, such as starting a new Jupyter Server.
 *
 * @remarks
 * Commands appear as clickable items in the kernel picker UI.
 * Common use cases:
 * - "Start New Server" - Launch a new Jupyter server instance
 * - "Connect to Existing Server" - Show a dialog to enter server URL
 * - "Login to Cloud Provider" - Initiate authentication flow
 */
export interface JupyterServerCommand {
    /**
     * A human-readable string which is rendered prominently.
     *
     * @remarks
     * This is the main text displayed to the user. Should be concise and action-oriented.
     *
     * @example
     * - "Start New Jupyter Server"
     * - "Connect to Remote Server..."
     * - "Login to Azure ML"
     */
    label: string;

    /**
     * A human-readable string which is rendered less prominently on the same line (optional).
     *
     * @remarks
     * Provides additional context or details about the command.
     * Rendered in a lighter color or smaller font next to the label.
     *
     * @example
     * - label: "Start New Server", description: "Starts a local Jupyter server"
     * - label: "Connect to Hub", description: "hub.company.com"
     */
    description?: string;

    /**
     * If `true`, this command can be automatically selected when no servers are available (optional).
     *
     * @remarks
     * **Auto-selection behavior:**
     * - If {@link JupyterServerProvider.provideJupyterServers} returns no servers (empty array or null)
     * - AND only ONE command has `canBeAutoSelected: true`
     * - THEN that command is automatically executed without showing the picker UI
     *
     * **Use case:** Default "Start New Server" command for first-time users
     *
     * **Important:** In all other cases (multiple servers available, multiple auto-selectable commands,
     * or no auto-selectable commands), this property has no effect and the picker is shown normally.
     *
     * @default false
     *
     * @example
     * ```typescript
     * // Command that auto-starts a local server for first-time users
     * const startCommand: JupyterServerCommand = {
     *     label: 'Start New Jupyter Server',
     *     description: 'Starts a local server on port 8888',
     *     canBeAutoSelected: true
     * };
     * ```
     */
    canBeAutoSelected?: boolean;
}

/**
 * Provider of {@link JupyterServerCommand Jupyter Server Commands}.
 * Each command allows the user to perform an action, such as starting a new Jupyter Server.
 *
 * @remarks
 * Commands provide interactive actions in the kernel picker UI beyond just selecting
 * from a static list of servers. Common patterns:
 * - Starting new servers
 * - Showing dialogs for manual connection
 * - Initiating authentication flows
 * - Filtering or searching large server lists
 */
export interface JupyterServerCommandProvider {
    /**
     * Returns a list of commands to be displayed to the user.
     *
     * @param value - The value entered by the user in the quick pick (optional).
     *                For simple pickers, this is undefined. For searchable pickers,
     *                this contains the current search text.
     * @param token - Cancellation token to abort the operation.
     * @returns Array of commands, or `undefined`/`null` if no commands are available.
     *
     * @remarks
     * **Dynamic commands:**
     * - Can return different commands based on the `value` parameter
     * - Useful for implementing search or filtering behavior
     * - Called when the picker is opened and when the search text changes
     *
     * **Common patterns:**
     * 1. Static commands: Return the same commands regardless of `value`
     * 2. Search-based: Return filtered commands based on `value`
     * 3. Context-aware: Return different commands based on extension state
     *
     * @example
     * ```typescript
     * async provideCommands(
     *     value: string | undefined,
     *     token: CancellationToken
     * ): Promise<JupyterServerCommand[]> {
     *     const commands: JupyterServerCommand[] = [
     *         {
     *             label: 'Start New Server',
     *             canBeAutoSelected: true
     *         }
     *     ];
     *
     *     // Add search-specific command if user entered text
     *     if (value && value.startsWith('http')) {
     *         commands.push({
     *             label: `Connect to ${value}`,
     *             description: 'Custom URL'
     *         });
     *     }
     *
     *     return commands;
     * }
     * ```
     */
    provideCommands(value: string | undefined, token: CancellationToken): ProviderResult<JupyterServerCommand[]>;

    /**
     * Invoked when a {@link JupyterServerCommand command} has been selected by the user.
     *
     * @param command - The {@link JupyterServerCommand command} selected by the user.
     * @param token - Cancellation token to abort the operation.
     * @returns The {@link JupyterServer Jupyter Server} or a thenable that resolves to such,
     *          or `undefined`/`null` to return to the previous UI.
     *
     * @remarks
     * **Return value behavior:**
     *
     * 1. **Return a JupyterServer:** The server is used to connect to Jupyter.
     *    This is the normal case where the command successfully creates or finds a server.
     *
     * 2. **Return `undefined` or `null`:** The previous UI is re-displayed (typically the kernel picker).
     *    Use this to implement "back button" behavior when the user wants to go back.
     *
     * 3. **Throw {@link CancellationError}:** The entire flow is cancelled and no UI is shown.
     *    Use this when the user explicitly cancels (e.g., closes a dialog, presses ESC).
     *
     * **Important distinction between undefined and CancellationError:**
     * - `undefined` = "Go back to the previous screen" (user wants to try something else)
     * - `CancellationError` = "Cancel everything" (user wants to stop the entire flow)
     *
     * **Error handling:**
     * - For expected errors (auth failure, invalid URL), show error message and return `undefined`
     * - For unexpected errors, throw to display error to user
     * - For user cancellation, throw {@link CancellationError}
     *
     * @example
     * ```typescript
     * async handleCommand(
     *     command: JupyterServerCommand,
     *     token: CancellationToken
     * ): Promise<JupyterServer | undefined> {
     *     if (command.label === 'Start New Server') {
     *         // Start server and return it
     *         const server = await startLocalServer();
     *         return {
     *             id: server.id,
     *             label: 'Local Jupyter Server',
     *             connectionInformation: server.connectionInfo
     *         };
     *     }
     *
     *     if (command.label === 'Connect to Custom URL') {
     *         // Show input dialog
     *         const url = await vscode.window.showInputBox({
     *             prompt: 'Enter Jupyter server URL',
     *             validateInput: validateUrl
     *         });
     *
     *         // User closed dialog - cancel everything
     *         if (url === undefined) {
     *             throw new vscode.CancellationError();
     *         }
     *
     *         // User entered invalid URL - go back to picker
     *         if (!isValid(url)) {
     *             vscode.window.showErrorMessage('Invalid URL');
     *             return undefined; // Back to picker
     *         }
     *
     *         return {
     *             id: url,
     *             label: url,
     *             connectionInformation: { baseUrl: vscode.Uri.parse(url) }
     *         };
     *     }
     *
     *     return undefined;
     * }
     * ```
     */
    handleCommand(command: JupyterServerCommand, token: CancellationToken): ProviderResult<JupyterServer>;
}

/**
 * Represents a logical collection of {@link JupyterServer Jupyter Servers}.
 * Each collection is represented as a separate entry in the Notebook Kernel Picker.
 *
 * @remarks
 * **Purpose:**
 * - Group related servers together (e.g., "Azure Servers", "Company Servers")
 * - Each collection appears as a separate section in the kernel picker UI
 * - Extensions can contribute multiple collections with different server sources
 *
 * **Lifecycle:**
 * - Created via {@link Jupyter.createJupyterServerCollection}
 * - Remains active until {@link dispose} is called
 * - Properties (label, documentation, commandProvider) can be updated at runtime
 *
 * @example
 * ```typescript
 * // Create and configure a collection
 * const collection = jupyterApi.createJupyterServerCollection(
 *     'my-collection',
 *     'My Servers',
 *     myProvider
 * );
 *
 * // Update label dynamically
 * collection.label = 'My Servers (3 available)';
 *
 * // Add documentation link
 * collection.documentation = vscode.Uri.parse('https://docs.example.com/jupyter');
 *
 * // Add command provider for interactive actions
 * collection.commandProvider = myCommandProvider;
 *
 * // Clean up when no longer needed
 * collection.dispose();
 * ```
 */
export interface JupyterServerCollection {
    /**
     * Unique identifier of the Server Collection.
     *
     * @remarks
     * This is the same ID provided to {@link Jupyter.createJupyterServerCollection}.
     * Cannot be changed after creation.
     */
    readonly id: string;

    /**
     * A human-readable string representing the collection of servers.
     *
     * @remarks
     * **Can be read and updated by the extension.**
     *
     * This appears as a section header in the kernel picker UI.
     * Update this dynamically to reflect the current state:
     * - "Company Servers (3 available)"
     * - "Azure ML Compute (loading...)"
     * - "Remote Servers (authentication required)"
     */
    label: string;

    /**
     * A link to a resource containing more information about this collection (optional).
     *
     * @remarks
     * **Can be read and updated by the extension.**
     *
     * Displayed as a clickable link in the UI. Use this to:
     * - Provide setup instructions
     * - Link to authentication documentation
     * - Point to server management dashboards
     *
     * @example
     * ```typescript
     * collection.documentation = vscode.Uri.parse('https://docs.example.com/setup');
     * ```
     */
    documentation?: Uri;

    /**
     * Provider of {@link JupyterServerCommand Commands} for this collection (optional).
     *
     * @remarks
     * **Can be read and updated by the extension.**
     *
     * Provides interactive commands shown in the kernel picker for this collection.
     * Commands allow users to perform actions like starting servers or authenticating.
     *
     * Can be set or updated at any time to change available commands dynamically.
     * Set to `undefined` to remove all commands from the collection.
     *
     * @example
     * ```typescript
     * // Add commands after authentication is complete
     * collection.commandProvider = {
     *     provideCommands: async () => [{
     *         label: 'Start New Server',
     *         canBeAutoSelected: true
     *     }],
     *     handleCommand: async (cmd) => await startServer()
     * };
     *
     * // Remove commands when feature is disabled
     * collection.commandProvider = undefined;
     * ```
     */
    commandProvider?: JupyterServerCommandProvider;

    /**
     * Removes this Server Collection from the kernel picker.
     *
     * @remarks
     * **Cleanup:**
     * - Removes the collection from the kernel picker UI
     * - Should be called when the extension is deactivated or the collection is no longer needed
     * - After calling dispose, this collection object should not be used
     *
     * **Best practices:**
     * - Call dispose in extension's `deactivate()` function
     * - Store collection in a disposable array: `context.subscriptions.push(collection)`
     * - Do not attempt to use the collection after disposal
     *
     * @example
     * ```typescript
     * // Proper lifecycle management
     * export function activate(context: vscode.ExtensionContext) {
     *     const collection = jupyterApi.createJupyterServerCollection(...);
     *     context.subscriptions.push(collection); // Auto-dispose on deactivation
     * }
     *
     * // Or manual disposal
     * if (shouldRemoveCollection) {
     *     collection.dispose();
     * }
     * ```
     */
    dispose(): void;
}
// #endregion

// #region Kernels API
/**
 * ============================================================================
 * JUPYTER KERNELS API
 * ============================================================================
 * This section defines types for interacting with running Jupyter kernels.
 * Use these interfaces to execute code and monitor kernel status programmatically.
 */

/**
 * Represents the output from a kernel execution.
 *
 * @remarks
 * Outputs can contain multiple items with different mime types (text, images, HTML, etc.).
 * This structure matches VS Code's notebook cell output format.
 */
interface Output {
    /**
     * The output items of this output.
     *
     * @remarks
     * An output can contain multiple items with different mime types.
     * For example, a single output might include both text/plain and text/html representations
     * of the same data, allowing the UI to choose the best format to display.
     */
    items: OutputItem[];

    /**
     * Arbitrary metadata for this cell output (optional).
     *
     * @remarks
     * Can contain any JSON-serializable data. Common uses:
     * - Execution timing information
     * - Widget state or configuration
     * - Custom rendering hints
     *
     * Must be JSON-stringifiable (no functions, circular references, etc.).
     */
    metadata?: { [key: string]: any };
}

/**
 * Represents a single output item with a specific mime type.
 *
 * @remarks
 * Output items are the fundamental units of kernel output. Each item has:
 * - A mime type that identifies the format of the data
 * - Binary data that can represent any content type
 */
interface OutputItem {
    /**
     * The mime type of the output.
     *
     * @remarks
     * **Standard mime types include (but are not limited to):**
     * - `text/plain` - Plain text output
     * - `text/html` - HTML content
     * - `application/json` - JSON data
     * - `image/png` - PNG images
     * - `image/jpeg` - JPEG images
     * - `image/svg+xml` - SVG graphics
     * - `application/javascript` - JavaScript code
     *
     * **Special VS Code notebook mime types:**
     * - `application/x.notebook.stream.stdout` - Standard output stream
     *   (same as `NotebookCellOutputItem.stdout('').mime`)
     * - `application/x.notebook.stream.stderr` - Standard error stream
     *   (same as `NotebookCellOutputItem.stderr('').mime`)
     * - `application/vnd.code.notebook.error` - Error/traceback output
     *   (same as `NotebookCellOutputItem.error(...).mime`)
     *
     * **Mime type precedence:**
     * When multiple items exist, VS Code selects the "richest" format it can render.
     * Typically: HTML > Image > JSON > Plain text
     */
    mime: string;

    /**
     * The binary data of this output item.
     *
     * @remarks
     * Data is stored as a Uint8Array (byte array) to support any content type:
     * - Text data: UTF-8 encoded bytes
     * - Images: Raw image file bytes
     * - JSON: UTF-8 encoded JSON string bytes
     *
     * Use TextDecoder to convert text data: `new TextDecoder().decode(data)`
     */
    data: Uint8Array;
}
/**
 * The possible states of a Jupyter kernel.
 *
 * @remarks
 * **Status lifecycle:**
 * 1. `starting` - Kernel is launching (process starting, connecting)
 * 2. `idle` - Kernel is ready and waiting for execution
 * 3. `busy` - Kernel is currently executing code
 * 4. `idle` - Returns to idle after execution completes
 *
 * **Error states:**
 * - `dead` - Kernel has crashed or been killed
 * - `terminating` - Kernel is shutting down
 *
 * **Restart states:**
 * - `restarting` - User-initiated restart in progress
 * - `autorestarting` - Automatic restart after crash
 *
 * **Unknown state:**
 * - `unknown` - Status cannot be determined (rare, usually during initialization)
 */
export type KernelStatus =
    | 'unknown' // Status cannot be determined
    | 'starting' // Kernel is launching
    | 'idle' // Ready for execution
    | 'busy' // Currently executing code
    | 'terminating' // Shutting down
    | 'restarting' // User-initiated restart
    | 'autorestarting' // Automatic restart after crash
    | 'dead'; // Kernel has crashed or been killed

/**
 * Represents a Jupyter Kernel.
 *
 * @remarks
 * A kernel is a computational engine that executes code in a specific language.
 * This interface provides access to:
 * - Kernel status monitoring
 * - Code execution capabilities
 * - Language identification
 *
 * **Important notes:**
 * - Only kernels from currently open notebooks are accessible
 * - Kernels must be started by the user before they appear in {@link Kernels.getKernel}
 * - Code executed via {@link executeCode} does not affect execution count or history
 */
export interface Kernel {
    /**
     * An event emitted when the kernel status changes.
     *
     * @remarks
     * Subscribe to this event to monitor kernel state transitions:
     * - Detect when kernel becomes idle (ready for execution)
     * - Handle kernel crashes or restarts
     * - Update UI based on execution state
     *
     * @example
     * ```typescript
     * const kernel = await jupyterApi.kernels.getKernel(notebookUri);
     * if (kernel) {
     *     kernel.onDidChangeStatus((status) => {
     *         console.log(`Kernel status changed to: ${status}`);
     *         if (status === 'dead') {
     *             vscode.window.showErrorMessage('Kernel has died');
     *         }
     *     });
     * }
     * ```
     */
    onDidChangeStatus: Event<KernelStatus>;

    /**
     * The current status of the kernel.
     *
     * @remarks
     * Check this property to determine if the kernel is ready for execution.
     * Common checks:
     * - `kernel.status === 'idle'` - Safe to execute code
     * - `kernel.status === 'busy'` - Execution in progress
     * - `kernel.status === 'dead'` - Kernel needs restart
     */
    readonly status: KernelStatus;

    /**
     * Language of the kernel.
     *
     * @remarks
     * The programming language supported by this kernel.
     * Common values:
     * - `python` - Python kernels (ipykernel)
     * - `r` - R kernels (IRkernel)
     * - `julia` - Julia kernels (IJulia)
     * - `scala` - Scala kernels (Apache Toree)
     * - `javascript` - JavaScript kernels (ijavascript)
     *
     * This value comes from the kernel specification's language field.
     */
    readonly language: string;

    /**
     * Executes code in the kernel without affecting the execution count & execution history.
     *
     * @param code - The code to be executed in the kernel.
     * @param token - Cancellation token to abort the execution.
     * @returns An async iterable of outputs that yields results as they are produced.
     *          The iterable completes when the execution is complete.
     *
     * @remarks
     * **Important characteristics:**
     * - Does NOT increment the kernel's execution counter (e.g., In[1], In[2])
     * - Does NOT add to kernel's execution history
     * - Does NOT show in the notebook UI
     * - Runs in the same kernel session as notebook cells
     * - Can access and modify variables from notebook cells
     *
     * **Use cases:**
     * - Querying variable values programmatically
     * - Running diagnostic or introspection code
     * - Executing setup code without user visibility
     * - Background tasks that shouldn't appear in history
     *
     * **Cancellation:**
     * - Pass a cancellation token to abort long-running executions
     * - When cancelled, the kernel interrupt signal is sent
     * - Partial outputs may be yielded before cancellation
     *
     * **Output streaming:**
     * - Outputs are yielded as they are produced (real-time)
     * - Each output may contain multiple items with different mime types
     * - Use `for await...of` to consume outputs as they arrive
     *
     * @example
     * ```typescript
     * const kernel = await jupyterApi.kernels.getKernel(notebookUri);
     * if (kernel && kernel.status === 'idle') {
     *     const cancellation = new vscode.CancellationTokenSource();
     *
     *     try {
     *         // Execute code and process outputs
     *         for await (const output of kernel.executeCode('print("Hello, World!")', cancellation.token)) {
     *             for (const item of output.items) {
     *                 if (item.mime === 'text/plain') {
     *                     const text = new TextDecoder().decode(item.data);
     *                     console.log('Output:', text);
     *                 }
     *             }
     *         }
     *     } catch (error) {
     *         if (error instanceof vscode.CancellationError) {
     *             console.log('Execution cancelled');
     *         } else {
     *             console.error('Execution error:', error);
     *         }
     *     }
     * }
     *
     * // Query variable value
     * async function getVariableValue(kernel: Kernel, varName: string): Promise<any> {
     *     const code = `import json; print(json.dumps(${varName}))`;
     *     const token = new vscode.CancellationTokenSource().token;
     *
     *     for await (const output of kernel.executeCode(code, token)) {
     *         for (const item of output.items) {
     *             if (item.mime === 'text/plain') {
     *                 const text = new TextDecoder().decode(item.data);
     *                 return JSON.parse(text);
     *             }
     *         }
     *     }
     * }
     * ```
     */
    executeCode(code: string, token: CancellationToken): AsyncIterable<Output>;
}
/**
 * Provides access to running Jupyter kernels.
 *
 * @remarks
 * This interface is the entry point for interacting with kernels programmatically.
 * Access it via the main {@link Jupyter.kernels} property.
 */
export interface Kernels {
    /**
     * Gets the kernel associated with a given resource.
     *
     * @param uri - The URI of the resource (typically a notebook document).
     * @returns A promise that resolves to the kernel, or `undefined` if no kernel is associated.
     *
     * @remarks
     * **Behavior:**
     * - For notebook documents: Returns the kernel associated with that notebook
     * - For other resources: Returns `undefined`
     *
     * **Important limitations:**
     * - Only returns kernels that have been **started by the user**
     * - Only returns kernels for notebooks that are **currently open**
     * - Returns `undefined` if the notebook hasn't selected a kernel yet
     * - Returns `undefined` if the kernel hasn't been started yet
     *
     * **Use cases:**
     * - Execute code in a notebook's kernel from an extension
     * - Monitor kernel status for UI updates
     * - Implement custom kernel interactions
     *
     * @example
     * ```typescript
     * // Get kernel for the active notebook
     * const activeNotebook = vscode.window.activeNotebookEditor?.notebook;
     * if (activeNotebook) {
     *     const kernel = await jupyterApi.kernels.getKernel(activeNotebook.uri);
     *     if (kernel) {
     *         console.log(`Kernel language: ${kernel.language}`);
     *         console.log(`Kernel status: ${kernel.status}`);
     *
     *         // Execute code if kernel is ready
     *         if (kernel.status === 'idle') {
     *             const token = new vscode.CancellationTokenSource().token;
     *             for await (const output of kernel.executeCode('2 + 2', token)) {
     *                 // Process output
     *             }
     *         }
     *     } else {
     *         console.log('No kernel started for this notebook');
     *     }
     * }
     *
     * // Listen for notebook openings to track kernels
     * vscode.workspace.onDidOpenNotebookDocument(async (notebook) => {
     *     const kernel = await jupyterApi.kernels.getKernel(notebook.uri);
     *     if (kernel) {
     *         kernel.onDidChangeStatus((status) => {
     *             console.log(`Kernel for ${notebook.uri} is now ${status}`);
     *         });
     *     }
     * });
     * ```
     */
    getKernel(uri: Uri): Thenable<Kernel | undefined>;
}
// #endregion Kernels API
