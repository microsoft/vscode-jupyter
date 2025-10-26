// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CancellationToken, ProviderResult, CancellationError, Event, Uri } from 'vscode';

/**
 * The main API entry point for the Jupyter extension.
 *
 * This interface provides access to Jupyter-related functionality, including:
 * - Managing and executing code in Jupyter kernels
 * - Creating custom Jupyter server collections with custom authentication
 * - Integrating third-party Jupyter server providers
 *
 * @example
 * ```typescript
 * // Get the Jupyter API from the Jupyter extension
 * const jupyterExt = vscode.extensions.getExtension('ms-toolsai.jupyter');
 * const jupyterApi = await jupyterExt?.activate();
 *
 * // Access kernels API
 * const kernel = await jupyterApi.kernels.getKernel(notebookUri);
 * ```
 */
export interface Jupyter {
    /**
     * Access to the Jupyter Kernels API.
     *
     * Use this property to interact with active Jupyter kernels, such as:
     * - Getting the kernel associated with a notebook
     * - Executing code in a kernel
     * - Monitoring kernel status changes
     */
    readonly kernels: Kernels;
    /**
     * Creates a Jupyter Server Collection that can be displayed in the Notebook Kernel Picker.
     *
     * This method allows extensions to contribute custom Jupyter server providers with specialized
     * authentication mechanisms (e.g., Kerberos, OAuth, custom tokens) or server discovery logic.
     *
     * **Best Practices:**
     * - Call this method when a Notebook Document has been opened, not during extension activation.
     *   This prevents unnecessarily activating the Jupyter extension before it's needed.
     * - Provide meaningful `id` and `label` values to help users identify the server collection.
     * - Implement proper error handling in your `serverProvider` to handle network issues and authentication failures.
     *
     * **Lifecycle:**
     * - The collection persists until explicitly disposed or the extension is deactivated.
     * - Call `dispose()` on the returned collection to remove it from the UI.
     *
     * @param id A unique identifier for the server collection. This should be namespaced to your extension
     *           (e.g., "myextension.remote-servers"). Must be stable across sessions.
     * @param label A human-readable name for the server collection displayed in the UI (e.g., "My Company Jupyter Servers").
     * @param serverProvider The provider implementation that supplies Jupyter servers and handles authentication.
     *
     * @returns A JupyterServerCollection object that can be used to update the collection's properties or dispose it.
     *
     * @example
     * ```typescript
     * const collection = jupyterApi.createJupyterServerCollection(
     *     'myext.servers',
     *     'My Jupyter Servers',
     *     {
     *         async provideJupyterServers(token) {
     *             return [
     *                 {
     *                     id: 'server1',
     *                     label: 'Production Server',
     *                     connectionInformation: {
     *                         baseUrl: vscode.Uri.parse('https://jupyter.example.com'),
     *                         token: await getAuthToken()
     *                     }
     *                 }
     *             ];
     *         },
     *         async resolveJupyterServer(server, token) {
     *             // Optionally resolve additional connection details
     *             return server;
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
 * Provides information required to connect to a Jupyter Server.
 *
 * This interface encapsulates the authentication and connection details needed to establish
 * a connection to a Jupyter server. Extensions can use this to connect to Jupyter servers
 * with various authentication schemes.
 *
 * **Authentication Methods:**
 * - **Token-based:** Provide a token for simple token authentication (most common).
 * - **Header-based:** Provide custom headers for advanced authentication (OAuth, custom schemes).
 * - **No authentication:** Omit both token and headers for open servers (not recommended for production).
 *
 * **Security Considerations:**
 * - Always use HTTPS (https://) for remote servers to protect tokens and data in transit.
 * - Store tokens securely using VS Code's SecretStorage API, not in plain text settings.
 * - Validate server certificates to prevent man-in-the-middle attacks.
 *
 * @example
 * ```typescript
 * // Token-based authentication
 * const tokenAuth: JupyterServerConnectionInformation = {
 *     baseUrl: vscode.Uri.parse('https://jupyter.example.com'),
 *     token: 'abc123...'
 * };
 *
 * // Header-based authentication (e.g., Bearer token)
 * const headerAuth: JupyterServerConnectionInformation = {
 *     baseUrl: vscode.Uri.parse('https://jupyter.example.com'),
 *     headers: {
 *         'Authorization': 'Bearer eyJhbGci...'
 *     }
 * };
 * ```
 */
export interface JupyterServerConnectionInformation {
    /**
     * Base URL of the Jupyter Server.
     *
     * This should be the root URL of the Jupyter server, including protocol and port if non-standard.
     * The URL should NOT include trailing slashes or specific API endpoints.
     *
     * **Supported Formats:**
     * - Local: `http://localhost:8888`
     * - Remote: `https://jupyter.example.com`
     * - JupyterHub: `https://hub.example.com/user/username` (includes user path)
     *
     * **Requirements:**
     * - Must be a valid HTTP or HTTPS URL
     * - Must be accessible from the VS Code environment
     * - Should not include query parameters or fragments
     */
    readonly baseUrl: Uri;
    /**
     * Jupyter Authentication Token for token-based authentication.
     *
     * The token is used to authenticate requests to the Jupyter server. This is the most common
     * authentication method for Jupyter Notebook and JupyterLab servers.
     *
     * **How to obtain:**
     * - When starting Jupyter: `jupyter lab --NotebookApp.token=<token>`
     * - From the URL: `http://localhost:8888/lab?token=<token>`
     * - From server logs: The token is printed when Jupyter starts
     *
     * **Precedence:**
     * - If both `token` and `headers` are provided, the token takes precedence.
     * - If neither is provided, the server must allow unauthenticated access.
     *
     * @example "abc123def456..." (hex string)
     */
    readonly token?: string;
    /**
     * Custom HTTP headers to be included when connecting to the server.
     *
     * Use this for advanced authentication schemes that are not token-based, such as:
     * - OAuth Bearer tokens: `{ 'Authorization': 'Bearer <token>' }`
     * - API keys: `{ 'X-API-Key': '<key>' }`
     * - Custom authentication: `{ 'X-Custom-Auth': '<value>' }`
     *
     * **Behavior:**
     * - These headers are added to every HTTP request made to the Jupyter server.
     * - If a {@link token} is provided, the token authentication method is used instead.
     * - Standard headers (Content-Type, Accept, etc.) are handled automatically and should not be included.
     *
     * **Security:**
     * - Never log or expose these headers, as they may contain sensitive credentials.
     * - Store header values securely using VS Code's SecretStorage API.
     *
     * @example
     * ```typescript
     * {
     *     'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
     *     'X-Custom-Header': 'custom-value'
     * }
     * ```
     */
    readonly headers?: Record<string, string>;
}

/**
 * Represents a Jupyter Server displayed in the list of available servers.
 *
 * Each server instance represents a unique Jupyter server that can be connected to.
 * Servers can have different authentication schemes (token-based, username/password, OAuth, etc.)
 * and may be resolved lazily to defer authentication until needed.
 *
 * **Lifecycle:**
 * 1. Server is created by {@link JupyterServerProvider.provideJupyterServers}
 * 2. Server appears in the VS Code kernel picker UI
 * 3. User selects the server
 * 4. Connection details are resolved via {@link JupyterServerProvider.resolveJupyterServer} if not provided eagerly
 * 5. Jupyter extension connects to the server and lists available kernels
 *
 * **Eager vs Lazy Connection Information:**
 * - **Eager:** Provide `connectionInformation` immediately if authentication is simple (e.g., stored token)
 * - **Lazy:** Omit `connectionInformation` if authentication requires user interaction (e.g., OAuth flow)
 *
 * @see {@link JupyterServerProvider.resolveJupyterServer} for lazy resolution details
 *
 * @example
 * ```typescript
 * // Eager connection (token already available)
 * const eagerServer: JupyterServer = {
 *     id: 'prod-server-1',
 *     label: 'Production Server (ready)',
 *     connectionInformation: {
 *         baseUrl: vscode.Uri.parse('https://jupyter.prod.example.com'),
 *         token: await secretStorage.get('jupyter-token')
 *     }
 * };
 *
 * // Lazy connection (requires authentication flow)
 * const lazyServer: JupyterServer = {
 *     id: 'oauth-server-1',
 *     label: 'OAuth Server (click to authenticate)',
 *     // connectionInformation omitted - will be resolved later
 * };
 * ```
 */
export interface JupyterServer {
    /**
     * Unique identifier for this server.
     *
     * This ID must be:
     * - **Unique** across all servers provided by this provider
     * - **Stable** across sessions (same server should have same ID)
     * - **Namespaced** to avoid conflicts (e.g., "myext.server1")
     *
     * The ID is used to:
     * - Track which server a user has selected
     * - Cache server information across VS Code sessions
     * - Match servers when the list is refreshed
     *
     * @example "myext.prod-server-1" or "company.jupyter.server-abc123"
     */
    readonly id: string;
    /**
     * A human-readable string representing the name of the server.
     *
     * This label is displayed in the VS Code UI (kernel picker, status bar, etc.).
     *
     * **Best Practices:**
     * - Use descriptive names that help users identify the server (e.g., "Production", "Staging", "Lab Server")
     * - Include status information if relevant (e.g., "Server A (offline)")
     * - Keep it concise (under 50 characters) for better UI display
     * - Consider including server region or purpose for clarity
     *
     * @example "Production Jupyter Server" or "Dev Server (US-West)"
     */
    readonly label: string;
    /**
     * Information required to connect to the Jupyter Server.
     *
     * This property can be provided **eagerly** (at discovery time) or **lazily** (when user selects the server).
     *
     * **When to provide eagerly:**
     * - Authentication credentials are already available (e.g., cached tokens)
     * - No user interaction is required to establish connection
     * - Connection details are static and known upfront
     *
     * **When to provide lazily (undefined):**
     * - User needs to authenticate (OAuth, SSO, manual login)
     * - Connection details need to be fetched from another service
     * - User needs to select from multiple authentication options
     * - Setup or configuration is required before connecting
     *
     * **Lazy Resolution:**
     * If `undefined`, the Jupyter extension will call {@link JupyterServerProvider.resolveJupyterServer}
     * when the user selects this server. This allows deferring expensive operations or user interactions
     * until they're actually needed.
     *
     * @see {@link JupyterServerProvider.resolveJupyterServer}
     *
     * @example
     * ```typescript
     * // Eager: Connection info available immediately
     * connectionInformation: {
     *     baseUrl: vscode.Uri.parse('https://jupyter.example.com'),
     *     token: cachedToken
     * }
     *
     * // Lazy: Will be resolved when user selects this server
     * connectionInformation: undefined
     * ```
     */
    readonly connectionInformation?: JupyterServerConnectionInformation;
}

/**
 * Provider of Jupyter Servers.
 *
 * This interface allows extensions to contribute custom Jupyter server discovery and authentication logic.
 * Implement this interface to:
 * - Discover Jupyter servers from custom sources (APIs, configuration files, cloud services)
 * - Provide authentication for servers with custom schemes
 * - Enable users to connect to organization-specific Jupyter deployments
 *
 * **Implementation Requirements:**
 * - Must handle network errors and timeouts gracefully
 * - Should respond to cancellation tokens promptly
 * - Must return stable server IDs across calls
 * - Should fire `onDidChangeServers` when the server list changes
 *
 * **Lifecycle:**
 * 1. Extension creates and registers a provider via {@link Jupyter.createJupyterServerCollection}
 * 2. Jupyter extension calls {@link provideJupyterServers} to discover servers
 * 3. User selects a server from the UI
 * 4. Jupyter extension calls {@link resolveJupyterServer} to get connection details
 * 5. Connection is established and kernels are discovered
 *
 * @example
 * ```typescript
 * class MyJupyterServerProvider implements JupyterServerProvider {
 *     private _onDidChangeServers = new vscode.EventEmitter<void>();
 *     onDidChangeServers = this._onDidChangeServers.event;
 *
 *     async provideJupyterServers(token: CancellationToken): Promise<JupyterServer[]> {
 *         const servers = await fetchServersFromAPI();
 *         return servers.map(s => ({
 *             id: s.id,
 *             label: s.name,
 *             connectionInformation: {
 *                 baseUrl: vscode.Uri.parse(s.url),
 *                 token: s.token
 *             }
 *         }));
 *     }
 *
 *     async resolveJupyterServer(server: JupyterServer, token: CancellationToken): Promise<JupyterServer> {
 *         // Perform authentication if needed
 *         if (!server.connectionInformation) {
 *             const token = await authenticate(server.id);
 *             return {
 *                 ...server,
 *                 connectionInformation: {
 *                     baseUrl: vscode.Uri.parse('https://jupyter.example.com'),
 *                     token: token
 *                 }
 *             };
 *         }
 *         return server;
 *     }
 *
 *     // Call when servers change
 *     refreshServers() {
 *         this._onDidChangeServers.fire();
 *     }
 * }
 * ```
 */
export interface JupyterServerProvider {
    /**
     * Event fired when the list of servers changes.
     *
     * Fire this event when:
     * - New servers become available
     * - Existing servers are removed or become unavailable
     * - Server properties change (e.g., label, connection information)
     *
     * **Important:** The {@link provideJupyterServers} method will only be called again after this event fires.
     * If this event is never fired, the server list will only be queried once.
     *
     * **Performance Considerations:**
     * - Avoid firing this event too frequently (use debouncing if needed)
     * - Consider batching multiple changes into a single event
     * - Fire the event only when changes are actually detected
     *
     * @example
     * ```typescript
     * private _onDidChangeServers = new vscode.EventEmitter<void>();
     * onDidChangeServers = this._onDidChangeServers.event;
     *
     * // Fire when servers change
     * private notifyServersChanged() {
     *     this._onDidChangeServers.fire();
     * }
     * ```
     */
    onDidChangeServers?: Event<void>;
    /**
     * Returns the list of {@link JupyterServer Jupyter Servers}.
     *
     * This method is called by the Jupyter extension to discover available servers.
     * It should return all servers that the provider knows about.
     *
     * **When This Is Called:**
     * - When a user opens the kernel picker
     * - When {@link onDidChangeServers} event is fired
     * - When the user explicitly refreshes the server list
     *
     * **Implementation Guidelines:**
     * - Return `undefined` or `null` if no servers are available
     * - Return an empty array `[]` if servers exist but none are currently available
     * - Handle network timeouts and errors gracefully
     * - Respect the cancellation token to allow users to cancel slow operations
     * - Cache results if appropriate to improve performance
     *
     * **Error Handling:**
     * - Throw errors only for critical failures that prevent server discovery
     * - Return empty array for transient errors (network issues, timeouts)
     * - Log detailed error information for debugging
     *
     * @param token A cancellation token that indicates when the operation should be cancelled.
     *              Check `token.isCancellationRequested` periodically for long-running operations.
     *
     * @returns A promise that resolves to an array of servers, or `undefined`/`null` if unavailable.
     *
     * @example
     * ```typescript
     * async provideJupyterServers(token: CancellationToken): Promise<JupyterServer[]> {
     *     try {
     *         const response = await fetchWithTimeout('https://api.example.com/servers', { token });
     *         return response.servers.map(s => ({
     *             id: `myext.${s.id}`,
     *             label: s.name,
     *             connectionInformation: s.ready ? {
     *                 baseUrl: vscode.Uri.parse(s.url),
     *                 token: s.token
     *             } : undefined
     *         }));
     *     } catch (error) {
     *         console.error('Failed to fetch servers:', error);
     *         return []; // Return empty array on error
     *     }
     * }
     * ```
     */
    provideJupyterServers(token: CancellationToken): ProviderResult<JupyterServer[]>;
    /**
     * Resolves the connection information for a Jupyter server.
     *
     * This method is called when:
     * - User selects a server that doesn't have `connectionInformation` set
     * - Additional authentication or setup is required before connecting
     * - Connection details need to be fetched or computed dynamically
     *
     * **Use Cases:**
     * - **Deferred Authentication:** Prompt user for credentials or trigger OAuth flow
     * - **Dynamic URLs:** Fetch the actual server URL from a service or API
     * - **Just-in-Time Setup:** Start a server on-demand or allocate resources
     * - **Token Refresh:** Update expired authentication tokens
     *
     * **Return Values:**
     * - Return a server with `connectionInformation` populated to proceed with connection
     * - Return the original `server` unchanged if no additional information is needed
     * - Return `undefined` or `null` to cancel the connection (user cancelled auth, etc.)
     *
     * **User Experience:**
     * - This method may show UI (dialogs, authentication prompts) as it's called in response to user action
     * - Provide clear error messages if authentication or resolution fails
     * - Consider timeout handling for long-running operations
     *
     * @param server The server selected by the user that needs connection information resolved.
     * @param token A cancellation token. Respect this token to allow users to cancel authentication flows.
     *
     * @returns A promise that resolves to:
     *          - A JupyterServer with connection information populated
     *          - The original server if no changes needed
     *          - `undefined` or `null` to cancel the connection
     *
     * @example
     * ```typescript
     * async resolveJupyterServer(server: JupyterServer, token: CancellationToken): Promise<JupyterServer> {
     *     // If connection info already exists, return as-is
     *     if (server.connectionInformation) {
     *         return server;
     *     }
     *
     *     // Perform OAuth authentication
     *     const authToken = await this.authenticateWithOAuth(token);
     *     if (!authToken) {
     *         // User cancelled authentication
     *         return undefined;
     *     }
     *
     *     // Return server with connection information
     *     return {
     *         ...server,
     *         connectionInformation: {
     *             baseUrl: vscode.Uri.parse('https://jupyter.example.com'),
     *             headers: {
     *                 'Authorization': `Bearer ${authToken}`
     *             }
     *         }
     *     };
     * }
     * ```
     */
    resolveJupyterServer(server: JupyterServer, token: CancellationToken): ProviderResult<JupyterServer>;
}

/**
 * Represents a reference to a Jupyter Server command.
 *
 * Commands provide users with actions they can take related to Jupyter servers, such as:
 * - Starting a new Jupyter server
 * - Connecting to an existing server by entering a URL
 * - Opening server configuration UI
 * - Troubleshooting connection issues
 *
 * Commands appear in the kernel picker UI and can be selected by users as alternatives
 * to choosing from the list of available servers.
 *
 * **Auto-selection Feature:**
 * If no servers are available and only one command is marked with `canBeAutoSelected=true`,
 * that command will be executed automatically without showing UI. This provides a seamless
 * experience when only one logical action is available (e.g., starting a local Jupyter server).
 *
 * @see {@link JupyterServerCommandProvider} for command implementation details
 *
 * @example
 * ```typescript
 * const startLocalCommand: JupyterServerCommand = {
 *     label: 'Start Local Jupyter Server',
 *     description: 'Starts Jupyter on localhost:8888',
 *     canBeAutoSelected: true
 * };
 *
 * const enterUrlCommand: JupyterServerCommand = {
 *     label: 'Enter Server URL...',
 *     description: 'Connect to a Jupyter server by URL'
 * };
 * ```
 */
export interface JupyterServerCommand {
    /**
     * A human-readable string which is rendered prominently in the UI.
     *
     * This is the main text displayed for the command in the kernel picker.
     * Should be concise and action-oriented (e.g., "Start New Server", "Enter URL...").
     *
     * **Best Practices:**
     * - Use title case (e.g., "Start Local Server")
     * - Begin with an action verb when applicable (Start, Connect, Open, Configure)
     * - Keep under 50 characters for optimal display
     * - Include ellipsis (...) if the command will show additional UI
     *
     * @example "Start Local Jupyter Server" or "Connect to Remote Server..."
     */
    label: string;
    /**
     * A human-readable string which is rendered less prominently on the same line.
     *
     * Use this to provide additional context or details about what the command does.
     * This text appears in a lighter color or smaller font next to the label.
     *
     * **Use Cases:**
     * - Explain what the command will do: "Requires Docker to be running"
     * - Show current status: "Last used 2 hours ago"
     * - Indicate requirements: "Python 3.8+ required"
     * - Display shortcuts or hints: "Ctrl+Shift+J"
     *
     * @example "Launches Jupyter on port 8888" or "Configure authentication first"
     */
    description?: string;
    /**
     * Determines if this command can be automatically selected when it's the only option.
     *
     * **Auto-selection Logic:**
     * This property is only effective when ALL of the following conditions are true:
     * 1. {@link JupyterServerProvider.provideJupyterServers} returns no servers (empty array or undefined)
     * 2. {@link JupyterServerCommandProvider.provideCommands} returns commands
     * 3. Exactly ONE command has `canBeAutoSelected=true`
     * 4. All other commands have `canBeAutoSelected=false` or undefined
     *
     * When these conditions are met, the marked command is executed automatically without
     * showing the kernel picker UI. This provides a seamless experience for common scenarios.
     *
     * **Use Cases for Auto-selection:**
     * - Starting a local Jupyter server when no remote servers are configured
     * - Connecting to a default organization server
     * - Opening setup wizard for first-time users
     *
     * **Use Cases Against Auto-selection:**
     * - Commands that require user input (e.g., "Enter URL...")
     * - Commands with side effects (e.g., "Delete All Servers")
     * - Commands that might fail (e.g., "Start Docker Container")
     *
     * **Default:** If not specified, defaults to `false` (no auto-selection).
     *
     * @example
     * ```typescript
     * // This command can be auto-selected
     * {
     *     label: 'Start Local Jupyter Server',
     *     description: 'Default option',
     *     canBeAutoSelected: true
     * }
     *
     * // This command requires user input, should not be auto-selected
     * {
     *     label: 'Enter Server URL...',
     *     description: 'Connect to custom server',
     *     canBeAutoSelected: false
     * }
     * ```
     */
    canBeAutoSelected?: boolean;
}

/**
 * Provider of {@link JupyterServerCommand Jupyter Server Commands}.
 *
 * This interface allows extensions to contribute custom actions that users can take
 * related to Jupyter servers. Commands appear in the kernel picker UI alongside
 * the list of available servers.
 *
 * **Common Use Cases:**
 * - Starting a new local Jupyter server
 * - Prompting user to enter a server URL manually
 * - Opening server configuration/settings UI
 * - Starting a containerized Jupyter server (Docker, Kubernetes)
 * - Creating a new cloud-based Jupyter instance
 * - Troubleshooting or testing server connections
 *
 * **User Flow:**
 * 1. User opens the kernel picker (to select a kernel for a notebook)
 * 2. Jupyter extension calls {@link provideCommands} with current filter text
 * 3. Commands are displayed in the picker UI
 * 4. User selects a command
 * 5. Jupyter extension calls {@link handleCommand} with the selected command
 * 6. Implementation performs the action and optionally returns a server to connect to
 *
 * @example
 * ```typescript
 * class MyCommandProvider implements JupyterServerCommandProvider {
 *     async provideCommands(
 *         value: string | undefined,
 *         token: CancellationToken
 *     ): Promise<JupyterServerCommand[]> {
 *         return [
 *             {
 *                 label: 'Start Local Server',
 *                 description: 'Launch Jupyter on localhost',
 *                 canBeAutoSelected: true
 *             },
 *             {
 *                 label: 'Enter Server URL...',
 *                 description: value ? `Connect to ${value}` : 'Connect to custom server'
 *             }
 *         ];
 *     }
 *
 *     async handleCommand(
 *         command: JupyterServerCommand,
 *         token: CancellationToken
 *     ): Promise<JupyterServer | undefined> {
 *         if (command.label === 'Start Local Server') {
 *             await startLocalJupyter();
 *             return {
 *                 id: 'local',
 *                 label: 'Local Jupyter Server',
 *                 connectionInformation: {
 *                     baseUrl: vscode.Uri.parse('http://localhost:8888'),
 *                     token: await getJupyterToken()
 *                 }
 *             };
 *         } else {
 *             const url = await vscode.window.showInputBox({ prompt: 'Enter Jupyter URL' });
 *             if (!url) {
 *                 throw new vscode.CancellationError(); // User cancelled
 *             }
 *             return {
 *                 id: `custom-${Date.now()}`,
 *                 label: 'Custom Server',
 *                 connectionInformation: {
 *                     baseUrl: vscode.Uri.parse(url)
 *                 }
 *             };
 *         }
 *     }
 * }
 * ```
 */
export interface JupyterServerCommandProvider {
    /**
     * Returns a list of commands to be displayed to the user.
     *
     * This method is called when the user opens the kernel picker. It should return
     * all commands that are relevant in the current context.
     *
     * **Dynamic Command Generation:**
     * The `value` parameter allows for dynamic command generation based on user input.
     * For example, if the user types a URL in the picker, you can show a command
     * to connect to that specific URL.
     *
     * **Performance Considerations:**
     * - This method should return quickly (< 100ms) as it's called during UI interaction
     * - Cache expensive operations or compute them lazily in {@link handleCommand}
     * - Return fewer commands for better UX (typically 1-5 commands)
     *
     * **Filtering:**
     * Commands are automatically filtered by VS Code based on label matching.
     * You don't need to implement filtering yourself unless you want custom behavior.
     *
     * @param value The current text entered by the user in the kernel picker quick pick.
     *              This can be used to provide dynamic commands based on user input.
     *              Will be `undefined` if the user hasn't entered any text yet.
     *
     * @param token A cancellation token. Respect this to allow responsive UI.
     *
     * @returns A promise that resolves to an array of commands, or `undefined`/`null` if no commands available.
     *
     * @example
     * ```typescript
     * async provideCommands(value: string | undefined, token: CancellationToken): Promise<JupyterServerCommand[]> {
     *     const commands: JupyterServerCommand[] = [
     *         {
     *             label: 'Start Local Jupyter Server',
     *             description: 'Launches on port 8888',
     *             canBeAutoSelected: true
     *         }
     *     ];
     *
     *     // If user is typing a URL, show a command to connect to it
     *     if (value && (value.startsWith('http://') || value.startsWith('https://'))) {
     *         commands.push({
     *             label: 'Connect to This URL',
     *             description: value
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
     * This method should execute the command action and optionally return a Jupyter server
     * that the user should connect to. This is where the actual work happens.
     *
     * **Possible Actions:**
     * - Start a new Jupyter server process
     * - Show UI to collect user input (URL, credentials)
     * - Create cloud resources (VMs, containers)
     * - Perform authentication flows
     * - Open configuration pages
     *
     * **Return Value Semantics:**
     * - **Return a JupyterServer:** Jupyter extension will connect to the returned server
     * - **Return undefined/null:** Goes back to the previous UI (usually the kernel picker)
     * - **Throw CancellationError:** User explicitly cancelled, closes all related UI
     * - **Throw other Error:** Shows error message to user, then returns to kernel picker
     *
     * **Back Button Pattern:**
     * Returning `undefined` or `null` implements a back-button-like behavior. This is useful
     * if your command shows a multi-step UI and the user wants to go back to the previous step.
     *
     * **Cancellation Handling:**
     * If the user cancels your workflow by:
     * - Clicking a close/cancel button in your UI
     * - Pressing ESC key
     * - Closing a dialog
     *
     * Then you MUST throw a {@link CancellationError} (not return undefined). This signals
     * to the Jupyter extension that the user wants to exit the entire workflow, not just
     * go back to the previous screen.
     *
     * **Error Handling Best Practices:**
     * - Show progress notifications for long-running operations
     * - Provide clear error messages with actionable guidance
     * - Log detailed errors for troubleshooting
     * - Consider retry logic for transient failures
     *
     * @param command The {@link JupyterServerCommand command} selected by the user.
     *                Contains the label and description that were shown in the picker.
     *
     * @param token A cancellation token. The command should respect this token:
     *              - Check `token.isCancellationRequested` periodically
     *              - Pass the token to async operations
     *              - Stop work immediately when cancellation is requested
     *
     * @returns A promise that resolves to:
     *          - **JupyterServer:** The server to connect to (command succeeded)
     *          - **undefined/null:** Go back to previous UI (back button behavior)
     *
     * @throws {CancellationError} If the user explicitly cancels the operation (closes UI, presses ESC).
     *                              This closes all related UI and cancels the entire workflow.
     *
     * @throws {Error} If the operation fails. The error message will be shown to the user,
     *                 and then the kernel picker will be displayed again.
     *
     * @example
     * ```typescript
     * async handleCommand(command: JupyterServerCommand, token: CancellationToken): Promise<JupyterServer | undefined> {
     *     if (command.label === 'Start Local Server') {
     *         // Show progress
     *         await vscode.window.withProgress({
     *             location: vscode.ProgressLocation.Notification,
     *             title: 'Starting Jupyter Server...'
     *         }, async () => {
     *             await startJupyterServer(token);
     *         });
     *
     *         return {
     *             id: 'local',
     *             label: 'Local Jupyter Server',
     *             connectionInformation: {
     *                 baseUrl: vscode.Uri.parse('http://localhost:8888'),
     *                 token: await getJupyterToken()
     *             }
     *         };
     *     }
     *
     *     if (command.label === 'Enter Server URL...') {
     *         const url = await vscode.window.showInputBox({
     *             prompt: 'Enter Jupyter Server URL',
     *             placeHolder: 'http://localhost:8888'
     *         });
     *
     *         if (!url) {
     *             // User closed the input box - throw CancellationError
     *             throw new vscode.CancellationError();
     *         }
     *
     *         try {
     *             new URL(url); // Validate URL
     *         } catch {
     *             throw new Error('Invalid URL format');
     *         }
     *
     *         return {
     *             id: `custom-${Date.now()}`,
     *             label: 'Custom Server',
     *             connectionInformation: {
     *                 baseUrl: vscode.Uri.parse(url)
     *             }
     *         };
     *     }
     *
     *     // Unknown command - return undefined to go back
     *     return undefined;
     * }
     * ```
     */
    handleCommand(command: JupyterServerCommand, token: CancellationToken): ProviderResult<JupyterServer>;
}

/**
 * Represents a logical collection of {@link JupyterServer Jupyter Servers}.
 *
 * A collection groups related Jupyter servers together and appears as a single entry
 * in the VS Code kernel picker. This allows extensions to:
 * - Organize servers by environment (production, staging, development)
 * - Group servers by region or data center
 * - Separate personal vs. shared servers
 * - Provide multiple authentication providers
 *
 * **Collection Lifecycle:**
 * 1. Created via {@link Jupyter.createJupyterServerCollection}
 * 2. Appears in the kernel picker UI
 * 3. Servers are discovered via the associated {@link JupyterServerProvider}
 * 4. User can select servers or commands from this collection
 * 5. Disposed explicitly via {@link dispose} or when extension deactivates
 *
 * **Multiple Collections:**
 * Extensions can create multiple collections to organize servers logically.
 * Each collection appears as a separate category in the kernel picker.
 *
 * **Dynamic Updates:**
 * Collection properties (label, documentation, commandProvider) can be updated
 * at runtime. Changes are reflected in the UI immediately.
 *
 * @see {@link Jupyter.createJupyterServerCollection} for creation details
 *
 * @example
 * ```typescript
 * // Create a collection
 * const collection = jupyterApi.createJupyterServerCollection(
 *     'myext.prod-servers',
 *     'Production Servers',
 *     myServerProvider
 * );
 *
 * // Update collection properties
 * collection.label = 'Production Servers (10 available)';
 * collection.documentation = vscode.Uri.parse('https://docs.example.com/jupyter');
 * collection.commandProvider = myCommandProvider;
 *
 * // Clean up when done
 * collection.dispose();
 * ```
 */
export interface JupyterServerCollection {
    /**
     * Unique identifier of the Server Collection.
     *
     * This is the same ID that was provided when creating the collection via
     * {@link Jupyter.createJupyterServerCollection}.
     *
     * The ID is used internally by the Jupyter extension to:
     * - Track which collections belong to which extensions
     * - Persist user preferences (e.g., which collection was last used)
     * - Prevent ID conflicts between extensions
     *
     * This property is read-only and cannot be changed after creation.
     *
     * @example "myextension.production-servers"
     */
    readonly id: string;
    /**
     * A human-readable string representing the collection of the servers.
     *
     * This label is displayed in the kernel picker UI to help users identify
     * the collection. It can be updated dynamically to reflect the current state
     * (e.g., number of available servers, connection status).
     *
     * **Best Practices:**
     * - Use descriptive names (e.g., "Company Jupyter Servers", "AWS Notebooks")
     * - Include status information when relevant (e.g., "Production (3 servers)")
     * - Keep under 60 characters for optimal display
     * - Update label when collection state changes significantly
     *
     * **Dynamic Updates:**
     * Changing this property updates the UI immediately. This is useful for
     * showing real-time status or server counts.
     *
     * @example
     * ```typescript
     * // Initial label
     * collection.label = 'My Servers';
     *
     * // Update with server count
     * const servers = await provider.provideJupyterServers(token);
     * collection.label = `My Servers (${servers.length} available)`;
     *
     * // Update with status
     * collection.label = 'My Servers (connecting...)';
     * ```
     */
    label: string;
    /**
     * A link to a resource containing more information about this collection.
     *
     * This URI is displayed in the UI as a help/documentation link that users
     * can click to learn more about the server collection.
     *
     * **Supported URI Schemes:**
     * - **https://** - Opens in external browser (most common)
     * - **http://** - Opens in external browser
     * - **file://** - Opens local HTML file in VS Code
     * - **vscode://** - Opens VS Code resource (settings, extensions page)
     * - **command:** - Executes a VS Code command
     *
     * **Use Cases:**
     * - Link to setup instructions or getting started guide
     * - Point to troubleshooting documentation
     * - Link to organization's Jupyter usage policies
     * - Open configuration UI via command URI
     *
     * **Optional:** Can be `undefined` if no documentation is available.
     * Setting to `undefined` removes the documentation link from the UI.
     *
     * @example
     * ```typescript
     * // External documentation
     * collection.documentation = vscode.Uri.parse('https://docs.example.com/jupyter-setup');
     *
     * // Open settings page
     * collection.documentation = vscode.Uri.parse('vscode://settings/myext.jupyter');
     *
     * // Execute a command
     * collection.documentation = vscode.Uri.parse('command:myext.openJupyterHelp');
     *
     * // Remove documentation link
     * collection.documentation = undefined;
     * ```
     */
    documentation?: Uri;
    /**
     * Provider of {@link JupyterServerCommand Commands} for this collection.
     *
     * The command provider allows users to perform actions related to this collection,
     * such as starting new servers, entering custom URLs, or opening configuration UI.
     *
     * Commands appear in the kernel picker when the user is browsing this collection.
     *
     * **When to Use:**
     * - To provide collection-specific actions (e.g., "Start Server in This Region")
     * - To allow users to add new servers to this collection
     * - To provide shortcuts to common tasks (e.g., "Refresh Server List")
     *
     * **Dynamic Updates:**
     * This property can be changed at runtime to:
     * - Enable/disable commands based on context
     * - Switch command providers based on authentication state
     * - Add commands after extension initialization
     *
     * **Optional:** Can be `undefined` if no commands are needed for this collection.
     * Most collections will want to provide at least one command for adding new servers.
     *
     * @see {@link JupyterServerCommandProvider} for implementation details
     *
     * @example
     * ```typescript
     * // Set initial command provider
     * collection.commandProvider = {
     *     async provideCommands(value, token) {
     *         return [
     *             { label: 'Start New Server', canBeAutoSelected: true },
     *             { label: 'Enter URL...' }
     *         ];
     *     },
     *     async handleCommand(command, token) {
     *         // Handle command...
     *     }
     * };
     *
     * // Update command provider based on authentication
     * if (isAuthenticated) {
     *     collection.commandProvider = authenticatedCommandProvider;
     * } else {
     *     collection.commandProvider = unauthenticatedCommandProvider;
     * }
     *
     * // Remove commands
     * collection.commandProvider = undefined;
     * ```
     */
    commandProvider?: JupyterServerCommandProvider;
    /**
     * Removes this Server Collection from the VS Code UI.
     *
     * This method should be called when:
     * - The collection is no longer needed
     * - The extension is deactivating
     * - User disables the feature that provides this collection
     * - The collection should be temporarily hidden from the UI
     *
     * **Effects of Disposing:**
     * - Collection is immediately removed from the kernel picker UI
     * - Users can no longer select servers from this collection
     * - All associated resources (event listeners, etc.) are cleaned up
     * - The {@link JupyterServerProvider} is no longer called
     *
     * **Important Notes:**
     * - Disposing is permanent - you must create a new collection to re-add it
     * - Active kernel connections from this collection continue running
     * - Users currently using kernels from this collection are not interrupted
     * - The collection ID becomes available for reuse after disposal
     *
     * **Best Practices:**
     * - Always dispose collections in your extension's `deactivate()` function
     * - Store collection references to dispose them later
     * - Consider disposing and recreating collections instead of keeping them inactive
     *
     * @example
     * ```typescript
     * let collection: JupyterServerCollection | undefined;
     *
     * export function activate(context: vscode.ExtensionContext) {
     *     const jupyterApi = await getJupyterApi();
     *     collection = jupyterApi.createJupyterServerCollection(
     *         'myext.servers',
     *         'My Servers',
     *         provider
     *     );
     *
     *     // Automatically dispose when extension deactivates
     *     context.subscriptions.push(collection);
     * }
     *
     * export function deactivate() {
     *     // Explicitly dispose if not using context.subscriptions
     *     collection?.dispose();
     * }
     * ```
     */
    dispose(): void;
}
// #endregion

// #region Kernels API
/**
 * Represents a single output item from a notebook cell execution.
 *
 * Output items are the individual pieces of data produced by code execution,
 * such as text, images, HTML, or errors. A single output can contain multiple
 * items with different MIME types, allowing renderers to choose the best format.
 *
 * **Output Item Structure:**
 * - **mime:** The MIME type identifying the format of the data
 * - **data:** The actual output data as a byte array
 *
 * The Jupyter extension uses these output items to display results in the notebook UI.
 *
 * @see {@link Output} for the container of output items
 */
interface OutputItem {
    /**
     * The MIME type of this output item.
     *
     * MIME types identify the format of the output data, enabling appropriate rendering.
     * The Jupyter extension uses MIME types to select the best renderer for each output.
     *
     * **Standard MIME Types:**
     * - `text/plain` - Plain text output (e.g., print statements)
     * - `text/html` - HTML content that can be rendered in the notebook
     * - `application/json` - JSON data structures
     * - `image/png` - PNG images (base64 encoded in data)
     * - `image/jpeg` - JPEG images
     * - `image/svg+xml` - SVG vector graphics
     * - `application/javascript` - JavaScript code to execute
     * - `text/markdown` - Markdown formatted text
     * - `text/latex` - LaTeX mathematical notation
     *
     * **Special VS Code MIME Types:**
     * These are VS Code-specific MIME types for notebook outputs:
     * - `application/x.notebook.stream.stdout` - Standard output stream (same as NotebookCellOutputItem.stdout('').mime)
     * - `application/x.notebook.stream.stderr` - Standard error stream (same as NotebookCellOutputItem.stderr('').mime)
     * - `application/vnd.code.notebook.error` - Error/exception output (same as NotebookCellOutputItem.error(...).mime)
     *
     * **Rich Output:**
     * A single output can have multiple items with different MIME types (e.g., both text/plain and text/html).
     * VS Code will render the best available representation based on available renderers.
     *
     * @example "text/plain" or "application/json" or "image/png"
     */
    mime: string;
    /**
     * The binary data of this output item.
     *
     * This byte array contains the actual output data in the format specified by the {@link mime} type.
     *
     * **Data Encoding:**
     * - Text formats (text/plain, text/html, etc.): UTF-8 encoded text
     * - Binary formats (image/png, application/pdf, etc.): Raw binary data
     * - JSON: UTF-8 encoded JSON string
     *
     * **Data Size:**
     * Be mindful of output size, as very large outputs can impact notebook performance.
     * Consider truncating or sampling large outputs for better UX.
     *
     * **Access Patterns:**
     * ```typescript
     * // For text outputs
     * const text = new TextDecoder().decode(item.data);
     *
     * // For JSON outputs
     * const jsonText = new TextDecoder().decode(item.data);
     * const obj = JSON.parse(jsonText);
     *
     * // For binary outputs (images, etc.)
     * const blob = new Blob([item.data], { type: item.mime });
     * ```
     */
    data: Uint8Array;
}

/**
 * Represents the output from a notebook cell execution.
 *
 * Each output corresponds to a single execution result, which may include multiple
 * {@link OutputItem items} in different formats (MIME types). Outputs are displayed
 * in the notebook UI beneath the code cell that produced them.
 *
 * **Output Types:**
 * - **Display outputs:** Results from display() calls or expression evaluation
 * - **Stream outputs:** stdout and stderr text streams
 * - **Error outputs:** Exception information and tracebacks
 *
 * **Multiple Items:**
 * An output can contain multiple items with different MIME types. This allows
 * VS Code to choose the best renderer. For example, a pandas DataFrame might have
 * both text/plain (simple table) and text/html (rich formatting) representations.
 *
 * @see {@link OutputItem} for individual output item details
 * @see {@link Kernel.executeCode} for code execution that produces outputs
 */
interface Output {
    /**
     * The output items of this output.
     *
     * This array contains all the different representations of this output.
     * Each item has a different MIME type, providing multiple ways to display the same result.
     *
     * **Item Ordering:**
     * - Items are typically ordered by preference (most specific to most general)
     * - Renderers choose the first item they can handle
     * - Include text/plain as a fallback for maximum compatibility
     *
     * **Common Patterns:**
     * - Single item: `[{ mime: 'text/plain', data: ... }]`
     * - Multiple representations: `[{ mime: 'text/html', data: ... }, { mime: 'text/plain', data: ... }]`
     * - Image output: `[{ mime: 'image/png', data: ... }]`
     * - Error output: `[{ mime: 'application/vnd.code.notebook.error', data: ... }]`
     *
     * @example
     * ```typescript
     * // Simple text output
     * {
     *     items: [
     *         {
     *             mime: 'text/plain',
     *             data: new TextEncoder().encode('Hello, World!')
     *         }
     *     ]
     * }
     *
     * // Rich output with HTML and plain text fallback
     * {
     *     items: [
     *         {
     *             mime: 'text/html',
     *             data: new TextEncoder().encode('<h1>Hello</h1>')
     *         },
     *         {
     *             mime: 'text/plain',
     *             data: new TextEncoder().encode('Hello')
     *         }
     *     ]
     * }
     * ```
     */
    items: OutputItem[];
    /**
     * Arbitrary metadata for this cell output.
     *
     * Metadata provides additional information about the output that may be useful
     * for renderers, debuggers, or other tools. The metadata must be JSON-serializable.
     *
     * **Common Metadata Keys:**
     * - `execution_count`: The execution number that produced this output
     * - `isolated`: Whether the output is isolated from other outputs
     * - Custom renderer metadata: Renderer-specific configuration
     *
     * **Use Cases:**
     * - Storing execution context for debugging
     * - Passing configuration to custom renderers
     * - Tracking output provenance or lineage
     * - Storing display preferences (e.g., collapsed state)
     *
     * **Restrictions:**
     * - Must be JSON-serializable (no functions, circular references, etc.)
     * - Keep metadata small to avoid notebook bloat
     * - Use namespaced keys to avoid conflicts (e.g., "myext.config")
     *
     * @example
     * ```typescript
     * {
     *     execution_count: 5,
     *     "myext.renderConfig": {
     *         theme: "dark",
     *         fontSize: 14
     *     }
     * }
     * ```
     */
    metadata?: { [key: string]: any };
}

/**
 * Represents the possible states of a Jupyter kernel.
 *
 * The kernel status indicates the current operational state of the kernel process.
 * Understanding kernel status is important for:
 * - Showing appropriate UI feedback to users
 * - Deciding whether code can be executed
 * - Detecting when kernels need to be restarted
 * - Handling error conditions gracefully
 *
 * **Status Transitions:**
 * ```
 * unknown -> starting -> idle -> busy -> idle
 *                           ↓
 *                      restarting -> idle
 *                           ↓
 *                      terminating -> dead
 *                           ↓
 *                      autorestarting -> starting
 * ```
 *
 * @see {@link Kernel.status} for the current kernel status
 * @see {@link Kernel.onDidChangeStatus} for status change notifications
 */
export type KernelStatus =
    /**
     * Kernel status is unknown or not yet determined.
     *
     * This is typically the initial state before the kernel has fully started
     * or when the connection to the kernel has been lost.
     *
     * **When This Occurs:**
     * - Immediately after kernel creation, before connection established
     * - After connection loss, before reconnection attempt
     * - During initialization of remote kernels
     */
    | 'unknown'
    /**
     * Kernel is starting up and initializing.
     *
     * The kernel process is launching but is not yet ready to execute code.
     * This phase includes process startup, environment initialization, and
     * establishing communication channels.
     *
     * **When This Occurs:**
     * - Immediately after kernel launch
     * - During kernel process initialization
     * - While establishing socket connections
     *
     * **Typical Duration:** 1-5 seconds for local kernels, longer for remote/cloud kernels
     *
     * **Next State:** Usually transitions to 'idle' when ready
     */
    | 'starting'
    /**
     * Kernel is idle and ready to execute code.
     *
     * This is the normal resting state. The kernel is fully initialized and
     * waiting for execution requests. It's safe to submit code for execution.
     *
     * **When This Occurs:**
     * - After successful kernel startup
     * - After completing code execution
     * - After completing a restart
     *
     * **Actions Possible:** Execute code, inspect variables, interrupt, restart, shutdown
     */
    | 'idle'
    /**
     * Kernel is actively executing code.
     *
     * The kernel is processing an execution request and is not available for
     * new execution requests. Multiple cells may be queued, but only one is
     * actively executing at a time.
     *
     * **When This Occurs:**
     * - During cell execution
     * - While processing kernel requests (inspect, complete, etc.)
     * - During long-running computations
     *
     * **Actions Possible:** Interrupt, view partial outputs, queue additional executions
     *
     * **Next State:** Returns to 'idle' when execution completes
     */
    | 'busy'
    /**
     * Kernel is shutting down.
     *
     * The kernel has been instructed to terminate and is cleaning up resources.
     * No new execution requests will be accepted.
     *
     * **When This Occurs:**
     * - User explicitly shuts down the kernel
     * - Notebook is closed and kernel is not shared
     * - Extension is deactivating
     *
     * **Next State:** Usually transitions to 'dead'
     *
     * **Note:** This is different from 'dead' - terminating is an active shutdown,
     * while 'dead' means the kernel has stopped unexpectedly or shutdown has completed.
     */
    | 'terminating'
    /**
     * Kernel is restarting (user-initiated).
     *
     * The kernel is being restarted due to a user action. The current kernel
     * process will be terminated and a new one will be started. All variables
     * and state will be lost.
     *
     * **When This Occurs:**
     * - User clicks "Restart Kernel" button
     * - Restart command is executed
     * - Programmatic restart is triggered
     *
     * **Next State:** Transitions to 'starting', then 'idle' when complete
     *
     * **Impact:** All kernel state (variables, imports, etc.) is lost
     */
    | 'restarting'
    /**
     * Kernel is restarting automatically after a crash.
     *
     * The kernel crashed or died unexpectedly and the Jupyter extension is
     * attempting to automatically restart it. This provides better UX by
     * recovering from transient failures without user intervention.
     *
     * **When This Occurs:**
     * - Kernel crashes due to segfault or uncaught exception
     * - Kernel process exits unexpectedly
     * - Communication with kernel is lost
     *
     * **Next State:**
     * - Success: Transitions to 'starting', then 'idle'
     * - Failure: Transitions to 'dead' if restart fails
     *
     * **Retry Logic:** May attempt multiple restart attempts before giving up
     */
    | 'autorestarting'
    /**
     * Kernel has died or failed to start.
     *
     * The kernel process has terminated unexpectedly or failed to start properly.
     * No communication with the kernel is possible. User intervention is required
     * to start a new kernel.
     *
     * **When This Occurs:**
     * - Kernel crashes and cannot be auto-restarted
     * - Kernel startup fails (missing dependencies, configuration errors)
     * - Kernel process is killed externally
     * - After 'terminating' state completes
     *
     * **Recovery:** User must manually select and start a new kernel
     *
     * **Common Causes:**
     * - Missing Python packages (ipykernel)
     * - Python environment issues
     * - Out of memory errors
     * - Segmentation faults in native extensions
     */
    | 'dead';

/**
 * Represents a Jupyter Kernel - the computational engine that executes code.
 *
 * A kernel is the backend process that runs code and returns results. It maintains
 * its own state (variables, imports, etc.) and can execute code in a specific
 * programming language (Python, R, Julia, etc.).
 *
 * **Kernel Lifecycle:**
 * 1. Kernel is created and starts (status: 'starting')
 * 2. Kernel becomes ready (status: 'idle')
 * 3. Code is executed (status: 'busy')
 * 4. Results are returned (status: 'idle')
 * 5. Kernel can be restarted or shut down
 *
 * **State Management:**
 * - Kernels maintain their own execution state (variables, imports, etc.)
 * - State persists across cell executions until kernel is restarted
 * - Multiple notebooks can share the same kernel in some configurations
 *
 * **Thread Safety:**
 * Only one execution can be active at a time per kernel. Additional execution
 * requests are queued automatically.
 *
 * @see {@link Kernels.getKernel} for obtaining kernel instances
 *
 * @example
 * ```typescript
 * // Get kernel for a notebook
 * const kernel = await jupyterApi.kernels.getKernel(notebookUri);
 *
 * if (kernel) {
 *     // Monitor status changes
 *     kernel.onDidChangeStatus(status => {
 *         console.log(`Kernel status: ${status}`);
 *     });
 *
 *     // Execute code
 *     const outputs = kernel.executeCode('print("Hello")', token);
 *     for await (const output of outputs) {
 *         console.log('Output:', output);
 *     }
 * }
 * ```
 */
export interface Kernel {
    /**
     * Event emitted when the kernel status changes.
     *
     * Listen to this event to track kernel lifecycle and update UI accordingly.
     * Status changes indicate important state transitions such as:
     * - Kernel becoming ready for execution
     * - Execution starting/completing
     * - Kernel restarting or crashing
     *
     * **Event Frequency:**
     * - High frequency during active usage (idle <-> busy transitions)
     * - Low frequency during idle periods
     * - Burst of events during startup and restart
     *
     * **Use Cases:**
     * - Updating UI to show kernel status (spinner, status bar)
     * - Enabling/disabling execution buttons based on readiness
     * - Detecting when kernel needs attention (dead, restarting)
     * - Logging kernel lifecycle for debugging
     *
     * **Important Status Transitions:**
     * - `starting` -> `idle`: Kernel ready for first use
     * - `idle` -> `busy`: Execution started
     * - `busy` -> `idle`: Execution completed
     * - `idle` -> `restarting`: Manual restart initiated
     * - `*` -> `dead`: Kernel has crashed or failed
     *
     * @example
     * ```typescript
     * const disposable = kernel.onDidChangeStatus(status => {
     *     switch (status) {
     *         case 'idle':
     *             // Kernel ready - enable run button
     *             statusBar.text = '$(notebook-kernel-select) Ready';
     *             break;
     *         case 'busy':
     *             // Kernel executing - show spinner
     *             statusBar.text = '$(sync~spin) Executing...';
     *             break;
     *         case 'dead':
     *             // Kernel crashed - show error
     *             statusBar.text = '$(error) Kernel died';
     *             vscode.window.showErrorMessage('Kernel has crashed');
     *             break;
     *         case 'restarting':
     *             // Kernel restarting - show warning
     *             statusBar.text = '$(sync~spin) Restarting...';
     *             break;
     *     }
     * });
     *
     * // Don't forget to dispose
     * context.subscriptions.push(disposable);
     * ```
     */
    onDidChangeStatus: Event<KernelStatus>;
    /**
     * The current status of the kernel.
     *
     * This property provides synchronous access to the current kernel status.
     * It always reflects the most recent status value emitted by {@link onDidChangeStatus}.
     *
     * **Status Meanings:**
     * - `'unknown'`: Status not yet determined or connection lost
     * - `'starting'`: Kernel process is launching
     * - `'idle'`: Ready to execute code
     * - `'busy'`: Currently executing code
     * - `'terminating'`: Shutting down
     * - `'restarting'`: Restarting (user-initiated)
     * - `'autorestarting'`: Automatically restarting after crash
     * - `'dead'`: Kernel has died or failed to start
     *
     * **Usage Patterns:**
     * ```typescript
     * // Check if kernel is ready before execution
     * if (kernel.status === 'idle') {
     *     await executeCode();
     * }
     *
     * // Check if kernel needs attention
     * if (kernel.status === 'dead') {
     *     await restartKernel();
     * }
     *
     * // Wait for kernel to be ready
     * if (kernel.status === 'starting') {
     *     await new Promise(resolve => {
     *         const listener = kernel.onDidChangeStatus(status => {
     *             if (status === 'idle') {
     *                 listener.dispose();
     *                 resolve();
     *             }
     *         });
     *     });
     * }
     * ```
     */
    readonly status: KernelStatus;
    /**
     * Language of the kernel.
     *
     * This string identifies the primary programming language supported by this kernel.
     * It's used for:
     * - Syntax highlighting in the notebook
     * - Language-specific IntelliSense and code completion
     * - Selecting appropriate code formatters and linters
     * - Displaying kernel information to users
     *
     * **Common Values:**
     * - `'python'` - Python kernels (ipykernel)
     * - `'r'` - R kernels (IRkernel)
     * - `'julia'` - Julia kernels (IJulia)
     * - `'javascript'` - JavaScript kernels (IJavascript)
     * - `'scala'` - Scala kernels (Apache Toree)
     * - `'csharp'` - C# kernels (.NET Interactive)
     * - `'fsharp'` - F# kernels (.NET Interactive)
     * - `'powershell'` - PowerShell kernels (.NET Interactive)
     *
     * **Language Identification:**
     * The language string typically matches the VS Code language ID but may vary
     * depending on the kernel. Check kernel documentation for exact values.
     *
     * **Case Sensitivity:**
     * Language identifiers are usually lowercase but treat as case-sensitive for reliability.
     *
     * @example "python" or "r" or "julia"
     */
    readonly language: string;
    /**
     * Executes code in the kernel without affecting the execution count or history.
     *
     * This method provides programmatic code execution that:
     * - Does NOT increment the notebook's execution counter (In[n])
     * - Does NOT add the code to the kernel's execution history (accessible via Up arrow)
     * - Does NOT store execution results in `_` or `__` variables (Python)
     * - DOES return all outputs (stdout, stderr, display data, errors)
     *
     * **Use Cases:**
     * - Running utility code (setup, cleanup, inspection)
     * - Querying kernel state without side effects on user's workflow
     * - Background data fetching or validation
     * - Running code from custom extensions or commands
     * - Implementing custom REPL-like features
     *
     * **Silent vs. Regular Execution:**
     * This is similar to Jupyter's "silent" execution mode. Regular cell execution
     * (triggered by user running cells) uses a different mechanism that does affect
     * execution count and history.
     *
     * **Output Handling:**
     * The method returns an async iterable that yields outputs as they're produced.
     * This allows for streaming results and progress updates.
     *
     * **Error Handling:**
     * - Execution errors appear as error outputs in the iterable
     * - Network/connection errors throw exceptions
     * - Cancellation via token stops execution cleanly
     *
     * **Performance Considerations:**
     * - Each execution holds the kernel's execution lock
     * - Other executions (including user cell executions) are queued
     * - Keep executions short to avoid blocking user workflow
     * - Use cancellation tokens for long-running operations
     *
     * @param code The code string to execute in the kernel. Can be single-line or multi-line.
     *             Should be valid code in the kernel's language.
     *
     * @param token Cancellation token that triggers execution cancellation.
     *              When cancelled, the kernel receives an interrupt request and stops execution.
     *              Check `token.isCancellationRequested` to handle cancellation gracefully.
     *
     * @returns An async iterable of outputs. Iterate using `for await...of` to receive outputs
     *          as they're produced. The iterable completes when execution finishes.
     *
     * @throws {Error} If the kernel is not in a state to accept executions (e.g., 'dead' or 'terminating')
     * @throws {Error} If there's a communication error with the kernel
     *
     * @example
     * ```typescript
     * // Basic execution
     * const outputs = kernel.executeCode('print("Hello")', token);
     * for await (const output of outputs) {
     *     for (const item of output.items) {
     *         if (item.mime === 'text/plain') {
     *             const text = new TextDecoder().decode(item.data);
     *             console.log('Output:', text);
     *         }
     *     }
     * }
     * ```
     *
     * @example
     * ```typescript
     * // Execution with cancellation
     * const cts = new vscode.CancellationTokenSource();
     * setTimeout(() => cts.cancel(), 5000); // Cancel after 5 seconds
     *
     * try {
     *     const outputs = kernel.executeCode('import time; time.sleep(10)', cts.token);
     *     for await (const output of outputs) {
     *         console.log('Output:', output);
     *     }
     * } catch (error) {
     *     if (error instanceof vscode.CancellationError) {
     *         console.log('Execution cancelled');
     *     } else {
     *         console.error('Execution failed:', error);
     *     }
     * }
     * ```
     *
     * @example
     * ```typescript
     * // Collecting all outputs
     * const allOutputs: Output[] = [];
     * const outputs = kernel.executeCode('df.head()', token);
     * for await (const output of outputs) {
     *     allOutputs.push(output);
     * }
     * console.log(`Received ${allOutputs.length} outputs`);
     * ```
     *
     * @example
     * ```typescript
     * // Inspecting variables silently
     * async function getVariableValue(kernel: Kernel, varName: string): Promise<string | undefined> {
     *     const code = `print(repr(${varName}))`;
     *     const outputs = kernel.executeCode(code, token);
     *
     *     for await (const output of outputs) {
     *         for (const item of output.items) {
     *             if (item.mime === 'text/plain') {
     *                 return new TextDecoder().decode(item.data);
     *             }
     *         }
     *     }
     *     return undefined;
     * }
     * ```
     */
    executeCode(code: string, token: CancellationToken): AsyncIterable<Output>;
}

/**
 * API for accessing and interacting with Jupyter kernels.
 *
 * This interface provides the entry point for kernel-related operations.
 * Currently, it allows retrieving active kernels associated with resources (notebooks).
 *
 * **Kernel Ownership:**
 * Kernels are associated with resources (typically notebook URIs). A kernel is "active"
 * when it's been started by a user and is currently running for an open notebook.
 *
 * **Lifecycle:**
 * - Kernels are started when users select them for notebooks
 * - Kernels remain active while notebooks are open
 * - Kernels may be shared between notebooks (depending on configuration)
 * - Kernels are automatically cleaned up when notebooks are closed
 *
 * **Access Control:**
 * Only kernels that have been started and belong to currently open notebooks are accessible.
 * This prevents extensions from accessing kernels from closed notebooks or interfering
 * with kernel lifecycle management.
 *
 * @see {@link Jupyter.kernels} to access this API
 */
export interface Kernels {
    /**
     * Gets the kernel associated with a given resource.
     *
     * This method retrieves the active kernel for a resource (typically a notebook).
     * It only returns kernels that:
     * 1. Have been successfully started by the user
     * 2. Belong to notebooks that are currently open in VS Code
     * 3. Are in a usable state (not 'dead')
     *
     * **Resource Types:**
     * - **Notebook URI:** Get the kernel for a specific notebook document
     * - **File URI:** For notebooks saved as files (most common)
     * - **Untitled URI:** For unsaved notebooks (untitled:Untitled-1)
     *
     * **When Returns undefined:**
     * - No kernel has been selected for the resource yet
     * - Kernel is still starting up (status: 'starting')
     * - Kernel has died or failed to start (status: 'dead')
     * - The notebook/resource is not open in VS Code
     * - The resource is not associated with a notebook
     *
     * **Best Practices:**
     * - Always check for undefined before using the returned kernel
     * - Listen to kernel status changes to detect when kernel becomes unavailable
     * - Don't cache kernel references long-term - always query fresh
     * - Handle cases where kernel might be undefined gracefully
     *
     * **Performance:**
     * This is a lightweight operation that queries the extension's kernel cache.
     * It's safe to call frequently.
     *
     * @param uri The URI of the resource (typically a notebook document) to get the kernel for.
     *            This should be the `uri` property from a `NotebookDocument`.
     *
     * @returns A promise that resolves to:
     *          - The {@link Kernel} instance if a kernel is active for this resource
     *          - `undefined` if no kernel is available
     *
     * @example
     * ```typescript
     * // Get kernel for active notebook
     * const notebook = vscode.window.activeNotebookEditor?.notebook;
     * if (notebook) {
     *     const kernel = await jupyterApi.kernels.getKernel(notebook.uri);
     *     if (kernel) {
     *         console.log(`Kernel language: ${kernel.language}`);
     *         console.log(`Kernel status: ${kernel.status}`);
     *
     *         // Execute code
     *         const outputs = kernel.executeCode('print("Hello")', token);
     *         for await (const output of outputs) {
     *             console.log(output);
     *         }
     *     } else {
     *         vscode.window.showInformationMessage('No kernel selected for this notebook');
     *     }
     * }
     * ```
     *
     * @example
     * ```typescript
     * // Get kernel for specific notebook file
     * const notebookUri = vscode.Uri.file('/path/to/notebook.ipynb');
     * const kernel = await jupyterApi.kernels.getKernel(notebookUri);
     *
     * if (kernel) {
     *     // Wait for kernel to be ready
     *     if (kernel.status === 'starting') {
     *         await new Promise<void>(resolve => {
     *             const disposable = kernel.onDidChangeStatus(status => {
     *                 if (status === 'idle') {
     *                     disposable.dispose();
     *                     resolve();
     *                 }
     *             });
     *         });
     *     }
     *
     *     // Now execute code
     *     if (kernel.status === 'idle') {
     *         const outputs = kernel.executeCode('x = 42', token);
     *         for await (const output of outputs) {
     *             // Process outputs...
     *         }
     *     }
     * }
     * ```
     *
     * @example
     * ```typescript
     * // Monitor kernel availability
     * async function waitForKernel(uri: vscode.Uri, timeout: number): Promise<Kernel | undefined> {
     *     const startTime = Date.now();
     *
     *     while (Date.now() - startTime < timeout) {
     *         const kernel = await jupyterApi.kernels.getKernel(uri);
     *         if (kernel && kernel.status === 'idle') {
     *             return kernel;
     *         }
     *         await new Promise(resolve => setTimeout(resolve, 500));
     *     }
     *
     *     return undefined;
     * }
     *
     * const kernel = await waitForKernel(notebook.uri, 10000);
     * if (!kernel) {
     *     vscode.window.showErrorMessage('Kernel not available within timeout');
     * }
     * ```
     */
    getKernel(uri: Uri): Thenable<Kernel | undefined>;
}
// #endregion Kernels API
