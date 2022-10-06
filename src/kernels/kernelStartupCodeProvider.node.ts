// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { CodeSnippets } from '../platform/common/constants';
import { getFilePath } from '../platform/common/platform/fs-paths';
import { traceInfo } from '../platform/logging';
import { isLocalHostConnection, isPythonKernelConnection } from './helpers';
import { KernelWorkingFolder } from './kernelWorkingFolder.node';
import { IKernel, isLocalConnection, IStartupCodeProvider, StartupCodePriority } from './types';

@injectable()
export class KernelStartupCodeProvider implements IStartupCodeProvider {
    public priority = StartupCodePriority.Base;

    constructor(@inject(KernelWorkingFolder) private readonly kernelWorkingFolder: KernelWorkingFolder) {}

    async getCode(kernel: IKernel): Promise<string[]> {
        // We cannot change paths for remote live kernels.
        if (kernel.kernelConnectionMetadata.kind === 'connectToLiveRemoteKernel') {
            return [];
        }
        // Only local kernels are supported.
        if (
            !isLocalConnection(kernel.kernelConnectionMetadata) &&
            !isLocalHostConnection(kernel.kernelConnectionMetadata)
        ) {
            return [];
        }
        if (!isPythonKernelConnection(kernel.kernelConnectionMetadata)) {
            return [];
        }

        // If this is a live kernel, we shouldn't be changing anything by running startup code.
        if (!isPythonKernelConnection(kernel.kernelConnectionMetadata)) {
            return [];
        }
        const suggestedDir = await this.kernelWorkingFolder.getWorkingDirectory(kernel);
        if (suggestedDir) {
            traceInfo('UpdateWorkingDirectoryAndPath in Kernel');
            return CodeSnippets.UpdateCWDAndPath.format(getFilePath(suggestedDir)).splitLines({ trim: false });
        }
        return [];
    }
}
