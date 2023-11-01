// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CancellationError,
    CancellationToken,
    CancellationTokenSource,
    EventEmitter,
    QuickPickItem,
    Uri
} from 'vscode';
import {
    IJupyterServerUri,
    IJupyterUriProvider,
    JupyterServer,
    JupyterServerCollection,
    JupyterServerCommand,
    JupyterServerCommandProvider,
    JupyterServerProvider
} from '../../../api';
import { IJupyterServerProviderRegistry, IJupyterUriProviderRegistration } from '../types';
import { IDisposable, IDisposableRegistry } from '../../../platform/common/types';
import { inject, injectable } from 'inversify';
import { dispose, stripCodicons } from '../../../platform/common/helpers';
import { traceError } from '../../../platform/logging';
import { JVSC_EXTENSION_ID } from '../../../platform/common/constants';
import { JupyterConnection } from './jupyterConnection';
import { StopWatch } from '../../../platform/common/utils/stopWatch';
import { DisposableBase, ObservableDisposable } from '../../../platform/common/utils/lifecycle';

export class JupyterServerCollectionImpl extends ObservableDisposable implements JupyterServerCollection {
    private _commandProvider?: JupyterServerCommandProvider;
    documentation?: Uri | undefined;
    private _onDidChangeProvider = new EventEmitter<void>();
    onDidChangeProvider = this._onDidChangeProvider.event;
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
        public label: string,
        public readonly serverProvider: JupyterServerProvider
    ) {
        super();
    }
}

// Assume connections are valid only for 5 minutes,
// Ever 5 minutes we try to access the same connection, we need to validate it.
const RemoteConnectionValidityPeriod = 5 * 60_000;

class JupyterUriProviderAdaptor extends DisposableBase implements IJupyterUriProvider {
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
    getServerUriWithoutAuthInfo?(handle: string): Promise<IJupyterServerUri>;
    private commands = new Map<string, JupyterServerCommand>();
    constructor(
        private readonly provider: JupyterServerCollection,
        public readonly extensionId: string,
        private readonly jupyterConnection: JupyterConnection
    ) {
        super();
        this.id = provider.id;
        this.hookupProviders();

        // Only jupyter extension supports the `remoteHandle` API.
        if (this.provider.extensionId === JVSC_EXTENSION_ID) {
            this.getServerUriWithoutAuthInfo = this.getServerUriWithoutAuthInfoImpl.bind(this);
        }
    }
    override dispose() {
        super.dispose();
        dispose(this.providerChanges);
    }
    private hookupProviders() {
        dispose(this.providerChanges);
        if (this.provider.serverProvider?.onDidChangeServers) {
            this.provider.serverProvider.onDidChangeServers(
                () => {
                    this._servers.clear();
                    this.cachedServerUri.clear();
                    this._onDidChangeHandles.fire();
                },
                this,
                this.providerChanges
            );
        }
    }
    async getQuickPickEntryItems(
        value?: string
    ): Promise<(QuickPickItem & { default?: boolean | undefined; command: JupyterServerCommand })[]> {
        if (!this.provider.commandProvider) {
            return [];
        }
        const token = new CancellationTokenSource();
        try {
            const items =
                (await Promise.resolve(this.provider.commandProvider.provideCommands(value || '', token.token))) || [];
            if (!value) {
                this.commands.clear();
            }
            items.forEach((c) => this.commands.set(c.label, c));
            return items.map((c) => {
                return {
                    label: stripCodicons(c.label),
                    description: stripCodicons(c.description),
                    picked: c.canBeAutoSelected,
                    default: c.canBeAutoSelected,
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
        item: QuickPickItem & { command: JupyterServerCommand },
        _backEnabled: boolean
    ): Promise<string | undefined> {
        if (!this.provider.commandProvider) {
            throw new Error(`No Jupyter Server Command Provider for ${this.provider.extensionId}#${this.provider.id}`);
        }
        const token = new CancellationTokenSource();
        try {
            const command = item.command;
            if (!command) {
                throw new Error(
                    `Jupyter Server Command ${item.label} not found in Command Provider ${this.provider.extensionId}#${this.provider.id}`
                );
            }
            try {
                const result = await Promise.resolve(this.provider.commandProvider.handleCommand(command, token.token));
                if (!result) {
                    return 'back';
                }
                // A new server was returned, meaning the list of servers could have changed.
                this._servers.clear();
                return result.id;
            } catch (ex) {
                if (ex instanceof CancellationError) {
                    return;
                }
                traceError(
                    `Failed to execute Jupyter Server Command ${item.label} in Command Provider ${this.provider.extensionId}#${this.provider.id}`,
                    ex
                );
            }
        } finally {
            token.dispose();
        }
    }
    private cachedServerUri = new Map<string, { lastValidated: StopWatch; promise: Promise<IJupyterServerUri> }>();
    async getServerUri(handle: string): Promise<IJupyterServerUri> {
        let cache = this.cachedServerUri.get(handle);
        if (!cache) {
            // Nothing we can do if its invalid the first time we get it from extension.
            // Hence no need to validate it here, just return it as is
            cache = { promise: this.getServerUriImpl(handle), lastValidated: new StopWatch() };
            cache.promise.catch(() => {
                if (this.cachedServerUri.get(handle) === cache) {
                    this.cachedServerUri.delete(handle);
                }
            });
            this.cachedServerUri.set(handle, cache);
            return cache.promise;
        }

        // Validate the connection returned.
        // However if the connection was last validated 60 seconds ago, then no need to validate it again.
        if (cache.lastValidated.elapsedTime <= RemoteConnectionValidityPeriod) {
            return cache.promise;
        }
        return cache.promise.then(async (c) => {
            try {
                await this.jupyterConnection.validateRemoteUri(
                    { extensionId: this.extensionId, id: this.id, handle },
                    c,
                    true
                );
                cache!.lastValidated.reset();
                return c;
            } catch (ex) {
                // Not valid
                const currentPromise = this.cachedServerUri.get(handle);
                if (currentPromise === cache) {
                    cache = { promise: this.getServerUriImpl(handle), lastValidated: new StopWatch() };
                    this.cachedServerUri.set(handle, cache);
                    cache.promise.catch(() => {
                        if (this.cachedServerUri.get(handle) === cache) {
                            this.cachedServerUri.delete(handle);
                        }
                    });
                    return cache.promise;
                }
                if (currentPromise) {
                    return currentPromise.promise;
                }
                throw ex;
            }
        });
    }
    async getServerUriImpl(handle: string): Promise<IJupyterServerUri> {
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
                    baseUrl: info.baseUrl.toString(true),
                    displayName: server.label,
                    token: info.token || '',
                    authorizationHeader: info.headers,
                    webSocketProtocols: info.webSocketProtocols,
                    fetch: info.fetch,
                    WebSocket: info.WebSocket
                };
            }
            if (this.provider.serverProvider?.resolveJupyterServer) {
                const result = await Promise.resolve(
                    this.provider.serverProvider?.resolveJupyterServer(server, token.token)
                );
                const info = result?.connectionInformation || server.connectionInformation;
                if (!info?.baseUrl) {
                    throw new Error(
                        `Jupyter Provider ${this.id} does not implement the method resolveJupyterServer and/or baseUrl not returned`
                    );
                }
                return {
                    baseUrl: info.baseUrl.toString(true),
                    displayName: server.label,
                    token: info.token || '',
                    authorizationHeader: info.headers,
                    webSocketProtocols: info.webSocketProtocols,
                    fetch: info.fetch,
                    WebSocket: info.WebSocket
                };
            }
            throw new Error('Jupyter Provider does not implement the method resolveJupyterServer');
        } finally {
            token.dispose();
        }
    }
    async getHandles(): Promise<string[]> {
        if (this.provider.serverProvider) {
            const token = new CancellationTokenSource();
            try {
                const servers = await Promise.resolve(this.getServers(token.token));
                return (servers || []).map((s) => s.id);
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
    async getServer(handle: string, token: CancellationToken): Promise<JupyterServer> {
        const server =
            this._servers.get(handle) ||
            (await Promise.resolve(this.getServers(token)).then((servers) =>
                (servers || []).find((s) => s.id === handle)
            ));
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
        const servers = await Promise.resolve(this.provider.serverProvider.provideJupyterServers(token));
        this._servers.clear();
        (servers || []).forEach((s) => this._servers.set(s.id, s));
        return servers;
    }
}

@injectable()
export class JupyterServerProviderRegistry extends DisposableBase implements IJupyterServerProviderRegistry {
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
        private readonly jupyterUriProviderRegistration: IJupyterUriProviderRegistration,
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection
    ) {
        super();
        disposables.push(this);
    }
    createJupyterServerCollection(
        extensionId: string,
        id: string,
        label: string,
        serverProvider: JupyterServerProvider
    ): JupyterServerCollection {
        const extId = `${extensionId}#${id}`;
        if (this._collections.has(extId)) {
            // When testing we might have a duplicate as we call the registration API in ctor of a test.
            if (extensionId !== JVSC_EXTENSION_ID) {
                throw new Error(`Jupyter Server Provider with id ${extId} already exists`);
            }
        }
        const collection = new JupyterServerCollectionImpl(extensionId, id, label, serverProvider);
        this._collections.set(extId, collection);
        const adapter = new JupyterUriProviderAdaptor(collection, extensionId, this.jupyterConnection);
        const uriRegistration = this._register(
            this.jupyterUriProviderRegistration.registerProvider(adapter, extensionId)
        );
        this._onDidChangeCollections.fire({ added: [collection], removed: [] });
        this._register(
            collection.onDidDispose(() => {
                this._collections.delete(extId);
                adapter?.dispose();
                uriRegistration?.dispose();
                this._onDidChangeCollections.fire({ removed: [collection], added: [] });
            }, this)
        );

        return collection;
    }
}
