// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken, CancellationTokenSource, EventEmitter, QuickPickItem, Uri } from 'vscode';
import {
    IJupyterServerUri,
    IJupyterUriProvider,
    JupyterServer,
    JupyterServerCollection,
    JupyterServerCommand,
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

export class JupyterServerCollectionImpl extends Disposables implements JupyterServerCollection {
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
    _servers = new Map<string, JupyterServer>();
    get servers(): readonly JupyterServer[] {
        return Array.from(this._servers.values());
    }
    detail?: string | undefined;
    private _onDidChangeHandles = new EventEmitter<void>();
    onDidChangeHandles = this._onDidChangeHandles.event;
    private providerChanges: IDisposable[] = [];
    removeHandle?(handle: string): Promise<void>;
    getServerUriWithoutAuthInfo?(handle: string): Promise<IJupyterServerUri>;
    private commands = new Map<string, JupyterServerCommand>();
    constructor(
        private readonly provider: JupyterServerCollection,
        public readonly extensionId: string
    ) {
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
        if (this.provider.serverProvider?.onDidChangeServers) {
            this.provider.serverProvider.onDidChangeServers(
                () => {
                    this._servers.clear();
                    this._onDidChangeHandles.fire();
                },
                this,
                this.providerChanges
            );
        }
    }
    async getQuickPickEntryItems(
        value?: string
    ): Promise<(QuickPickItem & { default?: boolean | undefined; command?: JupyterServerCommand })[]> {
        if (!this.provider.commandProvider) {
            return [];
        }
        const token = new CancellationTokenSource();
        try {
            value = this.provider.extensionId === JVSC_EXTENSION_ID ? value : undefined;
            let items: JupyterServerCommand[] = [];
            if (this.provider.extensionId === JVSC_EXTENSION_ID) {
                items = await this.provider.commandProvider.provideCommands(value || '', token.token);
            } else if (Array.isArray(this.provider.commandProvider.commands)) {
                items = this.provider.commandProvider.commands;
            } else if (this.provider.commandProvider.getCommands) {
                items = await (
                    this.provider.commandProvider.provideCommands || this.provider.commandProvider.getCommands
                ).bind(this.provider.commandProvider)('', token.token);
            }
            if (this.provider.extensionId === JVSC_EXTENSION_ID) {
                if (!value) {
                    this.commands.clear();
                }
                items.forEach((c) => this.commands.set(c.title, c));
            }
            return items.map((c) => {
                return {
                    label: c.title,
                    detail: c.detail,
                    tooltip: c.tooltip,
                    command: c
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
    async handleQuickPick(
        item: QuickPickItem & { command?: JupyterServerCommand },
        _backEnabled: boolean
    ): Promise<string | undefined> {
        if (!this.provider.commandProvider) {
            throw new Error(`No Jupyter Server Command Provider for ${this.provider.extensionId}#${this.provider.id}`);
        }
        const token = new CancellationTokenSource();
        try {
            let command: JupyterServerCommand | undefined =
                'command' in item ? (item.command as JupyterServerCommand) : undefined;
            if (!command) {
                const items = await (
                    this.provider.commandProvider.provideCommands || this.provider.commandProvider.getCommands
                )('', token.token);
                command = items.find((c) => c.title === item.label) || this.commands.get(item.label);
            }
            if (!command) {
                throw new Error(
                    `Jupyter Server Command ${item.label} not found in Command Provider ${this.provider.extensionId}#${this.provider.id}`
                );
            }
            try {
                const result = await this.provider.commandProvider.handleCommand(command, token.token);
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
        const token = new CancellationTokenSource();
        if (!this.provider.serverProvider) {
            throw new Error(
                `Server Provider not initialized, Extension: ${this.extensionId}:${this.id}, Server ${handle}`
            );
        }
        try {
            const server = await this.getServer(handle, token.token);
            if (server.connectionInformation) {
                const info = server.connectionInformation;
                return {
                    baseUrl: info.baseUrl.toString(),
                    displayName: server.label,
                    token: info.token || '',
                    authorizationHeader: info.headers,
                    mappedRemoteNotebookDir: info.mappedRemoteNotebookDir?.toString(),
                    webSocketProtocols: info.webSocketProtocols
                };
            }
            if (this.provider.serverProvider?.resolveJupyterServer) {
                const { connectionInformation: info } = await this.provider.serverProvider?.resolveJupyterServer(
                    server,
                    token.token
                );
                return {
                    baseUrl: info.baseUrl.toString(),
                    displayName: server.label,
                    token: info.token || '',
                    authorizationHeader: info.headers,
                    mappedRemoteNotebookDir: info.mappedRemoteNotebookDir?.toString(),
                    webSocketProtocols: info.webSocketProtocols
                };
            }
            if (!this.provider.serverProvider?.resolveConnectionInformation) {
                throw new Error('Jupyter Provider does not implement the method resolveJupyterServer');
            }
            const info = await this.provider.serverProvider?.resolveConnectionInformation(server, token.token);
            return {
                baseUrl: info.baseUrl.toString(),
                displayName: server.label,
                token: info.token || '',
                authorizationHeader: info.headers,
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
                const servers = await this.getServers(token.token);
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
        const token = new CancellationTokenSource();
        try {
            const server = await this.getServer(handle, token.token);
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
        const token = new CancellationTokenSource();
        if (!this.provider.removeJupyterServer) {
            traceError(`Cannot remote server with id ${handle} as Provider does not support the 'remove' method.`);
            return;
        }
        try {
            const server = await this.getServer(handle, token.token);
            await this.provider.removeJupyterServer(server);
        } catch {
            //
        } finally {
            token.dispose();
        }
    }
    async getServer(handle: string, token: CancellationToken): Promise<JupyterServer> {
        const server =
            this._servers.get(handle) ||
            (await this.getServers(token).then((servers) => servers.find((s) => s.id === handle)));
        if (server) {
            return server;
        }
        throw new Error(
            `Jupyter Server ${handle} not found in Provider ${this.provider.extensionId}#${this.provider.id}`
        );
    }
    async getServers(token: CancellationToken) {
        // Return the cache, this cache is cleared when the provider notifies of changes.
        if (this._servers.size) {
            return Array.from(this._servers.values());
        }
        if (!this.provider.serverProvider) {
            throw new Error(`No Jupyter Server Provider for ${this.provider.extensionId}#${this.provider.id}`);
        }
        const servers = await (
            this.provider.serverProvider.provideJupyterServers || this.provider.serverProvider.getJupyterServers
        ).bind(this.provider.serverProvider)(token);
        this._servers.clear();
        servers.forEach((s) => this._servers.set(s.id, s));
        return servers;
    }
}

@injectable()
export class JupyterServerProviderRegistry extends Disposables implements IJupyterServerProviderRegistry {
    private readonly _onDidChangeCollections = new EventEmitter<{
        added: JupyterServerCollection[];
        removed: JupyterServerCollection[];
    }>();
    public get onDidChangeCollections() {
        return this._onDidChangeCollections.event;
    }
    private readonly _collections = new Map<string, JupyterServerCollection>();
    public get jupyterCollections(): readonly JupyterServerCollection[] {
        return Array.from(this._collections.values());
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
        if (this._collections.has(extId)) {
            // When testing we might have a duplicate as we call the registration API in ctor of a test.
            if (extensionId !== JVSC_EXTENSION_ID) {
                throw new Error(`Jupyter Server Provider with id ${extId} already exists`);
            }
        }
        const collection = new JupyterServerCollectionImpl(extensionId, id, label);
        this._collections.set(extId, collection);
        let uriRegistration: IDisposable | undefined;
        let adapter: JupyterUriProviderAdaptor | undefined;
        collection.onDidChangeProvider(
            () => {
                if (collection.serverProvider) {
                    adapter?.dispose();
                    uriRegistration?.dispose();
                    adapter = new JupyterUriProviderAdaptor(collection, extensionId);
                    uriRegistration = this.jupyterUriProviderRegistration.registerProvider(adapter, extensionId);
                    this.disposables.push(uriRegistration);
                    this._onDidChangeCollections.fire({ added: [collection], removed: [] });
                }
            },
            this,
            this.disposables
        );

        collection.onDidDispose(
            () => {
                adapter?.dispose();
                uriRegistration?.dispose();
                this._collections.delete(extId);
                this._onDidChangeCollections.fire({ removed: [collection], added: [] });
            },
            this,
            this.disposables
        );

        return collection;
    }
}
