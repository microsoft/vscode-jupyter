// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Kernel } from '@jupyterlab/services';
import { inject, injectable } from 'inversify';
import { NotebookCell, NotebookCellExecutionState, notebooks } from 'vscode';
import { IExtensionSyncActivationService } from '../platform/activation/types';
import { IApplicationShell } from '../platform/common/application/types';
import { IDisposableRegistry } from '../platform/common/types';
import { isJupyterNotebook } from '../platform/common/utils';
import { DataScience } from '../platform/common/utils/localize';
import { noop } from '../platform/common/utils/misc';
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
        @inject(IApplicationShell) private appShell: IApplicationShell,
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
        });
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
        // If it is being disposed and we know of this, then no need to display any messages.
        if (kernel.disposed || kernel.disposing) {
            return;
        }
        sendKernelTelemetryEvent(kernel.resourceUri, Telemetry.KernelCrash);

        const message = isLocalConnection(kernel.kernelConnectionMetadata)
            ? DataScience.kernelDisconnected().format(
                  getDisplayNameOrNameOfKernelConnection(kernel.kernelConnectionMetadata)
              )
            : DataScience.remoteJupyterConnectionFailedWithServer().format(kernel.kernelConnectionMetadata.baseUrl);

        this.appShell.showErrorMessage(message).then(noop, noop);

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
}
