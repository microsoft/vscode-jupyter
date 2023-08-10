// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IKernel, IKernelProvider, IKernelSession, isRemoteConnection } from '../../kernels/types';
import { IDisposableRegistry } from '../../platform/common/types';
import { IJupyterUriProviderRegistration } from '../../kernels/jupyter/types';
import { traceError, traceWarning } from '../../platform/logging';
import { CancellationTokenSource } from 'vscode';
import { generateIdFromRemoteProvider } from '../../kernels/jupyter/jupyterUtils';
import { JVSC_EXTENSION_ID } from '../../platform/common/constants';

@injectable()
export class KernelStartupHooksForJupyterProviders implements IExtensionSyncActivationService {
    constructor(
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IJupyterUriProviderRegistration)
        private readonly jupyterUrisRegistration: IJupyterUriProviderRegistration
    ) {}
    activate(): void {
        this.kernelProvider.onDidCreateKernel((kernel) => this.addOnStartHooks(kernel), this, this.disposables);
    }

    private addOnStartHooks(kernel: IKernel) {
        const connection = kernel.kernelConnectionMetadata;
        // Startup hooks only apply to remote kernels
        if (!isRemoteConnection(connection) || connection.serverProviderHandle.extensionId === JVSC_EXTENSION_ID) {
            return;
        }
        kernel.addHook('didStart', async (session: IKernelSession | undefined) => {
            if (!session) {
                return;
            }
            // This is not possible
            const provider = this.jupyterUrisRegistration.providers.find(
                (p) =>
                    p.extensionId === connection.serverProviderHandle.extensionId &&
                    p.id === connection.serverProviderHandle.id
            );
            if (!provider) {
                traceError(
                    `Unable to find kernel ${connection.id} with provider ${connection.serverProviderHandle.extensionId}$${connection.serverProviderHandle.id}`
                );
                return;
            }
            const servers = provider.servers;
            if (!servers) {
                traceWarning(
                    `Unable to find servers for kernel ${connection.id} with provider ${connection.serverProviderHandle.extensionId}$${connection.serverProviderHandle.id}`
                );
                return;
            }
            const server = servers.find((s) => s.id === connection.serverProviderHandle.handle);
            if (!server) {
                traceWarning(
                    `Unable to find server for kernel ${connection.id} with provider ${connection.serverProviderHandle.extensionId}$${connection.serverProviderHandle.id} and handle ${connection.serverProviderHandle.id}}`
                );
                return;
            }
            if (!server.onStartKernel) {
                return;
            }
            const token = new CancellationTokenSource();
            try {
                await server.onStartKernel(kernel.uri, session, token.token);
            } catch (ex) {
                traceWarning(
                    `Startup hook for ${generateIdFromRemoteProvider(connection.serverProviderHandle)} failed`,
                    ex
                );
            } finally {
                token.dispose();
            }
        });
    }
}
