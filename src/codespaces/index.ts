// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { EventEmitter, Uri, QuickPickItem, CancellationError, extensions } from 'vscode';
import {
    IJupyterUriProvider,
    JupyterServerProvider,
    JupyterServerCommandProvider,
    IJupyterServerUri,
    JupyterServer,
    JupyterServerCommand,
    JupyterServerCollection
} from '../api';
import { IJupyterServerProviderRegistry } from '../kernels/jupyter/types';
import { raceCancellationError } from '../platform/common/cancellation';
import { JVSC_EXTENSION_ID } from '../platform/common/constants';
import { stripCodicons } from '../platform/common/helpers';
import { IDisposableRegistry } from '../platform/common/types';
import { ObservableDisposable, DisposableBase } from '../platform/common/utils/lifecycle';
import { ServiceContainer } from '../platform/ioc/container';
import { noop } from '../platform/common/utils/misc';

export function jupyterServerUriToCollection(provider: IJupyterUriProvider): {
    serverProvider: JupyterServerProvider;
    commandProvider?: JupyterServerCommandProvider;
} {
    const serverMap = new Map<string, { serverUri: IJupyterServerUri; server: JupyterServer }>();
    const serverUriToServer = (handle: string, serverUri: IJupyterServerUri): JupyterServer => {
        if (!serverMap.has(handle)) {
            const server: JupyterServer = {
                id: handle,
                label: serverUri.displayName,
                connectionInformation: {
                    baseUrl: Uri.parse(serverUri.baseUrl),
                    token: serverUri.token,
                    fetch: serverUri.fetch,
                    headers: serverUri.authorizationHeader,
                    WebSocket: serverUri.WebSocket,
                    webSocketProtocols: serverUri.webSocketProtocols
                }
            };
            serverMap.set(handle, { serverUri, server });
        }
        return serverMap.get(handle)!.server;
    };
    const onDidChangeServers = new EventEmitter<void>();

    const serverProvider: JupyterServerProvider = {
        async provideJupyterServers(token) {
            const handles = provider.getHandles ? await raceCancellationError(token, provider.getHandles()) : [];
            if (!handles || handles.length === 0) {
                return [];
            }
            return raceCancellationError(
                token,
                Promise.all(handles.map((h) => provider.getServerUri(h).then((s) => serverUriToServer(h, s))))
            );
        },
        resolveJupyterServer(server, _token) {
            return server;
        },
        onDidChangeServers: onDidChangeServers.event
    };

    if (!provider.handleQuickPick || !provider.getQuickPickEntryItems) {
        return { serverProvider };
    }

    const quickPickMap = new Map<string, QuickPickItem & { default?: boolean | undefined }>();
    const commandProvider: JupyterServerCommandProvider = {
        async handleCommand(command, token) {
            const quickPickItem = quickPickMap.get(command.label);
            if (!quickPickItem || !provider.handleQuickPick) {
                return;
            }
            const handle = await raceCancellationError(token, provider.handleQuickPick(quickPickItem, true));
            if (handle === 'back') {
                return;
            }
            if (!handle) {
                throw new CancellationError();
            }
            const server = await provider.getServerUri(handle);
            return serverUriToServer(handle, server);
        },
        async provideCommands(_value, token) {
            if (!provider.getQuickPickEntryItems) {
                return [];
            }
            const items = await raceCancellationError(token, Promise.resolve(provider.getQuickPickEntryItems()));
            return items.map((item) => {
                const command: JupyterServerCommand = {
                    label: stripCodicons(item.label),
                    canBeAutoSelected: item.default,
                    description: stripCodicons(item.description)
                };
                quickPickMap.set(command.label, item);
                return command;
            });
        }
    };

    return { serverProvider, commandProvider };
}

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
    constructor() {
        super();
        ServiceContainer.instance.get<IDisposableRegistry>(IDisposableRegistry).push(this);
    }
    public async activateThirdPartyExtensionAndFindCollection(
        extensionId: string,
        id: string
    ): Promise<JupyterServerCollection | undefined> {
        await this.loadExtension(extensionId, id).catch(noop);
        return this.jupyterCollections.find((c) => c.extensionId === extensionId && c.id === id);
    }
    private async loadExtension(extensionId: string, providerId: string) {
        if (extensionId === JVSC_EXTENSION_ID) {
            return;
        }
        const ext = extensions.getExtension(extensionId);
        if (!ext) {
            throw new Error(`Extension '${extensionId}' that provides Jupyter Server '${providerId}' not found`);
        }
        if (!ext.isActive) {
            await ext.activate().then(noop, noop);
        }
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
        this._onDidChangeCollections.fire({ added: [collection], removed: [] });
        this._register(
            collection.onDidDispose(() => {
                this._collections.delete(extId);
                this._onDidChangeCollections.fire({ removed: [collection], added: [] });
            }, this)
        );

        return collection;
    }
}
