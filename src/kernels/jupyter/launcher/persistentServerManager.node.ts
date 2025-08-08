// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Disposable, Uri, window } from 'vscode';
import { logger } from '../../../platform/logging';
import { IPersistentServerStorage, IPersistentServerInfo } from './persistentServerStorage';
import { PersistentJupyterServerProvider } from './persistentJupyterServerProvider.node';
import { l10n } from 'vscode';
import { DisposableBase } from '../../../platform/common/utils/lifecycle';

/**
 * Interface for managing persistent Jupyter servers at a high level.
 */
export interface IPersistentServerManager extends Disposable {
    /**
     * Get all persistent servers currently managed by the extension.
     */
    getAllServers(): IPersistentServerInfo[];

    /**
     * Stop and remove a persistent server by its ID.
     */
    stopServer(serverId: string): Promise<void>;

    /**
     * Clean up orphaned or expired servers.
     */
    cleanupServers(): Promise<void>;

    /**
     * Get the server info for a specific workspace if it exists.
     */
    getServerForWorkspace(workspaceUri: Uri): IPersistentServerInfo | undefined;

    /**
     * Show a UI to manage persistent servers.
     */
    showServerManagementUI(): Promise<void>;

    /**
     * Scan for running persistent servers on startup and reconnect to them.
     */
    scanAndReconnectServers(): Promise<void>;
}

/**
 * Manages persistent Jupyter servers - provides high-level operations
 * for starting, stopping, and managing server lifecycle.
 */
@injectable()
export class PersistentServerManager extends DisposableBase implements IPersistentServerManager {
    constructor(
        @inject(IPersistentServerStorage) protected readonly persistentServerStorage: IPersistentServerStorage,
        @inject(PersistentJupyterServerProvider) private readonly serverProvider: PersistentJupyterServerProvider
    ) {
        super();
    }

    public getAllServers(): IPersistentServerInfo[] {
        return this.serverProvider.getAllPersistentServers();
    }

    public async stopServer(serverId: string): Promise<void> {
        const serverInfo = this.persistentServerStorage.get(serverId);
        if (!serverInfo) {
            logger.warn(`Cannot stop server ${serverId} - not found in storage`);
            return;
        }

        await this.serverProvider.stopPersistentServer(serverId);
        logger.info(`Persistent server ${serverId} stopped`);
    }

    public async cleanupServers(): Promise<void> {
        const allServers = this.persistentServerStorage.all;
        const serversToCleanup: string[] = [];

        // Find servers that might be expired or orphaned
        const currentTime = Date.now();
        const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
        const healthCheckAge = 1 * 60 * 60 * 1000; // Only health check servers older than 1 hour

        for (const server of allServers) {
            // Clean up very old servers (older than 7 days)
            if (server.launchedByExtension && currentTime - server.time > maxAge) {
                logger.debug(`Server ${server.serverId} is older than 7 days, marking for cleanup`);
                serversToCleanup.push(server.serverId);
                continue;
            }

            // Only perform health checks on servers that are at least 1 hour old
            // This prevents cleanup of recently started servers during tests
            if (server.launchedByExtension && currentTime - server.time > healthCheckAge) {
                const isAlive = await this.checkServerHealth(server);
                if (!isAlive) {
                    logger.debug(`Server ${server.serverId} is not responding, marking for cleanup`);
                    serversToCleanup.push(server.serverId);
                }
            }
        }

        // Remove dead/old servers
        for (const serverId of serversToCleanup) {
            await this.persistentServerStorage.remove(serverId);
            logger.info(`Cleaned up dead/old persistent server: ${serverId}`);
        }

        if (serversToCleanup.length > 0) {
            logger.info(`Cleaned up ${serversToCleanup.length} persistent servers`);
        }
    }

    /**
     * Check if a persistent server is still alive by making a simple HTTP request.
     */
    protected async checkServerHealth(server: IPersistentServerInfo): Promise<boolean> {
        try {
            // Simple health check - try to fetch the API endpoint
            const url = new URL('/api', server.url);
            const response = await fetch(url.toString(), {
                method: 'GET',
                headers: server.token ? { 'Authorization': `Token ${server.token}` } : {},
                signal: AbortSignal.timeout(5000) // 5 second timeout
            });
            return response.ok;
        } catch (error) {
            logger.debug(`Health check failed for server ${server.serverId}: ${error}`);
            return false;
        }
    }

    public getServerForWorkspace(workspaceUri: Uri): IPersistentServerInfo | undefined {
        const servers = this.persistentServerStorage.all;
        return servers.find(
            (server) => server.workingDirectory === workspaceUri.fsPath && server.launchedByExtension
        );
    }

    public async showServerManagementUI(): Promise<void> {
        const servers = this.getAllServers();

        if (servers.length === 0) {
            await window.showInformationMessage(l10n.t('No persistent Jupyter servers are currently running.'));
            return;
        }

        // Create quick pick items for each server
        const serverItems = servers.map((server) => ({
            label: server.displayName,
            description: server.workingDirectory,
            detail: `URL: ${server.url} | Started: ${new Date(server.time).toLocaleString()}`,
            server: server
        }));

        // Add management options
        const managementItems = [
            {
                label: '$(trash) Clean up old servers',
                description: 'Remove servers older than 7 days',
                detail: 'Clean up servers that are no longer needed',
                action: 'cleanup'
            },
            {
                label: '$(refresh) Refresh server list',
                description: 'Update the server list',
                detail: 'Refresh the list of persistent servers',
                action: 'refresh'
            }
        ];

        const allItems = [...serverItems, { label: '', kind: -1 } as any, ...managementItems];

        const selectedItem = await window.showQuickPick(allItems, {
            title: l10n.t('Persistent Jupyter Servers'),
            placeHolder: l10n.t('Select a server to manage or choose an action'),
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (!selectedItem) {
            return;
        }

        // Handle management actions
        if ('action' in selectedItem) {
            switch (selectedItem.action) {
                case 'cleanup':
                    await this.cleanupServers();
                    await window.showInformationMessage(l10n.t('Server cleanup completed.'));
                    break;
                case 'refresh':
                    // Refresh is handled by re-calling this method
                    await this.showServerManagementUI();
                    break;
            }
            return;
        }

        // Handle server selection
        if ('server' in selectedItem) {
            await this.showServerActions(selectedItem.server);
        }
    }

    private async showServerActions(server: IPersistentServerInfo): Promise<void> {
        const actions = [
            {
                label: '$(stop) Stop Server',
                description: 'Stop and remove this persistent server',
                action: 'stop'
            },
            {
                label: '$(info) Show Details',
                description: 'Display detailed information about this server',
                action: 'details'
            },
            {
                label: '$(link-external) Open in Browser',
                description: 'Open the server URL in your default browser',
                action: 'open'
            }
        ];

        const selectedAction = await window.showQuickPick(actions, {
            title: l10n.t('Server Actions: {0}', server.displayName),
            placeHolder: l10n.t('Choose an action for this server')
        });

        if (!selectedAction) {
            return;
        }

        switch (selectedAction.action) {
            case 'stop':
                const confirmStop = await window.showWarningMessage(
                    l10n.t('Are you sure you want to stop the server "{0}"?', server.displayName),
                    { modal: true },
                    l10n.t('Yes, Stop Server')
                );
                
                if (confirmStop) {
                    await this.stopServer(server.serverId);
                    await window.showInformationMessage(l10n.t('Server "{0}" has been stopped.', server.displayName));
                }
                break;

            case 'details':
                const details = [
                    `**Server ID:** ${server.serverId}`,
                    `**Display Name:** ${server.displayName}`,
                    `**URL:** ${server.url}`,
                    `**Working Directory:** ${server.workingDirectory}`,
                    `**Started:** ${new Date(server.time).toLocaleString()}`,
                    `**Launched by Extension:** ${server.launchedByExtension ? 'Yes' : 'No'}`
                ].join('\n\n');

                await window.showInformationMessage(details, { modal: true });
                break;

            case 'open':
                // Open the server URL in the default browser
                const vscode = await import('vscode');
                await vscode.env.openExternal(vscode.Uri.parse(server.url));
                break;
        }
    }

    public async scanAndReconnectServers(): Promise<void> {
        logger.info('Scanning for running persistent servers on startup...');
        
        try {
            // First cleanup any dead or expired servers
            await this.cleanupServers();
            
            // Get all remaining servers (these should be live)
            const allServers = this.persistentServerStorage.all;
            const liveServers = allServers.filter(server => server.launchedByExtension);
            
            if (liveServers.length > 0) {
                logger.info(`Found ${liveServers.length} persistent servers to reconnect to`);
                
                // Trigger kernel finder refresh to pick up the persistent servers
                // The RemoteKernelFinderController is already listening to storage changes,
                // so the servers should automatically be picked up via the existing mechanism
            } else {
                logger.info('No persistent servers found to reconnect to');
            }
        } catch (error) {
            logger.error('Error during persistent server startup scan', error);
        }
    }
}

export const IPersistentServerManager = Symbol('IPersistentServerManager');