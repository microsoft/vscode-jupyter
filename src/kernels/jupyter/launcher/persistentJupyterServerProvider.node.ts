// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, optional } from 'inversify';
import { Uri } from 'vscode';
import type { ServerConnection } from '@jupyterlab/services';
import { logger } from '../../../platform/logging';
import { DataScience } from '../../../platform/common/utils/localize';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { JupyterInstallError } from '../../../platform/errors/jupyterInstallError';
import { GetServerOptions, IJupyterConnection } from '../../types';
import { IJupyterServerHelper, IJupyterServerProvider } from '../types';
import { NotSupportedInWebError } from '../../../platform/errors/notSupportedInWebError';
import { getFilePath } from '../../../platform/common/platform/fs-paths';
import { Cancellation, isCancellationError } from '../../../platform/common/cancellation';
import { getPythonEnvDisplayName } from '../../../platform/interpreter/helpers';
import { IPersistentServerStorage, IPersistentServerInfo } from './persistentServerStorage';
import { generateUuid } from '../../../platform/common/uuid';
import { DisposableBase } from '../../../platform/common/utils/lifecycle';

/**
 * Jupyter server provider that launches persistent servers that outlast VS Code sessions.
 * These servers can be reconnected to after the extension restarts.
 */
@injectable()
export class PersistentJupyterServerProvider extends DisposableBase implements IJupyterServerProvider {
    private serverConnections = new Map<string, Promise<IJupyterConnection>>();

    constructor(
        @inject(IJupyterServerHelper)
        @optional()
        private readonly jupyterServerHelper: IJupyterServerHelper | undefined,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IPersistentServerStorage) private readonly persistentServerStorage: IPersistentServerStorage
    ) {
        super();
    }

    public async getOrStartServer(options: GetServerOptions): Promise<IJupyterConnection> {
        const workingDirectory = options.resource || Uri.file(process.cwd());
        const serverId = this.getServerIdForWorkspace(workingDirectory);

        // Check if we already have a connection promise for this server
        if (this.serverConnections.has(serverId)) {
            const existingConnection = this.serverConnections.get(serverId)!;
            try {
                return await existingConnection;
            } catch (error) {
                // Connection failed, remove from cache and try again
                this.serverConnections.delete(serverId);
            }
        }

        // Try to reconnect to an existing persistent server first
        const existingServer = this.findExistingServerForWorkspace(workingDirectory);
        if (existingServer) {
            logger.debug(`Attempting to reconnect to persistent server: ${existingServer.serverId}`);
            const connectionPromise = this.reconnectToServer(existingServer);
            this.serverConnections.set(serverId, connectionPromise);

            try {
                return await connectionPromise;
            } catch (error) {
                logger.warn(`Failed to reconnect to persistent server ${existingServer.serverId}:`, error);
                // Remove the failed server from storage and fall through to create a new one
                await this.persistentServerStorage.remove(existingServer.serverId);
                this.serverConnections.delete(serverId);
            }
        }

        // No existing server or reconnection failed, start a new persistent server
        logger.debug(`Starting new persistent server for workspace: ${workingDirectory.fsPath}`);
        const connectionPromise = this.startNewPersistentServer(workingDirectory, options);
        this.serverConnections.set(serverId, connectionPromise);

        return connectionPromise;
    }

    private getServerIdForWorkspace(workingDirectory: Uri): string {
        // Use the workspace path as the key for identifying servers
        return `persistent-${workingDirectory.fsPath}`;
    }

    private findExistingServerForWorkspace(workingDirectory: Uri): IPersistentServerInfo | undefined {
        const servers = this.persistentServerStorage.all;
        return servers.find(
            (server) => server.workingDirectory === workingDirectory.fsPath && server.launchedByExtension
        );
    }

    private async reconnectToServer(serverInfo: IPersistentServerInfo): Promise<IJupyterConnection> {
        // Validate that the server is still running by trying to connect
        const baseUrl = serverInfo.url.split('?')[0]; // Remove token from URL
        const serverProviderHandle = {
            id: 'persistent-server-provider',
            handle: serverInfo.serverId,
            extensionId: 'ms-toolsai.jupyter'
        };

        const connection: IJupyterConnection = {
            baseUrl,
            token: serverInfo.token,
            hostName: new URL(serverInfo.url).hostname,
            displayName: serverInfo.displayName,
            providerId: 'persistent-server-provider',
            serverProviderHandle,
            dispose: () => {
                // Don't dispose the server - it should persist
                logger.debug(
                    `Connection to persistent server ${serverInfo.serverId} disposed, but server continues running`
                );
            },
            rootDirectory: Uri.file(serverInfo.workingDirectory),
            getAuthHeader: () => ({ Authorization: `token ${serverInfo.token}` }),
            settings: {
                baseUrl,
                token: serverInfo.token,
                websocket: null,
                init: {},
                fetch: global.fetch?.bind(global) || require('node-fetch')
            } as unknown as ServerConnection.ISettings
        };

        // TODO: Add validation that the server is actually accessible
        // For now, we'll trust that the stored server info is valid

        // Update the last used time
        await this.persistentServerStorage.update(serverInfo.serverId, { time: Date.now() });

        return connection;
    }

    private async startNewPersistentServer(
        workingDirectory: Uri,
        options: GetServerOptions
    ): Promise<IJupyterConnection> {
        const jupyterServerHelper = this.jupyterServerHelper;
        if (!jupyterServerHelper) {
            throw new NotSupportedInWebError();
        }

        // Check if Jupyter is usable
        const usable = await this.checkUsable();
        if (!usable) {
            logger.trace('Server not usable (should ask for install now)');
            throw new JupyterInstallError(
                DataScience.jupyterNotSupported(await jupyterServerHelper.getJupyterServerError())
            );
        }

        try {
            logger.debug(`Starting new persistent Jupyter server for: ${workingDirectory.fsPath}`);

            // Start the server with persistent arguments
            const connection = await this.startPersistentJupyterServer(workingDirectory, options);

            // Store the server information for future reconnection
            const serverId = generateUuid();
            const serverInfo: IPersistentServerInfo = {
                serverId,
                displayName: `Persistent Server (${workingDirectory.fsPath})`,
                url: `${connection.baseUrl}/?token=${connection.token}`,
                token: connection.token,
                workingDirectory: workingDirectory.fsPath,
                launchedByExtension: true,
                time: Date.now()
            };

            await this.persistentServerStorage.add(serverInfo);

            // Wrap the connection to prevent disposal of the persistent server
            const persistentConnection: IJupyterConnection = {
                ...connection,
                dispose: () => {
                    logger.debug(`Connection to persistent server ${serverId} disposed, but server continues running`);
                    // Don't actually dispose the server
                }
            };

            logger.info(`Successfully started persistent Jupyter server: ${serverId}`);
            return persistentConnection;
        } catch (error) {
            if (options.token?.isCancellationRequested && isCancellationError(error)) {
                throw error;
            }

            await jupyterServerHelper.refreshCommands();
            throw error;
        }
    }

    private async startPersistentJupyterServer(
        workingDirectory: Uri,
        options: GetServerOptions
    ): Promise<IJupyterConnection> {
        const jupyterServerHelper = this.jupyterServerHelper!;

        // Start the server with custom options for persistence
        const connection = await jupyterServerHelper.startServer(workingDirectory, options.token);
        Cancellation.throwIfCanceled(options.token);

        return connection;
    }

    private async checkUsable(): Promise<boolean> {
        try {
            if (this.jupyterServerHelper) {
                const usableInterpreter = await this.jupyterServerHelper.getUsableJupyterPython();
                return usableInterpreter ? true : false;
            } else {
                return true;
            }
        } catch (e) {
            const activeInterpreter = await this.interpreterService.getActiveInterpreter(undefined);
            // Can't find a usable interpreter, show the error.
            if (activeInterpreter) {
                const displayName = getPythonEnvDisplayName(activeInterpreter) || getFilePath(activeInterpreter.uri);
                throw new Error(DataScience.jupyterNotSupportedBecauseOfEnvironment(displayName, e.toString()));
            } else {
                throw new JupyterInstallError(
                    DataScience.jupyterNotSupported(
                        this.jupyterServerHelper ? await this.jupyterServerHelper.getJupyterServerError() : 'Error'
                    )
                );
            }
        }
    }

    /**
     * Get all persistent servers managed by this provider.
     */
    public getAllPersistentServers(): IPersistentServerInfo[] {
        return this.persistentServerStorage.all.filter((server) => server.launchedByExtension);
    }

    /**
     * Stop and remove a persistent server.
     */
    public async stopPersistentServer(serverId: string): Promise<void> {
        const serverInfo = this.persistentServerStorage.get(serverId);
        if (!serverInfo) {
            logger.warn(`Persistent server ${serverId} not found in storage`);
            return;
        }

        // TODO: Add logic to actually stop the server process if we have the PID
        // For now, just remove from storage
        await this.persistentServerStorage.remove(serverId);

        // Remove from connection cache
        const workspaceServerId = this.getServerIdForWorkspace(Uri.file(serverInfo.workingDirectory));
        this.serverConnections.delete(workspaceServerId);

        logger.info(`Persistent server ${serverId} stopped and removed`);
    }
}
