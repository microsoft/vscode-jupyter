// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { KernelMessage } from '@jupyterlab/services';
import { inject, injectable } from 'inversify';
import { IExtensionSyncActivationService } from '../platform/activation/types';
import { IDisposable, IDisposableRegistry } from '../platform/common/types';
import { DataScience } from '../platform/common/utils/localize';
import { KernelProgressReporter } from '../platform/progress/kernelProgressReporter';
import { getDisplayNameOrNameOfKernelConnection } from './helpers';
import { IKernel, IKernelProvider } from './types';

/**
 * In the case of Jupyter kernels, when a kernel dies Jupyter will automatically restart that kernel.
 * In such a case we need to display a little progress indicator so user is aware of the fact that the kernel is restarting.
 */
@injectable()
export class KernelAutoRestartMonitor implements IExtensionSyncActivationService {
    private kernelsStartedSuccessfully = new WeakSet<IKernel>();
    private kernelRestartProgress = new WeakMap<IKernel, IDisposable>();

    constructor(
        @inject(IDisposableRegistry) private disposableRegistry: IDisposableRegistry,
        @inject(IKernelProvider) private kernelProvider: IKernelProvider
    ) {}
    public activate(): void {
        this.kernelProvider.onKernelStatusChanged(this.onKernelStatusChanged, this, this.disposableRegistry);
        this.kernelProvider.onDidStartKernel(this.onDidStartKernel, this, this.disposableRegistry);
        this.disposableRegistry.push(
            this.kernelProvider.onDidDisposeKernel((kernel) => {
                this.kernelRestartProgress.get(kernel)?.dispose();
                this.kernelRestartProgress.delete(kernel);
            }, this)
        );
        this.disposableRegistry.push(
            this.kernelProvider.onDidRestartKernel((kernel) => {
                this.kernelRestartProgress.get(kernel)?.dispose();
                this.kernelRestartProgress.delete(kernel);
            }, this)
        );
    }
    private onDidStartKernel(kernel: IKernel) {
        this.kernelsStartedSuccessfully.add(kernel);
    }

    private onKernelStatusChanged({ kernel }: { status: KernelMessage.Status; kernel: IKernel }) {
        // We're only interested in kernels that started successfully.
        if (!this.kernelsStartedSuccessfully.has(kernel) || !kernel.session || kernel.session.kind === 'localRaw') {
            return;
        }
        // If this is a Jupyter kernel (non-raw or remote jupyter), & kernel is restarting
        // then display a progress message indicating its restarting.
        // The user needs to know that its automatically restarting (they didn't explicitly restart the kernel).
        if (kernel.status === 'autorestarting') {
            // Set our status
            const progress = KernelProgressReporter.createProgressReporter(
                kernel.resourceUri,
                DataScience.restartingKernelStatus().format(
                    getDisplayNameOrNameOfKernelConnection(kernel.kernelConnectionMetadata)
                )
            );
            this.kernelRestartProgress.set(kernel, progress);
        } else if (kernel.status !== 'starting' && kernel.status !== 'busy' && kernel.status !== 'unknown') {
            if (this.kernelRestartProgress.has(kernel)) {
                this.kernelRestartProgress.get(kernel)?.dispose();
                this.kernelRestartProgress.delete(kernel);
            }
        }
    }
}
