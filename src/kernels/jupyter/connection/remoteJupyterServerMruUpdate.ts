// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Disposable } from 'vscode';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { dispose } from '../../../platform/common/utils/lifecycle';
import { IDisposable, IDisposableRegistry } from '../../../platform/common/types';
import { noop } from '../../../platform/common/utils/misc';
import { IJupyterServerUriStorage } from '../types';
import { IKernel, IKernelProvider, isRemoteConnection } from '../../types';

const INTERVAL_IN_SECONDS_TO_UPDATE_MRU = 1_000;
@injectable()
export class RemoteJupyterServerMruUpdate implements IExtensionSyncActivationService {
    private readonly disposables: IDisposable[] = [];
    private readonly monitoredKernels = new WeakSet<IKernel>();
    private readonly timeouts = new Set<Disposable>();
    constructor(
        @inject(IJupyterServerUriStorage) private readonly serverStorage: IJupyterServerUriStorage,
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry
    ) {
        disposables.push(this);
    }
    dispose() {
        dispose(this.disposables);
        dispose(Array.from(this.timeouts.values()));
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
        this.monitoredKernels.add(kernel);

        // We do not want 100s of 1000s of these timeouts,
        // multiply by notebooks, and multiply by number of kernels, this grows unnecessarily.
        const disposables: IDisposable[] = [];
        this.disposables.push(new Disposable(() => dispose(disposables)));

        const updateConnectionTime = () => {
            dispose(disposables);
            if (kernel.disposed || kernel.disposing) {
                return;
            }
            const timeout = setTimeout(() => {
                // Log this remote URI into our MRU list
                this.serverStorage.update(connection.serverProviderHandle).catch(noop);
            }, INTERVAL_IN_SECONDS_TO_UPDATE_MRU);
            disposables.push(new Disposable(() => clearTimeout(timeout)));
        };
        this.kernelProvider.getKernelExecution(kernel).onPreExecute(updateConnectionTime, this, this.disposables);
        // Log this remote URI into our MRU list
        updateConnectionTime();
    }
}
