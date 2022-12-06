// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import { isPythonKernelConnection } from './helpers';
import { IKernel, isLocalConnection, IStartupCodeProvider, StartupCodePriority } from './types';

@injectable()
export class DebugStartupCodeProvider implements IStartupCodeProvider {
    public priority = StartupCodePriority.Base;

    async getCode(kernel: IKernel): Promise<string[]> {
        if (!isPythonKernelConnection(kernel.kernelConnectionMetadata)) {
            return [];
        }
        if (isLocalConnection(kernel.kernelConnectionMetadata)) {
            return [];
        }
        // Inject the env var only for remote kernels, for local kernels,
        // this env var will be setup when spawning the kernel process.
        return [
            'import os as __VSCODE_os',
            // Required to get pydevd to work properly in Python kernel, more info here https://github.com/microsoft/vscode-jupyter/issues/11033
            '__VSCODE_os.environ["PYDEVD_IPYTHON_COMPATIBLE_DEBUGGING"] = "1"',
            'del __VSCODE_os'
        ];
    }
}
