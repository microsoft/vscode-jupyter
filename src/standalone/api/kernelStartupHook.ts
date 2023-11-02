// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IKernel, IKernelProvider, IKernelSession, isRemoteConnection } from '../../kernels/types';
import { IDisposableRegistry, IExtensions } from '../../platform/common/types';
import { IJupyterServerProviderRegistry } from '../../kernels/jupyter/types';
import { traceError, traceVerbose, traceWarning } from '../../platform/logging';
import { CancellationError, CancellationToken } from 'vscode';
import { generateIdFromRemoteProvider } from '../../kernels/jupyter/jupyterUtils';
import { JVSC_EXTENSION_ID, Telemetry } from '../../platform/common/constants';
import { sendTelemetryEvent } from '../../telemetry';
import { raceCancellation } from '../../platform/common/cancellation';
import { KernelProgressReporter } from '../../platform/progress/kernelProgressReporter';
import { DataScience } from '../../platform/common/utils/localize';

@injectable()
export class KernelStartupHooksForJupyterProviders implements IExtensionSyncActivationService {
    constructor(
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IExtensions)
        private readonly extensions: IExtensions,
        @inject(IJupyterServerProviderRegistry)
        private readonly serverProviders: IJupyterServerProviderRegistry
    ) {}
    activate(): void {
        this.kernelProvider.onDidCreateKernel((kernel) => this.addOnStartHooks(kernel), this, this.disposables);
    }

    private addOnStartHooks(kernel: IKernel) {
        const connection = kernel.kernelConnectionMetadata;
        // Startup hooks only apply to remote kernels specs
        if (
            !isRemoteConnection(connection) ||
            connection.serverProviderHandle.extensionId === JVSC_EXTENSION_ID ||
            connection.kind !== 'startUsingRemoteKernelSpec'
        ) {
            return;
        }
        kernel.addHook(
            'didStart',
            async (session: IKernelSession | undefined, token: CancellationToken) => {
                if (!session) {
                    return;
                }
                const serverProvider = this.serverProviders.jupyterCollections.find(
                    (provider) =>
                        provider.extensionId === connection.serverProviderHandle.extensionId &&
                        provider.id === connection.serverProviderHandle.id
                );
                if (!serverProvider) {
                    // This is not possible
                    traceError(
                        `Unable to find Jupyter Server Provider for ${connection.id} with provider ${connection.serverProviderHandle.extensionId}$${connection.serverProviderHandle.id}`
                    );
                    return;
                }
                if (!serverProvider.serverProvider?.onStartKernel) {
                    // No hooks
                    return;
                }
                const servers = await Promise.resolve(serverProvider.serverProvider.provideJupyterServers(token));
                const server = servers?.find((s) => s.id === connection.serverProviderHandle.handle);
                if (!server) {
                    // This is not possible
                    traceError(
                        `Unable to find servers for kernel ${connection.id} with provider ${connection.serverProviderHandle.extensionId}$${connection.serverProviderHandle.id}`
                    );
                    return;
                }

                const onStartKernel = serverProvider.serverProvider.onStartKernel.bind(serverProvider.serverProvider);
                const time = Date.now();
                try {
                    const extension = this.extensions.getExtension(serverProvider.extensionId);
                    const message = DataScience.runningKernelStartupHooksFor(
                        extension?.packageJSON?.displayName || serverProvider.extensionId
                    );
                    await KernelProgressReporter.wrapAndReportProgress(kernel.resourceUri, message, () =>
                        raceCancellation(token, onStartKernel({ uri: kernel.uri, server, session }, token))
                    );
                } catch (ex) {
                    if (ex instanceof CancellationError) {
                        return;
                    }
                    // We do not care about the errors from 3rd party extensions.
                    traceWarning(
                        `Startup hook for ${connection.serverProviderHandle.extensionId}$${connection.serverProviderHandle.id} failed`,
                        ex
                    );
                } finally {
                    const duration = Date.now() - time;
                    sendTelemetryEvent(
                        Telemetry.JupyterKernelStartupHook,
                        { duration },
                        {
                            extensionId: connection.serverProviderHandle.extensionId,
                            providerId: connection.serverProviderHandle.id
                        }
                    );
                    if (duration > 1_000) {
                        traceVerbose(
                            `Kernel Startup hook for ${generateIdFromRemoteProvider(
                                connection.serverProviderHandle
                            )} took ${duration}ms`
                        );
                    }
                }
            },
            this,
            this.disposables
        );
    }
}
