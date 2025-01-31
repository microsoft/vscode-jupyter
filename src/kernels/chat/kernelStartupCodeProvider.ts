// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { IKernel, IStartupCodeProvider, IStartupCodeProviders, StartupCodePriority } from '../types';
import { isPythonKernelConnection } from '../helpers';
import { chatStartupPythonCode } from './generator';
import { InteractiveWindowView, JupyterNotebookView } from '../../platform/common/constants';

@injectable()
export class KernelChatStartupCodeProvider implements IStartupCodeProvider, IExtensionSyncActivationService {
    public priority = StartupCodePriority.Base;

    constructor(@inject(IStartupCodeProviders) private readonly registry: IStartupCodeProviders) {}

    activate(): void {
        this.registry.register(this, JupyterNotebookView);
        this.registry.register(this, InteractiveWindowView);
    }
    async getCode(kernel: IKernel): Promise<string[]> {
        if (!isPythonKernelConnection(kernel.kernelConnectionMetadata)) {
            return [];
        }
        return [chatStartupPythonCode];
    }
}
