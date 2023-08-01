// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import {
    IJupyterServerUriStorage,
    IInternalJupyterUriProvider,
    IJupyterUriProviderRegistration
} from '../../kernels/jupyter/types';
import { isLocalConnection } from '../../kernels/types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IDisposableRegistry } from '../../platform/common/types';
import { noop } from '../../platform/common/utils/misc';
import { traceWarning } from '../../platform/logging';
import { IControllerRegistration } from './types';
import { generateIdFromRemoteProvider } from '../../kernels/jupyter/jupyterUtils';

/**
 * Tracks 3rd party IJupyterUriProviders and requests URIs from their handles. We store URI information in our
 * JupyterServerUriStorage, not the handles.
 */
@injectable()
export class RemoteKernelControllerWatcher implements IExtensionSyncActivationService {
    private readonly handledProviders = new WeakSet<IInternalJupyterUriProvider>();
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IJupyterUriProviderRegistration) private readonly providerRegistry: IJupyterUriProviderRegistration,
        @inject(IJupyterServerUriStorage) private readonly uriStorage: IJupyterServerUriStorage,
        @inject(IControllerRegistration) private readonly controllers: IControllerRegistration
    ) {}
    activate(): void {
        this.providerRegistry.onDidChangeProviders(this.addProviderHandlers, this, this.disposables);
        this.addProviderHandlers();
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
        const [handles, uris] = await Promise.all([provider.getHandles(), this.uriStorage.getAll()]);
        const serverJupyterProviderMap = new Map<string, { providerId: string; handle: string }>();
        await Promise.all(
            uris
                .filter(
                    (item) => item.provider.extensionId === provider.extensionId && item.provider.id === provider.id
                )
                .map(async (item) => {
                    serverJupyterProviderMap.set(generateIdFromRemoteProvider(item.provider), {
                        providerId: item.provider.id,
                        handle: item.provider.handle
                    });

                    // Check if this handle is still valid.
                    // If not then remove this uri from the list.
                    if (!handles.includes(item.provider.handle)) {
                        // Looks like the 3rd party provider has updated its handles and this server is no longer available.
                        await this.uriStorage.remove(item.provider);
                    }
                })
        );

        this.controllers.registered.forEach((controller) => {
            const connection = controller.connection;
            if (isLocalConnection(connection)) {
                return;
            }
            if (
                !handles.includes(connection.serverProviderHandle.handle) &&
                connection.serverProviderHandle.id === provider.id
            ) {
                // Looks like the 3rd party provider has updated its handles and this server is no longer available.
                traceWarning(
                    `Deleting controller ${controller.id} as it is associated with a server Id that has been removed`
                );
                controller.dispose();
            }
        });
    }
}
