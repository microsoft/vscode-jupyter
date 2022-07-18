// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IWorkspaceService } from '../platform/common/application/types';
import { CodeSnippets } from '../platform/common/constants';
import { IFileSystemNode } from '../platform/common/platform/types.node';
import { IConfigurationService } from '../platform/common/types';
import { calculateWorkingDirectory } from '../platform/common/utils.node';
import { traceInfo } from '../platform/logging';
import { isLocalHostConnection, isPythonKernelConnection } from './helpers';
import { expandWorkingDir } from './jupyter/jupyterUtils';
import { IKernel, isLocalConnection, IStartupCodeProvider } from './types';

@injectable()
export class KernelStartupCodeProvider implements IStartupCodeProvider {
    public priority: number = 0;

    constructor(
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IFileSystemNode) private readonly fs: IFileSystemNode,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService
    ) {}

    async getCode(kernel: IKernel): Promise<string[]> {
        if (
            !(
                isLocalConnection(kernel.kernelConnectionMetadata) &&
                !this.configService.getSettings(undefined).forceIPyKernelDebugger
            )
        ) {
            return [];
        }

        if (
            isLocalConnection(kernel.kernelConnectionMetadata) ||
            isLocalHostConnection(kernel.kernelConnectionMetadata)
            // && kernel.kernelConnectionMetadata.kind !== 'connectToLiveRemoteKernel' // Skip for live kernel. Don't change current directory on a kernel that's already running
        ) {
            let suggestedDir = await calculateWorkingDirectory(
                this.configService,
                this.workspaceService,
                this.fs,
                kernel.resourceUri
            );
            if (suggestedDir && (await this.fs.localDirectoryExists(suggestedDir))) {
                traceInfo('UpdateWorkingDirectoryAndPath in Kernel');
                // We should use the launch info directory. It trumps the possible dir
                return this.getChangeDirectoryCode(kernel, suggestedDir);
            } else if (kernel.resourceUri && (await this.fs.localFileExists(kernel.resourceUri.fsPath))) {
                // Combine the working directory with this file if possible.
                suggestedDir = expandWorkingDir(
                    suggestedDir,
                    kernel.resourceUri,
                    this.workspaceService,
                    this.configService.getSettings(kernel.resourceUri)
                );
                if (suggestedDir && (await this.fs.localDirectoryExists(suggestedDir))) {
                    traceInfo('UpdateWorkingDirectoryAndPath in Kernel');
                    return this.getChangeDirectoryCode(kernel, suggestedDir);
                }
            }
        }
        return [];
    }

    private getChangeDirectoryCode(kernel: IKernel, directory: string): string[] {
        if (
            (isLocalConnection(kernel.kernelConnectionMetadata) ||
                isLocalHostConnection(kernel.kernelConnectionMetadata)) &&
            isPythonKernelConnection(kernel.kernelConnectionMetadata)
        ) {
            return CodeSnippets.UpdateCWDAndPath.format(directory).splitLines({ trim: false });
        }
        return [];
    }
}
