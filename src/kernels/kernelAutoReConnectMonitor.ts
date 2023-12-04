// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Kernel } from '@jupyterlab/services';
import { inject, injectable } from 'inversify';
import {
    CancellationTokenSource,
    Disposable,
    NotebookCell,
    NotebookCellExecutionState,
    notebooks,
    ProgressLocation,
    window
} from 'vscode';
import { IExtensionSyncActivationService } from '../platform/activation/types';
import { IDisposable, IDisposableRegistry } from '../platform/common/types';
import { createDeferred } from '../platform/common/utils/async';
import { isJupyterNotebook } from '../platform/common/utils';
import { DataScience } from '../platform/common/utils/localize';
import { noop } from '../platform/common/utils/misc';
import { Telemetry } from '../telemetry';
import { endCellAndDisplayErrorsInCell } from './execution/helpers';
import { getDisplayNameOrNameOfKernelConnection } from './helpers';
import { sendKernelTelemetryEvent } from './telemetry/sendKernelTelemetryEvent';
import {
    IKernel,
    IKernelProvider,
    isLocalConnection,
    isRemoteConnection,
    RemoteKernelConnectionMetadata
} from './types';
import { IJupyterServerProviderRegistry, IJupyterServerUriStorage } from './jupyter/types';

/**
 * In the case of Jupyter kernels, when a kernel dies Jupyter will automatically restart that kernel.
 * In such a case we need to display a little progress indicator so user is aware of the fact that the kernel is restarting.
 */
@injectable()
export class KernelAutoReconnectMonitor implements IExtensionSyncActivationService {
    private kernelsStartedSuccessfully = new WeakSet<IKernel>();
    private kernelConnectionToKernelMapping = new WeakMap<Kernel.IKernelConnection, IKernel>();
    private kernelsRestarting = new WeakSet<IKernel>();
    private kernelReconnectProgress = new WeakMap<IKernel, IDisposable>();
    private lastExecutedCellPerKernel = new WeakMap<IKernel, NotebookCell | undefined>();

    constructor(
        @inject(IDisposableRegistry) private disposableRegistry: IDisposableRegistry,
        @inject(IKernelProvider) private kernelProvider: IKernelProvider,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(IJupyterServerProviderRegistry)
        private readonly jupyterUriProviderRegistration: IJupyterServerProviderRegistry
    ) {}
    public activate(): void {
        this.kernelProvider.onDidStartKernel(this.onDidStartKernel, this, this.disposableRegistry);
        this.disposableRegistry.push(
            this.kernelProvider.onDidDisposeKernel((kernel) => {
                this.kernelReconnectProgress.get(kernel)?.dispose();
                this.kernelReconnectProgress.delete(kernel);
            }, this)
        );
        this.disposableRegistry.push(
            this.kernelProvider.onDidRestartKernel((kernel) => {
                this.kernelReconnectProgress.get(kernel)?.dispose();
                this.kernelReconnectProgress.delete(kernel);
            }, this)
        );
        this.disposableRegistry.push(
            notebooks.onDidChangeNotebookCellExecutionState((e) => {
                if (!isJupyterNotebook(e.cell.notebook)) {
                    return;
                }
                if (e.state !== NotebookCellExecutionState.Idle) {
                    return;
                }
                const kernel = this.kernelProvider.get(e.cell.notebook);
                if (!kernel || this.lastExecutedCellPerKernel.get(kernel) !== e.cell) {
                    return;
                }
                // Ok, the cell has completed.
                this.lastExecutedCellPerKernel.delete(kernel);
            })
        );
    }
    private onDidStartKernel(kernel: IKernel) {
        if (!this.kernelsStartedSuccessfully.has(kernel)) {
            this.kernelProvider
                .getKernelExecution(kernel)
                .onPreExecute(
                    (cell) => this.lastExecutedCellPerKernel.set(kernel, cell),
                    this,
                    this.disposableRegistry
                );

            if (!kernel.session?.kernel) {
                return;
            }
            this.kernelsStartedSuccessfully.add(kernel);
            this.kernelConnectionToKernelMapping.set(kernel.session.kernel, kernel);
            kernel.session?.kernel?.connectionStatusChanged.connect(this.onKernelStatusChanged, this);
            kernel.onDisposed(
                () => {
                    this.kernelReconnectProgress.get(kernel)?.dispose();
                    this.kernelReconnectProgress.delete(kernel);
                },
                this,
                this.disposableRegistry
            );
            kernel.addHook(
                'willRestart',
                async () => {
                    this.kernelReconnectProgress.get(kernel)?.dispose();
                    this.kernelReconnectProgress.delete(kernel);
                    this.kernelsRestarting.add(kernel);
                },
                this,
                this.disposableRegistry
            );
            kernel.onRestarted(() => this.kernelsRestarting.delete(kernel), this, this.disposableRegistry);
        }
    }
    private onKernelStatusChanged(connection: Kernel.IKernelConnection, connectionStatus: Kernel.ConnectionStatus) {
        const kernel = this.kernelConnectionToKernelMapping.get(connection);
        if (!kernel) {
            return;
        }
        if (this.kernelsRestarting.has(kernel)) {
            return;
        }
        switch (connectionStatus) {
            case 'connected': {
                this.kernelReconnectProgress.get(kernel)?.dispose();
                this.kernelReconnectProgress.delete(kernel);
                return;
            }
            case 'disconnected': {
                if (this.kernelReconnectProgress.has(kernel)) {
                    this.kernelReconnectProgress.get(kernel)?.dispose();
                    this.kernelReconnectProgress.delete(kernel);
                    this.onKernelDisconnected(kernel)?.catch(noop);
                }
                return;
            }
            case 'connecting':
                if (!this.kernelReconnectProgress.has(kernel)) {
                    this.onKernelConnecting(kernel)?.catch(noop);
                }
                return;
            default:
                return;
        }
    }
    private async onKernelConnecting(kernel: IKernel) {
        const deferred = createDeferred<void>();
        const disposable = new Disposable(() => deferred.resolve());
        this.kernelReconnectProgress.set(kernel, disposable);

        if (isRemoteConnection(kernel.kernelConnectionMetadata)) {
            const handled = await this.handleRemoteServerShutdown(kernel, kernel.kernelConnectionMetadata);

            if (handled) {
                return;
            }
        }

        const message = DataScience.automaticallyReconnectingToAKernelProgressMessage(
            getDisplayNameOrNameOfKernelConnection(kernel.kernelConnectionMetadata)
        );
        window
            .withProgress({ location: ProgressLocation.Notification, title: message }, async () => deferred.promise)
            .then(noop, noop);

        this.disposableRegistry.push(disposable);
    }

    private async onKernelDisconnected(kernel: IKernel) {
        // If it is being disposed and we know of this, then no need to display any messages.
        if (kernel.disposed || kernel.disposing) {
            return;
        }
        sendKernelTelemetryEvent(kernel.resourceUri, Telemetry.KernelCrash);

        // If this is a connection from a uri provider (such as a remote server), then we cannot restart the kernel.
        // Let's request the uri provider to resolve the uri and then reconnect
        if (isRemoteConnection(kernel.kernelConnectionMetadata)) {
            const handled = await this.handleRemoteServerShutdown(kernel, kernel.kernelConnectionMetadata);

            if (handled) {
                return;
            }
        }

        const message = isLocalConnection(kernel.kernelConnectionMetadata)
            ? DataScience.kernelDisconnected(getDisplayNameOrNameOfKernelConnection(kernel.kernelConnectionMetadata))
            : DataScience.remoteJupyterConnectionFailedWithServer(kernel.kernelConnectionMetadata.baseUrl);

        window.showErrorMessage(message).then(noop, noop);

        try {
            const lastExecutedCell = this.lastExecutedCellPerKernel.get(kernel);
            if (!lastExecutedCell || lastExecutedCell.document.isClosed || lastExecutedCell.notebook.isClosed) {
                return;
            }
            if (lastExecutedCell.executionSummary?.success === false) {
                return;
            }
            await endCellAndDisplayErrorsInCell(lastExecutedCell, kernel.controller, message, false);
        } finally {
            // Given the fact that we know the kernel connection is dead, dispose the kernel to clean everything.
            await kernel.dispose();
        }
    }

    /**
     * Possible the kernel died because the remote jupyter server is no longer available.
     * Validate the server is still available with the jupyter providers and remove stale servers.
     * @return {*}  {Promise<boolean> `true` if the remote server has shutdown, else `false` }
     */
    private async handleRemoteServerShutdown(
        kernel: IKernel,
        metadata: RemoteKernelConnectionMetadata
    ): Promise<boolean> {
        const collection = this.jupyterUriProviderRegistration.jupyterCollections.find(
            (c) =>
                c.extensionId === metadata.serverProviderHandle.extensionId && c.id === metadata.serverProviderHandle.id
        );
        if (!collection) {
            return false;
        }

        const token = new CancellationTokenSource();
        try {
            const servers = await Promise.resolve(collection.serverProvider.provideJupyterServers(token.token));
            const handles = (servers || []).map((s) => s.id);
            if (!handles.includes(metadata.serverProviderHandle.handle)) {
                await this.serverUriStorage.remove(metadata.serverProviderHandle);
                this.kernelReconnectProgress.get(kernel)?.dispose();
                this.kernelReconnectProgress.delete(kernel);
                return true;
            }
            return false;
        } catch (_ex) {
            return false;
        } finally {
            token.dispose();
        }
    }
}
