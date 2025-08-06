// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import {
    CancellationError,
    CancellationToken,
    Event,
    EventEmitter,
    Uri,
    commands
} from 'vscode';
import {
    IJupyterServerProviderRegistry
} from '../../kernels/jupyter/types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import {
    JVSC_EXTENSION_ID
} from '../../platform/common/constants';
import {
    IDisposable,
    IDisposableRegistry
} from '../../platform/common/types';
import { DataScience } from '../../platform/common/utils/localize';
import { logger } from '../../platform/logging';
import {
    JupyterServer,
    JupyterServerCommand,
    JupyterServerCommandProvider,
    JupyterServerProvider
} from '../../api';
import { DisposableBase } from '../../platform/common/utils/lifecycle';
import { IPersistentServerStorage } from '../../kernels/jupyter/launcher/persistentServerStorage';
import { IPersistentServerManager } from '../../kernels/jupyter/launcher/persistentServerManager.node';

/**
 * Provides auto-launched persistent Jupyter servers to the VSCode UI (kernel picker).
 * Works like UserJupyterServerUrlProvider but we launch the servers ourselves
 * and automatically capture the URL/token instead of requiring user input.
 */
@injectable()
export class PersistentServerUIProvider
    extends DisposableBase
    implements IExtensionSyncActivationService, IDisposable, JupyterServerProvider, JupyterServerCommandProvider
{
    public readonly extensionId: string = JVSC_EXTENSION_ID;
    readonly documentation = Uri.parse('https://aka.ms/vscode-jupyter-persistent-servers');
    readonly displayName: string = DataScience.PersistentJupyterServerProviderDisplayName;
    readonly detail: string = DataScience.PersistentJupyterServerProviderDetail;
    
    private _onDidChangeHandles = this._register(new EventEmitter<void>());
    onDidChangeHandles: Event<void> = this._onDidChangeHandles.event;
    
    private _onDidChangeServers = this._register(new EventEmitter<void>());
    onDidChangeServers = this._onDidChangeServers.event;

    public readonly id: string = 'persistent-jupyter-servers';

    constructor(
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IJupyterServerProviderRegistry)
        private readonly jupyterServerProviderRegistry: IJupyterServerProviderRegistry,
        @inject(IPersistentServerStorage) private readonly persistentServerStorage: IPersistentServerStorage,
        @inject(IPersistentServerManager) private readonly persistentServerManager: IPersistentServerManager
    ) {
        super();
        disposables.push(this);
    }

    activate() {
        // Register as a server provider in the UI
        const collection = this._register(
            this.jupyterServerProviderRegistry.createJupyterServerCollection(
                JVSC_EXTENSION_ID,
                this.id,
                this.displayName,
                this
            )
        );
        collection.commandProvider = this;
        collection.documentation = this.documentation;
        
        // Connect UI change events
        this._register(this.onDidChangeHandles(() => this._onDidChangeServers.fire(), this));
        
        // Listen for server storage changes to update UI
        this._register(this.persistentServerStorage.onDidChange(() => {
            this._onDidChangeHandles.fire();
        }));

        // Register VS Code commands for server management
        this._register(
            commands.registerCommand('jupyter.managePersistentServers', async () => {
                await this.persistentServerManager.showServerManagementUI();
            })
        );
    }

    async provideCommands(_value: string, _token: CancellationToken): Promise<JupyterServerCommand[]> {
        return [
            { 
                label: DataScience.startNewPersistentServer, 
                canBeAutoSelected: false 
            },
            { 
                label: DataScience.managePersistentServers, 
                canBeAutoSelected: false 
            }
        ];
    }

    async provideJupyterServers(_token: CancellationToken): Promise<JupyterServer[]> {
        // Show all persistent servers that are currently running
        const servers = this.persistentServerStorage.all;
        return servers
            .filter(server => server.launchedByExtension) // Only show servers launched by us
            .map(server => ({
                id: server.serverId,
                label: server.displayName || `Persistent Server (${new URL(server.url).port})`
            }));
    }

    public async resolveJupyterServer(server: JupyterServer, _token: CancellationToken) {
        // Find the server info for connection details
        const serverInfo = this.persistentServerStorage.all.find(s => s.serverId === server.id);
        if (!serverInfo) {
            throw new Error(`Persistent server ${server.id} not found`);
        }

        return {
            ...server,
            connectionInformation: {
                id: server.id,
                label: server.label,
                baseUrl: Uri.parse(serverInfo.url),
                token: serverInfo.token,
                headers: {},
                mappedRemoteNotebookDir: serverInfo.workingDirectory 
                    ? Uri.file(serverInfo.workingDirectory)
                    : undefined
            }
        };
    }

    public async handleCommand(
        command: JupyterServerCommand,
        _token: CancellationToken
    ): Promise<JupyterServer | undefined> {
        try {
            if (command.label === DataScience.startNewPersistentServer) {
                // Launch a new persistent server (like user adding a server, but we do it automatically)
                return await this.launchNewPersistentServer();
            } else if (command.label === DataScience.managePersistentServers) {
                await this.persistentServerManager.showServerManagementUI();
                return undefined;
            }
            return undefined;
        } catch (ex) {
            if (ex instanceof CancellationError) {
                throw ex;
            }
            logger.error(`Failed to handle persistent server command`, ex);
            return undefined;
        }
    }

    private async launchNewPersistentServer(): Promise<JupyterServer | undefined> {
        try {
            // This is where we'd actually launch a new Jupyter server
            // and capture its URL/token automatically (instead of asking user to type it)
            
            // For now, delegate to the server manager
            await this.persistentServerManager.showServerManagementUI();
            
            // The server manager should handle the actual launching
            // and the storage will be updated, triggering our onDidChange event
            return undefined;
        } catch (error) {
            logger.error('Failed to launch new persistent server', error);
            throw error;
        }
    }

    public async removeJupyterServer(server: JupyterServer): Promise<void> {
        // Stop and remove the persistent server
        await this.persistentServerManager.stopServer(server.id);
        this._onDidChangeHandles.fire();
    }
}