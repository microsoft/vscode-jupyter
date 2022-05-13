// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { computeServerId, extractJupyterServerHandleAndId } from '../../kernels/jupyter/jupyterUtils';
import {
    IJupyterServerUriStorage,
    IJupyterUriProvider,
    IJupyterUriProviderRegistration
} from '../../kernels/jupyter/types';
import { isLocalConnection } from '../../kernels/types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IDisposableRegistry } from '../../platform/common/types';
import { INotebookControllerManager } from '../types';

@injectable()
export class RemoteKernelControllerWatcher implements IExtensionSyncActivationService {
    private readonly handledProviders = new WeakSet<IJupyterUriProvider>();
    constructor(
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IJupyterUriProviderRegistration) private readonly providerRegistry: IJupyterUriProviderRegistration,
        @inject(IJupyterServerUriStorage) private readonly uriStorage: IJupyterServerUriStorage,
        @inject(INotebookControllerManager) private readonly controllers: INotebookControllerManager
    ) {}
    activate(): void {
        this.providerRegistry.onProvidersChanged(this.addProviderHandlers, this, this.disposables);
    }
    private async addProviderHandlers() {
        const providers = await this.providerRegistry.getProviders();
        providers.forEach((provider) => {
            if (provider.onDidChangeHandles && !this.handledProviders.has(provider)) {
                provider.onDidChangeHandles(this.onProviderHandlesChanged.bind(this, provider), this, this.disposables);
            }
        });
    }
    private async onProviderHandlesChanged(provider: IJupyterUriProvider) {
        if (!provider.getHandles) {
            return;
        }
        const [handles, uris] = await Promise.all([provider.getHandles(), this.uriStorage.getSavedUriList()]);
        const serverJupyterProviderMap = new Map<string, { uri: string; providerId: string; handle: string }>();
        await Promise.all(
            uris.map(async (item) => {
                // Check if this url is associated with a provider.
                const info = extractJupyterServerHandleAndId(item.uri);
                if (!info || info.id !== provider.id) {
                    return;
                }
                serverJupyterProviderMap.set(computeServerId(item.uri), {
                    uri: item.uri,
                    providerId: info.id,
                    handle: info.handle
                });

                // Check if this handle is still valid.
                // If not then remove this uri from the list.
                if (!handles.includes(info.handle)) {
                    // Looks like the 3rd party provider has updated its handles and this server is no longer available.
                    await this.uriStorage.removeUri(item.uri);
                }
            })
        );
        const controllers = this.controllers.getRegisteredNotebookControllers();
        controllers.forEach((controller) => {
            const info = serverJupyterProviderMap.get(controller.connection.id);
            if (!isLocalConnection(controller.connection) || !info) {
                return;
            }
            if (!info) {
                return;
            }
            if (!handles.includes(info.handle)) {
                // Looks like the 3rd party provider has updated its handles and this server is no longer available.
                controller.dispose();
            }
        });
    }
}
