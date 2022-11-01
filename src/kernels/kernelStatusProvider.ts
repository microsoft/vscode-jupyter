// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IExtensionSyncActivationService } from '../platform/activation/types';
import { disposeAllDisposables } from '../platform/common/helpers';
import { IDisposable, IDisposableRegistry } from '../platform/common/types';
import { DataScience } from '../platform/common/utils/localize';
import { KernelProgressReporter } from '../platform/progress/kernelProgressReporter';
import { IStatusProvider } from '../platform/progress/types';
import { getDisplayNameOrNameOfKernelConnection } from './helpers';
import { IKernel, IKernelProvider } from './types';

@injectable()
export class KernelStatusProvider implements IExtensionSyncActivationService {
    private readonly disposables: IDisposable[] = [];
    private readonly restartStatus = new WeakMap<IKernel, IDisposable>();
    private readonly restartProgress = new WeakMap<IKernel, IDisposable>();
    private readonly interruptStatus = new WeakMap<IKernel, IDisposable>();
    constructor(
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IStatusProvider) protected readonly statusProvider: IStatusProvider
    ) {
        disposables.push(this);
    }
    public dispose(): void {
        disposeAllDisposables(this.disposables);
    }
    activate(): void {
        this.kernelProvider.onDidCreateKernel(this.onDidCreateKernel, this, this.disposables);
    }
    private onDidCreateKernel(kernel: IKernel) {
        // Restart status.
        kernel.addEventHook(async (e) => {
            switch (e) {
                case 'willRestart': {
                    this.restartStatus.get(kernel)?.dispose();
                    this.restartProgress.get(kernel)?.dispose();
                    const status = this.statusProvider.set(DataScience.restartingKernelStatus().format(''));
                    this.restartStatus.set(kernel, status);
                    const progress = KernelProgressReporter.createProgressReporter(
                        kernel.resourceUri,
                        DataScience.restartingKernelStatus().format(
                            `: ${getDisplayNameOrNameOfKernelConnection(kernel.kernelConnectionMetadata)}`
                        )
                    );
                    this.restartProgress.set(kernel, progress);
                    break;
                }
                case 'restartCompleted': {
                    this.restartStatus.get(kernel)?.dispose();
                    this.restartProgress.get(kernel)?.dispose();
                    break;
                }
                case 'willInterrupt': {
                    this.interruptStatus.get(kernel)?.dispose();
                    const status = this.statusProvider.set(DataScience.interruptKernelStatus());
                    this.interruptStatus.set(kernel, status);
                    break;
                }
                case 'interruptCompleted': {
                    this.interruptStatus.get(kernel)?.dispose();
                    break;
                }
            }
        });
    }
}
