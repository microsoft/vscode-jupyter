// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import {
    IJupyterServerUriStorage,
    IJupyterUriProvider,
    IJupyterUriProviderRegistration
} from '../../kernels/jupyter/types';
import { isLocalConnection } from '../../kernels/types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IDisposableRegistry } from '../../platform/common/types';
import { noop } from '../../platform/common/utils/misc';
import { traceError, traceWarning } from '../../platform/logging';
import { IControllerRegistration } from './types';

/**
 * Tracks 3rd party IJupyterUriProviders and requests URIs from their handles. We store URI information in our
 * JupyterServerUriStorage, not the handles.
 */
@injectable()
export class RemoteKernelControllerWatcher implements IExtensionSyncActivationService {
    private readonly handledProviders = new WeakSet<IJupyterUriProvider>();
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IJupyterUriProviderRegistration) private readonly providerRegistry: IJupyterUriProviderRegistration,
        @inject(IJupyterServerUriStorage) private readonly uriStorage: IJupyterServerUriStorage,
        @inject(IControllerRegistration) private readonly controllers: IControllerRegistration
    ) {}
    activate(): void {
        this.providerRegistry.onDidChangeProviders(this.addProviderHandlers, this, this.disposables);
        this.addProviderHandlers().catch(noop);
    }
    private async addProviderHandlers() {
        const providers = await this.providerRegistry.getProviders();
        providers.forEach((provider) => {
            // clear out any old handlers
            this.onProviderHandlesChanged(provider).catch(noop);

            if (provider.onDidChangeHandles && !this.handledProviders.has(provider)) {
                provider.onDidChangeHandles(this.onProviderHandlesChanged.bind(this, provider), this, this.disposables);
            }
        });
    }
    private async onProviderHandlesChanged(provider: IJupyterUriProvider) {
        if (!provider.getHandles) {
            return;
        }
        const [handles, uris] = await Promise.all([provider.getHandles(), this.uriStorage.getAll()]);
        const serverJupyterProviderMap = new Map<string, { uri: string; providerId: string; handle: string }>();
        const registeredHandles: string[] = [];
        await Promise.all(
            uris.map(async (item) => {
                // Check if this url is associated with a provider.
                if (item.provider.id !== provider.id) {
                    return;
                }
                serverJupyterProviderMap.set(item.serverId, {
                    uri: item.uri,
                    providerId: item.provider.id,
                    handle: item.provider.handle
                });

                if (handles.includes(item.provider.handle)) {
                    registeredHandles.push(item.provider.handle);
                }

                // Check if this handle is still valid.
                // If not then remove this uri from the list.
                if (!handles.includes(item.provider.handle)) {
                    // Looks like the 3rd party provider has updated its handles and this server is no longer available.
                    await this.uriStorage.remove(item.serverId);
                } else if (!item.isValidated) {
                    await this.uriStorage.add(item.provider).catch(noop);
                }
            })
        );

        // find unregistered handles
        const unregisteredHandles = handles.filter((h) => !registeredHandles.includes(h));
        await Promise.all(
            unregisteredHandles.map(async (handle) => {
                try {
                    await this.uriStorage.add({ id: provider.id, handle });
                } catch (ex) {
                    traceError(`Failed to get server uri and add it to uri Storage for handle ${handle}`, ex);
                }
            })
        );

        const controllers = this.controllers.registered;
        controllers.forEach((controller) => {
            const connection = controller.connection;
            if (isLocalConnection(connection)) {
                return;
            }
            const info = serverJupyterProviderMap.get(connection.serverId);
            if (info && !handles.includes(info.handle)) {
                // Looks like the 3rd party provider has updated its handles and this server is no longer available.
                traceWarning(
                    `Deleting controller ${controller.id} as it is associated with a server Id that has been removed`
                );
                controller.dispose();
            }
        });
    }
}
