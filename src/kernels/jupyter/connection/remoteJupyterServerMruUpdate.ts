// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Disposable } from 'vscode';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { dispose } from '../../../platform/common/helpers';
import { IDisposable, IDisposableRegistry } from '../../../platform/common/types';
import { noop } from '../../../platform/common/utils/misc';
import { IJupyterServerUriStorage } from '../types';
import { IKernel, IKernelProvider, isRemoteConnection } from '../../types';

const INTERVAL_IN_SECONDS_TO_UPDATE_MRU = 60_000;
@injectable()
export class RemoteJupyterServerMruUpdate implements IExtensionSyncActivationService {
    private readonly disposables: IDisposable[] = [];
    private readonly monitoredKernels = new WeakMap<IKernel, NodeJS.Timer | number | undefined>();
    constructor(
        @inject(IJupyterServerUriStorage) private readonly serverStorage: IJupyterServerUriStorage,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry
    ) {
        disposables.push(this);
    }
    dispose() {
        dispose(this.disposables);
    }
    activate(): void {
        this.kernelProvider.onDidStartKernel(this.onDidStartKernel, this, this.disposables);
        this.kernelProvider.onDidRestartKernel(this.onDidStartKernel, this, this.disposables);
    }
    private onDidStartKernel(kernel: IKernel) {
        const connection = kernel.kernelConnectionMetadata;
        if (!isRemoteConnection(connection) || this.monitoredKernels.has(kernel)) {
            return;
        }
        this.monitoredKernels.set(kernel, undefined);

        kernel.onStatusChanged(
            () => {
                const timeout = this.monitoredKernels.get(kernel);
                if (timeout) {
                    clearTimeout(timeout);
                }
                if (kernel.status === 'idle' && !kernel.disposed && !kernel.disposing) {
                    const timeout = setTimeout(() => {
                        // Log this remote URI into our MRU list
                        this.serverStorage.update(connection.serverProviderHandle).catch(noop);
                    }, INTERVAL_IN_SECONDS_TO_UPDATE_MRU);
                    this.monitoredKernels.set(kernel, timeout);
                    this.disposables.push(new Disposable(() => clearTimeout(timeout)));
                }
            },
            this,
            this.disposables
        );

        // Log this remote URI into our MRU list
        this.serverStorage.update(connection.serverProviderHandle).catch(noop);
    }
}
