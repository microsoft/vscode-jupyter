// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationTokenSource, EventEmitter, QuickPickItem, Uri, commands } from 'vscode';
import {
    IJupyterServerUri,
    IJupyterUriProvider,
    JupyterServer,
    JupyterServerCollection,
    JupyterServerCommandProvider,
    JupyterServerProvider
} from '../../../api';
import { Disposables } from '../../../platform/common/utils';
import { IJupyterServerProviderRegistry, IJupyterUriProviderRegistration } from '../types';
import { IDisposable, IDisposableRegistry } from '../../../platform/common/types';
import { inject, injectable } from 'inversify';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { traceError } from '../../../platform/logging';
import { JVSC_EXTENSION_ID } from '../../../platform/common/constants';

class JupyterServerCollectionImpl extends Disposables implements JupyterServerCollection {
    private _serverProvider?: JupyterServerProvider;
    private _commandProvider?: JupyterServerCommandProvider;
    documentation?: Uri | undefined;
    private _onDidChangeProvider = new EventEmitter<void>();
    onDidChangeProvider = this._onDidChangeProvider.event;
    set serverProvider(value: JupyterServerProvider | undefined) {
        this._serverProvider = value;
        this._onDidChangeProvider.fire();
    }
    get serverProvider(): JupyterServerProvider | undefined {
        return this._serverProvider;
    }
    set commandProvider(value: JupyterServerCommandProvider | undefined) {
        this._commandProvider = value;
        this._onDidChangeProvider.fire();
    }
    get commandProvider(): JupyterServerCommandProvider | undefined {
        return this._commandProvider;
    }

    constructor(
        public readonly extensionId: string,
        public readonly id: string,
        public label: string
    ) {
        super();
    }
}

class JupyterUriProviderAdaptor extends Disposables implements IJupyterUriProvider {
    readonly id: string;
    public get displayName() {
        return this.provider.label;
    }
    public get documentation() {
        return this.provider.documentation;
    }
    detail?: string | undefined;
    private _onDidChangeHandles = new EventEmitter<void>();
    onDidChangeHandles = this._onDidChangeHandles.event;
    private providerChanges: IDisposable[] = [];
    removeHandle?(handle: string): Promise<void>;
    getServerUriWithoutAuthInfo?(handle: string): Promise<IJupyterServerUri>;
    constructor(private readonly provider: JupyterServerCollection) {
        super();
        this.id = provider.id;
        this.hookupProviders();

        // Only jupyter extension supports the `remoteHandle` API.
        if (this.provider.extensionId === JVSC_EXTENSION_ID) {
            this.removeHandle = this.removeHandleImpl.bind(this);
            this.getServerUriWithoutAuthInfo = this.getServerUriWithoutAuthInfoImpl.bind(this);
        }
    }
    override dispose() {
        super.dispose();
        disposeAllDisposables(this.providerChanges);
    }
    private hookupProviders() {
        disposeAllDisposables(this.providerChanges);
        if (this.provider.serverProvider) {
            this.provider.serverProvider.onDidChangeServers(
                () => this._onDidChangeHandles.fire(),
                this,
                this.providerChanges
            );
        }
    }
    async getQuickPickEntryItems(): Promise<(QuickPickItem & { default?: boolean | undefined })[]> {
        if (!this.provider.commandProvider) {
            throw new Error(`No Jupyter Server Command Provider for ${this.provider.extensionId}#${this.provider.id}`);
        }
        const token = new CancellationTokenSource();
        try {
            const items = await this.provider.commandProvider.getCommands(token.token);
            const selectedCommand = items.find((c) => c.title === this.provider.commandProvider?.selected?.title);
            return items.map((c) => {
                return {
                    label: c.title,
                    tooltip: c.tooltip,
                    default: c === selectedCommand
                };
            });
        } catch (ex) {
            traceError(
                `Failed to get Jupyter Server Commands from ${this.provider.extensionId}#${this.provider.id}`,
                ex
            );
            return [];
        } finally {
            token.dispose();
        }
    }
    async handleQuickPick(item: QuickPickItem, _backEnabled: boolean): Promise<string | undefined> {
        if (!this.provider.commandProvider) {
            throw new Error(`No Jupyter Server Command Provider for ${this.provider.extensionId}#${this.provider.id}`);
        }
        const token = new CancellationTokenSource();
        try {
            const items = await this.provider.commandProvider.getCommands(token.token);
            const command = items.find((c) => c.title === item.label);
            if (!command) {
                throw new Error(
                    `Jupyter Server Command ${item.label} not found in Command Provider ${this.provider.extensionId}#${this.provider.id}`
                );
            }
            try {
                const result: JupyterServer | 'back' | undefined = await commands.executeCommand(
                    command.command,
                    ...(command.arguments || [])
                );
                if (result === 'back') {
                    return result;
                }
                return result?.id;
            } catch (ex) {
                traceError(
                    `Failed to execute Jupyter Server Command ${item.label} in Command Provider ${this.provider.extensionId}#${this.provider.id}`,
                    ex
                );
            }
        } finally {
            token.dispose();
        }
    }
    async getServerUri(handle: string): Promise<IJupyterServerUri> {
        if (!this.provider.serverProvider) {
            throw new Error(`No Jupyter Server Provider for ${this.provider.extensionId}#${this.provider.id}`);
        }
        const token = new CancellationTokenSource();
        try {
            const servers = await this.provider.serverProvider.getJupyterServers(token.token);
            const server = servers.find((s) => s.id === handle);
            if (!server) {
                throw new Error(
                    `Jupyter Server ${handle} not found in Provider ${this.provider.extensionId}#${this.provider.id}`
                );
            }
            const info = await server.resolveConnectionInformation(token.token);
            return {
                baseUrl: info.baseUrl.toString(),
                displayName: server.label,
                token: info.token,
                authorizationHeader: info.authorizationHeader,
                mappedRemoteNotebookDir: info.mappedRemoteNotebookDir?.toString(),
                webSocketProtocols: info.webSocketProtocols
            };
        } finally {
            token.dispose();
        }
    }
    async getHandles(): Promise<string[]> {
        if (this.provider.serverProvider) {
            const token = new CancellationTokenSource();
            try {
                const servers = await this.provider.serverProvider.getJupyterServers(token.token);
                return servers.map((s) => s.id);
            } catch (ex) {
                traceError(`Failed to get Jupyter Servers from ${this.provider.extensionId}#${this.provider.id}`, ex);
                return [];
            } finally {
                token.dispose();
            }
        } else {
            return [];
        }
    }
    async getServerUriWithoutAuthInfoImpl(handle: string): Promise<IJupyterServerUri> {
        if (!this.provider.serverProvider) {
            throw new Error(`No Jupyter Server Provider for ${this.provider.extensionId}#${this.provider.id}`);
        }
        const token = new CancellationTokenSource();
        try {
            const servers = await this.provider.serverProvider.getJupyterServers(token.token);
            const server = servers.find((s) => s.id === handle);
            if (!server) {
                throw new Error(
                    `Jupyter Server ${handle} not found in Provider ${this.provider.extensionId}#${this.provider.id}`
                );
            }
            return {
                baseUrl: '',
                token: '',
                displayName: server.label
            };
        } finally {
            token.dispose();
        }
    }
    async removeHandleImpl(handle: string): Promise<void> {
        if (!this.provider.serverProvider) {
            throw new Error(`No Jupyter Server Provider for ${this.provider.extensionId}#${this.provider.id}`);
        }
        const token = new CancellationTokenSource();
        try {
            const servers = await this.provider.serverProvider.getJupyterServers(token.token);
            const server = servers.find((s) => s.id === handle);
            if (server?.remove) {
                await server.remove();
            }
        } finally {
            token.dispose();
        }
    }
}

@injectable()
export class JupyterServerProviderRegistry extends Disposables implements IJupyterServerProviderRegistry {
    private readonly _onDidChangeProviders = new EventEmitter<void>();
    public get onDidChangeProviders() {
        return this._onDidChangeProviders.event;
    }
    private readonly _serverProviders = new Map<string, JupyterServerCollection>();
    public get providers(): readonly JupyterServerCollection[] {
        return Array.from(this._serverProviders.values());
    }
    constructor(
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IJupyterUriProviderRegistration)
        private readonly jupyterUriProviderRegistration: IJupyterUriProviderRegistration
    ) {
        super();
        disposables.push(this);
    }
    createJupyterServerCollection(extensionId: string, id: string, label: string): JupyterServerCollection {
        const extId = `${extensionId}#${id}`;
        if (this._serverProviders.has(extId)) {
            throw new Error(`Jupyter Server Provider with id ${extId} already exists`);
        }
        const serverProvider = new JupyterServerCollectionImpl(extensionId, id, label);
        this._serverProviders.set(extId, serverProvider);
        let uriRegistration: IDisposable | undefined;
        serverProvider.onDidChangeProvider(() => {
            if (serverProvider.serverProvider) {
                uriRegistration = this.jupyterUriProviderRegistration.registerProvider(
                    new JupyterUriProviderAdaptor(serverProvider),
                    extensionId
                );
                this.disposables.push(uriRegistration);
                this._onDidChangeProviders.fire();
            } else {
                uriRegistration?.dispose();
            }
        });

        serverProvider.onDidDispose(
            () => {
                uriRegistration?.dispose();
                this._serverProviders.delete(extId);
                this._onDidChangeProviders.fire();
            },
            this,
            this.disposables
        );

        return serverProvider;
    }
}
