// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Kernel } from '@jupyterlab/services';
import { inject, injectable } from 'inversify';
import { Disposable, ProgressLocation } from 'vscode';
import { IExtensionSyncActivationService } from '../platform/activation/types';
import { IApplicationShell } from '../platform/common/application/types';
import { IDisposable, IDisposableRegistry } from '../platform/common/types';
import { createDeferred } from '../platform/common/utils/async';
import { DataScience } from '../platform/common/utils/localize';
import { noop } from '../platform/common/utils/misc';
import { getDisplayNameOrNameOfKernelConnection } from './helpers';
import { IKernel, IKernelProvider } from './types';

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

    constructor(
        @inject(IApplicationShell) private appShell: IApplicationShell,
        @inject(IDisposableRegistry) private disposableRegistry: IDisposableRegistry,
        @inject(IKernelProvider) private kernelProvider: IKernelProvider
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
    }
    private onDidStartKernel(kernel: IKernel) {
        if (!this.kernelsStartedSuccessfully.has(kernel)) {
            if (!kernel.session?.kernel) {
                return;
            }
            this.kernelsStartedSuccessfully.add(kernel);
            this.kernelConnectionToKernelMapping.set(kernel.session?.kernel, kernel);
            kernel.session?.kernel?.connectionStatusChanged.connect(this.onKernelStatusChanged, this);
            kernel.addEventHook(async (e) => {
                if (e === 'willRestart') {
                    this.kernelReconnectProgress.get(kernel)?.dispose();
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
        if (this.kernelReconnectProgress.has(kernel)) {
            if (connectionStatus !== 'connecting') {
                this.kernelReconnectProgress.get(kernel)?.dispose();
                this.kernelReconnectProgress.delete(kernel);
            }
            return;
        }
        if (connectionStatus !== 'connecting') {
            return;
        }
        const deferred = createDeferred<void>();
        const message = DataScience.automaticallyReconnectingToAKernelProgressMessage().format(
            getDisplayNameOrNameOfKernelConnection(kernel.kernelConnectionMetadata)
        );
        this.appShell
            .withProgress({ location: ProgressLocation.Notification, title: message }, async () => deferred.promise)
            .then(noop, noop);

        const disposable = new Disposable(() => deferred.resolve());
        this.kernelReconnectProgress.set(kernel, disposable);
        this.disposableRegistry.push(disposable);
    }
}
