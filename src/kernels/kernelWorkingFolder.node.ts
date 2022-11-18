// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from '../platform/vscode-path/path';
import { inject, injectable } from 'inversify';
import { Uri } from 'vscode';
import { IWorkspaceService } from '../platform/common/application/types';
import { getFilePath } from '../platform/common/platform/fs-paths';
import { IFileSystem } from '../platform/common/platform/types';
import { IConfigurationService, Resource } from '../platform/common/types';
import { isLocalHostConnection, isPythonKernelConnection } from './helpers';
import { expandWorkingDir } from './jupyter/jupyterUtils';
import { IKernel, isLocalConnection } from './types';
import { untildify } from '../platform/common/platform/fileUtils.node';

@injectable()
export class KernelWorkingFolder {
    constructor(
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService
    ) {}

    async getWorkingDirectory(kernel: IKernel): Promise<Uri | undefined> {
        // If this is a remote kernel, we shouldn't be changing the startup directory
        if (
            !isLocalConnection(kernel.kernelConnectionMetadata) &&
            !isLocalHostConnection(kernel.kernelConnectionMetadata)
        ) {
            return;
        }
        if (!isPythonKernelConnection(kernel.kernelConnectionMetadata)) {
            return;
        }

        let suggestedDir = await this.calculateWorkingDirectory(kernel.resourceUri);
        if (suggestedDir && (await this.fs.exists(suggestedDir))) {
            return suggestedDir;
        } else if (kernel.resourceUri && (await this.fs.exists(kernel.resourceUri))) {
            // Combine the working directory with this file if possible.
            suggestedDir = Uri.file(
                expandWorkingDir(
                    getFilePath(suggestedDir),
                    kernel.resourceUri,
                    this.workspace,
                    this.configService.getSettings(kernel.resourceUri)
                )
            );
            if (suggestedDir && (await this.fs.exists(suggestedDir))) {
                return suggestedDir;
            }
        }
    }

    private async calculateWorkingDirectory(resource: Resource): Promise<Uri | undefined> {
        let workingDir: Uri | undefined;
        // For a local launch calculate the working directory that we should switch into
        const settings = this.configService.getSettings(resource);
        const fileRootStr = untildify(settings.notebookFileRoot);

        // If we don't have a workspace open the notebookFileRoot seems to often have a random location in it (we use ${workspaceRoot} as default)
        // so only do this setting if we actually have a valid workspace open
        if (fileRootStr && this.workspace.hasWorkspaceFolders) {
            const fileRoot = Uri.file(fileRootStr);
            const workspaceFolderPath = this.workspace.workspaceFolders![0].uri;
            if (path.isAbsolute(fileRootStr)) {
                if (await this.fs.exists(fileRoot)) {
                    // User setting is absolute and exists, use it
                    workingDir = fileRoot;
                } else {
                    // User setting is absolute and doesn't exist, use workspace
                    workingDir = workspaceFolderPath;
                }
            } else if (!fileRootStr.includes('${')) {
                // fileRoot is a relative path, combine it with the workspace folder
                const combinedPath = Uri.joinPath(workspaceFolderPath, fileRootStr);
                if (await this.fs.exists(combinedPath)) {
                    // combined path exists, use it
                    workingDir = combinedPath;
                } else {
                    // Combined path doesn't exist, use workspace
                    workingDir = workspaceFolderPath;
                }
            } else {
                // fileRoot is a variable that hasn't been expanded
                workingDir = fileRoot;
            }
        }
        return workingDir;
    }
}
