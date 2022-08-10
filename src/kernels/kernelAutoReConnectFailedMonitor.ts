// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Kernel } from '@jupyterlab/services';
import { inject, injectable } from 'inversify';
import { NotebookCell } from 'vscode';
import { IExtensionSyncActivationService } from '../platform/activation/types';
import { IDisposableRegistry } from '../platform/common/types';
import { DataScience } from '../platform/common/utils/localize';
import { Telemetry } from '../telemetry';
import { endCellAndDisplayErrorsInCell } from './execution/helpers';
import { getDisplayNameOrNameOfKernelConnection } from './helpers';
import { sendKernelTelemetryEvent } from './telemetry/sendKernelTelemetryEvent';
import { IKernel, IKernelProvider, isLocalConnection } from './types';

/**
 * In the case of Jupyter kernels, when a kernel dies Jupyter will automatically restart that kernel.
 * In such a case we need to display a little progress indicator so user is aware of the fact that the kernel is restarting.
 */
@injectable()
export class KernelAutoReConnectFailedMonitor implements IExtensionSyncActivationService {
    private kernelsStartedSuccessfully = new WeakSet<IKernel>();
    private kernelConnectionToKernelMapping = new WeakMap<Kernel.IKernelConnection, IKernel>();
    private kernelsRestarting = new WeakSet<IKernel>();
    private kernelReconnectProgress = new WeakSet<IKernel>();
    private lastExecutedCellPerKernel = new WeakMap<IKernel, NotebookCell | undefined>();

    constructor(
        @inject(IDisposableRegistry) private disposableRegistry: IDisposableRegistry,
        @inject(IKernelProvider) private kernelProvider: IKernelProvider
    ) {}
    public activate(): void {
        this.kernelProvider.onDidStartKernel(this.onDidStartKernel, this, this.disposableRegistry);
        this.disposableRegistry.push(
            this.kernelProvider.onDidDisposeKernel((kernel) => {
                this.kernelReconnectProgress.delete(kernel);
            }, this)
        );
        this.disposableRegistry.push(
            this.kernelProvider.onDidRestartKernel((kernel) => {
                this.kernelReconnectProgress.delete(kernel);
            }, this)
        );
    }
    private onDidStartKernel(kernel: IKernel) {
        if (!this.kernelsStartedSuccessfully.has(kernel)) {
            kernel.onPreExecute(
                (cell) => this.lastExecutedCellPerKernel.set(kernel, cell),
                this,
                this.disposableRegistry
            );

            if (!kernel.session?.kernel) {
                return;
            }
            this.kernelsStartedSuccessfully.add(kernel);
            this.kernelConnectionToKernelMapping.set(kernel.session?.kernel, kernel);
            kernel.session?.kernel?.connectionStatusChanged.connect(this.onKernelStatusChanged, this);
            kernel.addEventHook(async (e) => {
                if (e === 'willRestart') {
                    this.kernelReconnectProgress.delete(kernel);
                    this.kernelsRestarting.add(kernel);
                }
            });
            kernel.onRestarted(() => this.kernelsRestarting.delete(kernel));
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
                this.kernelReconnectProgress.delete(kernel);
                return;
            }
            case 'disconnected': {
                if (this.kernelReconnectProgress.has(kernel)) {
                    this.kernelReconnectProgress.delete(kernel);
                    this.onKernelDisconnected(kernel)?.ignoreErrors();
                }
                return;
            }
            case 'connecting':
                this.kernelReconnectProgress.add(kernel);
                return;
            default:
                return;
        }
    }
    private async onKernelDisconnected(kernel: IKernel) {
        const lastExecutedCell = this.lastExecutedCellPerKernel.get(kernel);
        sendKernelTelemetryEvent(kernel.resourceUri, Telemetry.KernelCrash);
        if (!lastExecutedCell) {
            return;
        }

        const message = isLocalConnection(kernel.kernelConnectionMetadata)
            ? DataScience.kernelDisconnected()
            : DataScience.remoteJupyterConnectionFailedWithServer().format(
                  getDisplayNameOrNameOfKernelConnection(kernel.kernelConnectionMetadata)
              );
        await endCellAndDisplayErrorsInCell(lastExecutedCell, kernel.controller, message, false);

        // Given the fact that we know the kernel connection is dead, dispose the kernel to clean everything.
        await kernel.dispose();
    }
}
