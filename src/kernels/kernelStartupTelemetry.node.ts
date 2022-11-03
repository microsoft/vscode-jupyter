// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IExtensionSyncActivationService } from '../platform/activation/types';
import { IDisposableRegistry } from '../platform/common/types';
import { sendTelemetryForPythonKernelExecutable } from './helpers.node';
import { IKernel, IKernelProvider } from './types';

@injectable()
export class KernelStartupTelemetry implements IExtensionSyncActivationService {
    constructor(
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {}
    activate(): void {
        this.kernelProvider.onDidCreateKernel((kernel) => this.addOnStartHooks(kernel), this, this.disposables);
    }

    private addOnStartHooks(kernel: IKernel) {
        kernel.addHook(
            'didStart',
            async () => {
                if (kernel.session) {
                    await sendTelemetryForPythonKernelExecutable(
                        kernel.session,
                        kernel.resourceUri,
                        kernel.kernelConnectionMetadata
                    );
                }
            },
            this,
            this.disposables
        );
    }
}
