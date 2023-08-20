// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import {
    IJupyterServerUriStorage,
    IInternalJupyterUriProvider,
    IJupyterUriProviderRegistration,
    IJupyterServerProviderRegistry
} from '../../kernels/jupyter/types';
import { isLocalConnection } from '../../kernels/types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IDisposableRegistry } from '../../platform/common/types';
import { noop } from '../../platform/common/utils/misc';
import { traceWarning } from '../../platform/logging';
import { IControllerRegistration } from './types';
import { JupyterServerCollection, JupyterServerProvider } from '../../api';
import { CancellationTokenSource } from 'vscode';
import { swallowExceptions } from '../../platform/common/utils/decorators';

/**
 * Tracks 3rd party IJupyterUriProviders and requests URIs from their handles. We store URI information in our
 * JupyterServerUriStorage, not the handles.
 */
@injectable()
export class RemoteKernelControllerWatcher implements IExtensionSyncActivationService {
    private readonly handledProviders = new WeakSet<IInternalJupyterUriProvider>();
    private readonly handledCollections = new WeakSet<JupyterServerCollection>();
    private readonly handledServerProviderChanges = new WeakSet<JupyterServerProvider>();
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IJupyterUriProviderRegistration) private readonly providerRegistry: IJupyterUriProviderRegistration,
        @inject(IJupyterServerUriStorage) private readonly uriStorage: IJupyterServerUriStorage,
        @inject(IControllerRegistration) private readonly controllers: IControllerRegistration,
        @inject(IJupyterServerProviderRegistry) private readonly serverProviderRegistry: IJupyterServerProviderRegistry
    ) {}
    activate(): void {
        this.providerRegistry.onDidChangeProviders(this.addProviderHandlers, this, this.disposables);
        this.addProviderHandlers();
        this.serverProviderRegistry.jupyterCollections.forEach((collection) =>
            this.checkJupyterServerProviderHandlers(collection)
        );
        this.serverProviderRegistry.onDidChangeCollections(
            ({ added, removed }) => {
                added.forEach((collection) => this.checkJupyterServerProviderHandlers(collection));

                removed.forEach((collection) =>
                    this.removeControllersBelongingToDisposedProvider(collection.extensionId, collection.id)
                );
            },
            this,
            this.disposables
        );
    }
    @swallowExceptions('Failed to check what servers were shutdown in a Jupyter Collection in Controller Watcher')
    private async checkJupyterServerProviderHandlers(collection: JupyterServerCollection) {
        if (this.handledCollections.has(collection)) {
            collection.onDidChangeProvider(
                () =>
                    collection.serverProvider
                        ? this.checkExpiredServersInJupyterCollection(collection, collection.serverProvider).catch(noop)
                        : undefined,
                this,
                this.disposables
            );
        }
        if (collection.serverProvider) {
            await this.checkExpiredServersInJupyterCollection(collection, collection.serverProvider);
        }
    }
    @swallowExceptions('Failed to check what servers were shutdown in Controller Watcher')
    private async checkExpiredServersInJupyterCollection(
        collection: JupyterServerCollection,
        serverProvider: JupyterServerProvider
    ) {
        if (!this.handledServerProviderChanges.has(serverProvider) && serverProvider.onDidChangeServers) {
            const serverProviderChangeHandler = serverProvider.onDidChangeServers(
                () => {
                    if (collection.serverProvider === serverProvider) {
                        this.checkExpiredServersInJupyterCollection(collection, serverProvider).catch(noop);
                    } else {
                        // Server Provider has changed and this is no longer valid.
                        serverProviderChangeHandler.dispose();
                        this.handledServerProviderChanges.delete(serverProvider);
                    }
                },
                this,
                this.disposables
            );
        }
        const tokenSource = new CancellationTokenSource();
        this.disposables.push(tokenSource);
        try {
            const currentServers = await serverProvider.provideJupyterServers(tokenSource.token);
            await this.removeControllersAndUriStorageBelongingToInvalidServers(
                collection.extensionId,
                collection.id,
                currentServers.map((s) => s.id)
            );
        } finally {
            tokenSource.dispose();
        }
    }
    private addProviderHandlers() {
        this.providerRegistry.providers.forEach((provider) => {
            if (this.handledProviders.has(provider)) {
                return;
            }
            this.handledProviders.add(provider);
            // clear out any old handlers
            this.onProviderHandlesChanged(provider).catch(noop);
            if (provider.onDidChangeHandles) {
                provider.onDidChangeHandles(() => this.onProviderHandlesChanged(provider), this, this.disposables);
            }
        });
    }
    private async onProviderHandlesChanged(provider: IInternalJupyterUriProvider) {
        if (!provider.getHandles) {
            return;
        }
        const handles = await provider.getHandles();
        await this.removeControllersAndUriStorageBelongingToInvalidServers(provider.extensionId, provider.id, handles);
    }

    private async removeControllersAndUriStorageBelongingToInvalidServers(
        extensionId: string,
        providerId: string,
        validServerIds: string[]
    ) {
        const uris = await this.uriStorage.getAll();
        await Promise.all(
            uris
                .filter((item) => item.provider.extensionId === extensionId && item.provider.id === providerId)
                .map(async (item) => {
                    // Check if this handle is still valid.
                    // If not then remove this uri from the list.
                    if (!validServerIds.includes(item.provider.handle)) {
                        // Looks like the 3rd party provider has updated its handles and this server is no longer available.
                        await this.uriStorage.remove(item.provider);
                    }
                })
        );

        this.controllers.registered.forEach((controller) => {
            const connection = controller.connection;
            if (
                isLocalConnection(connection) ||
                connection.serverProviderHandle.extensionId !== extensionId ||
                connection.serverProviderHandle.id !== providerId
            ) {
                return;
            }
            if (!validServerIds.includes(connection.serverProviderHandle.handle)) {
                // Looks like the 3rd party provider has updated its handles and this server is no longer available.
                traceWarning(
                    `Deleting controller ${controller.id} as it is associated with a server Id that has been removed`
                );
                controller.dispose();
            }
        });
    }
    private removeControllersBelongingToDisposedProvider(extensionId: string, providerId: string) {
        this.controllers.registered.forEach((controller) => {
            const connection = controller.connection;
            if (
                isLocalConnection(connection) ||
                connection.serverProviderHandle.extensionId !== extensionId ||
                connection.serverProviderHandle.id !== providerId
            ) {
                return;
            }
            // Looks like the 3rd party provider has updated its handles and this server is no longer available.
            traceWarning(
                `Deleting controller ${controller.id} as it is associated with a Provider Id that has been removed`
            );
            controller.dispose();
        });
    }
}
