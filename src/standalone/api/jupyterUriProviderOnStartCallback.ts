// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IDisposableRegistry } from '../../platform/common/types';
import { IJupyterUriProviderRegistration } from '../../kernels/jupyter/types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IKernelProvider, isRemoteConnection } from '../../kernels/types';
import { Disposables } from '../../platform/common/utils';
import { IExportedKernelServiceFactory } from './api';
import { JupyterKernelServiceFactory } from './kernelApi';
import { JupyterUriProviderRegistration } from '../../kernels/jupyter/connection/jupyterUriProviderRegistration';

/**
 * Handles registration of 3rd party URI providers.
 */
@injectable()
export class JupyterUriProviderOnStartCallback extends Disposables implements IExtensionSyncActivationService {
    constructor(
        @inject(IJupyterUriProviderRegistration) private readonly providers: JupyterUriProviderRegistration,
        @inject(IExportedKernelServiceFactory) private readonly kernelApiFactory: JupyterKernelServiceFactory,
        @inject(IKernelProvider) private readonly kernels: IKernelProvider,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry
    ) {
        super();
        disposables.push(this);
    }
    activate(): void {
        this.kernels.onDidCreateKernel(
            async (k) => {
                if (!isRemoteConnection(k.kernelConnectionMetadata)) {
                    return;
                }
                // const providerId = this.serverIdProviderMapping.get(k.kernelConnectionMetadata.serverId);
                // if (!providerId) {
                //     return;
                // }
                k.addHook(
                    'didStart',
                    async () => {
                        // Hack, we need to load a specific provider, but for this to be possible
                        // we need to get the provider information from the serverId
                        // That depends on this large PR https://github.com/microsoft/vscode-jupyter/pull/13588
                        const jupyterProviders = await this.providers.getProviders();
                        if (jupyterProviders.length === 0) {
                            return;
                        }
                        await Promise.all(
                            jupyterProviders.map((provider) => {
                                if (!provider.onDidStartKernel) {
                                    return;
                                }
                                const service = this.kernelApiFactory.getServiceForExtension(provider.extensionId);
                                return provider.onDidStartKernel({
                                    uri: k.resourceUri,
                                    metadata: k.kernelConnectionMetadata,
                                    connection: service.wrapKernelConnection(k)
                                });
                            })
                        );
                    },
                    this,
                    this.disposables
                );
            },
            this,
            this.disposables
        );
    }
}
