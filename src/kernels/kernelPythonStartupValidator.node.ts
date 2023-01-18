// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IExtensionSyncActivationService } from '../platform/activation/types';
import { disposeAllDisposables } from '../platform/common/helpers';
import { IFileSystem } from '../platform/common/platform/types';
import { IDisposable, IDisposableRegistry } from '../platform/common/types';
import { IKernelProvider, IKernel, KernelConnectionMetadata } from './types';

@injectable()
export class KernelPythonStartupValidator implements IExtensionSyncActivationService {
    private readonly disposables: IDisposable[] = [];
    private readonly registeredKernels = new WeakSet<IKernel>();
    constructor(
        @inject(IKernelProvider) private readonly kernelProvider: IKernelProvider,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IFileSystem) private readonly fs: IFileSystem
    ) {
        disposables.push(this);
    }
    dispose() {
        disposeAllDisposables(this.disposables);
    }
    activate(): void {
        this.kernelProvider.onDidCreateKernel(this.onCreateKernel, this, this.disposables);
    }
    private onCreateKernel(kernel: IKernel) {
        if (this.registeredKernels.has(kernel)) {
            return;
        }
        this.registeredKernels.add(kernel);
        kernel.addHook('willStart', () => this.validatePythonPath(kernel.kernelConnectionMetadata));
    }
    public async validatePythonPath(kernelConnectionMetadata: KernelConnectionMetadata) {
        if (kernelConnectionMetadata.kind !== 'startUsingPythonInterpreter') {
            return;
        }

        if (kernelConnectionMetadata.interpreter.uri.scheme !== 'file') {
            return;
        }

        // Check whether the file exists.
        if (await this.fs.exists(kernelConnectionMetadata.interpreter.uri)) {
            return;
        }
        throw new Error('Python Envionrment does not exist');
    }
}
