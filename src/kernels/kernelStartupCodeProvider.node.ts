// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Uri } from 'vscode';
import { IWorkspaceService } from '../platform/common/application/types';
import { CodeSnippets } from '../platform/common/constants';
import { getFilePath } from '../platform/common/platform/fs-paths';
import { IFileSystem } from '../platform/common/platform/types';
import { IConfigurationService } from '../platform/common/types';
import { calculateWorkingDirectory } from '../platform/common/utils.node';
import { traceInfo } from '../platform/logging';
import { isLocalHostConnection, isPythonKernelConnection } from './helpers';
import { expandWorkingDir } from './jupyter/jupyterUtils';
import { IKernel, isLocalConnection, IStartupCodeProvider, StartupCodePriority } from './types';

@injectable()
export class KernelStartupCodeProvider implements IStartupCodeProvider {
    public priority = StartupCodePriority.Base;

    constructor(
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService
    ) {}

    async getCode(kernel: IKernel): Promise<string[]> {
        // If this is a live kernel, we shouldn't be changing anything by running startup code.
        if (
            !isPythonKernelConnection(kernel.kernelConnectionMetadata) &&
            kernel.kernelConnectionMetadata.kind !== 'connectToLiveRemoteKernel'
        ) {
            return [];
        }
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
        ) {
            let suggestedDir = await calculateWorkingDirectory(
                this.configService,
                this.workspaceService,
                this.fs,
                kernel.resourceUri
            );
            if (suggestedDir && (await this.fs.exists(suggestedDir))) {
                traceInfo('UpdateWorkingDirectoryAndPath in Kernel');
                // We should use the launch info directory. It trumps the possible dir
                return this.getChangeDirectoryCode(kernel, suggestedDir);
            } else if (kernel.resourceUri && (await this.fs.exists(kernel.resourceUri))) {
                // Combine the working directory with this file if possible.
                suggestedDir = Uri.file(
                    expandWorkingDir(
                        getFilePath(suggestedDir),
                        kernel.resourceUri,
                        this.workspaceService,
                        this.configService.getSettings(kernel.resourceUri)
                    )
                );
                if (suggestedDir && (await this.fs.exists(suggestedDir))) {
                    traceInfo('UpdateWorkingDirectoryAndPath in Kernel');
                    return this.getChangeDirectoryCode(kernel, suggestedDir);
                }
            }
        }
        return [];
    }

    private getChangeDirectoryCode(kernel: IKernel, directory: Uri): string[] {
        if (
            (isLocalConnection(kernel.kernelConnectionMetadata) ||
                isLocalHostConnection(kernel.kernelConnectionMetadata)) &&
            isPythonKernelConnection(kernel.kernelConnectionMetadata)
        ) {
            return CodeSnippets.UpdateCWDAndPath.format(getFilePath(directory)).splitLines({ trim: false });
        }
        return [];
    }
}
