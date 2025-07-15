// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from '../../../platform/vscode-path/path';
import { CancellationToken, Uri, workspace } from 'vscode';
import { IConfigurationService, Resource } from '../../../platform/common/types';
import { IKernelWorkingDirectory, isLocalConnection, KernelConnectionMetadata } from '../../types';
import { untildify } from '../../../platform/common/platform/fileUtils.node';
import { IFileSystem } from '../../../platform/common/platform/types';
import { getFilePath } from '../../../platform/common/platform/fs-paths';
import { expandWorkingDir } from '../../jupyter/jupyterUtils';
import { inject, injectable } from 'inversify';
import { raceCancellationError } from '../../../platform/common/cancellation';
import { computeWorkingDirectory } from '../../../platform/common/application/workspace.node';

@injectable()
export class KernelWorkingDirectory implements IKernelWorkingDirectory {
    constructor(
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IFileSystem) private readonly fs: IFileSystem
    ) {}

    async computeWorkingDirectory(
        kernelConnection: KernelConnectionMetadata,
        resource: Resource,
        token: CancellationToken
    ): Promise<Uri> {
        if (!isLocalConnection(kernelConnection)) {
            throw new Error('Only local connections are supported');
        }
        const [workingDirectory, localWorkingDirectory] = await Promise.all([
            raceCancellationError(
                token,
                computeWorkingDirectory(resource).then((dir) => Uri.file(dir))
            ),
            raceCancellationError(
                token,
                computeLocalWorkingDirectory(resource, this.configService, this.fs).then((dir) =>
                    dir ? Uri.file(dir) : undefined
                )
            )
        ]);

        return localWorkingDirectory || workingDirectory;
    }
}

export async function computeLocalWorkingDirectory(
    resource: Resource,
    configService: IConfigurationService,
    fs: IFileSystem
): Promise<string | undefined> {
    let suggestedDir = await doComputeLocalWorkingDirectory(resource, configService, fs);
    if (suggestedDir && (await fs.exists(Uri.file(suggestedDir)))) {
        return suggestedDir;
    } else if (resource && resource.scheme !== 'untitled' && (await fs.exists(resource))) {
        // Combine the working directory with this file if possible.
        const workingDir =
            suggestedDir && suggestedDir.includes('${')
                ? suggestedDir
                : suggestedDir
                  ? getFilePath(Uri.file(suggestedDir))
                  : undefined;
        const expandedWorkingDir = expandWorkingDir(workingDir, resource, configService.getSettings(resource));
        if (await fs.exists(Uri.file(expandedWorkingDir))) {
            return expandedWorkingDir;
        }
    }
}

async function doComputeLocalWorkingDirectory(
    resource: Resource,
    configService: IConfigurationService,
    fs: IFileSystem
): Promise<string | undefined> {
    let workingDir: string | undefined;
    // For a local launch calculate the working directory that we should switch into
    const settings = configService.getSettings(resource);
    const fileRootStr = untildify(settings.notebookFileRoot);

    // If we don't have a workspace open the notebookFileRoot seems to often have a random location in it (we use ${workspaceRoot} as default)
    // so only do this setting if we actually have a valid workspace open
    if (fileRootStr && workspace.workspaceFolders?.length) {
        const fileRoot = Uri.file(fileRootStr);
        const workspaceFolderPath = workspace.workspaceFolders![0].uri;
        if (path.isAbsolute(fileRootStr)) {
            if (await fs.exists(fileRoot)) {
                // User setting is absolute and exists, use it
                workingDir = fileRoot.fsPath;
            } else {
                // User setting is absolute and doesn't exist, use workspace
                workingDir = workspaceFolderPath.fsPath;
            }
        } else if (!fileRootStr.includes('${')) {
            // fileRoot is a relative path, combine it with the workspace folder
            const combinedPath = Uri.joinPath(workspaceFolderPath, fileRootStr);
            if (await fs.exists(combinedPath)) {
                // combined path exists, use it
                workingDir = combinedPath.fsPath;
            } else {
                // Combined path doesn't exist, use workspace
                workingDir = workspaceFolderPath.fsPath;
            }
        } else {
            // fileRoot is a variable that hasn't been expanded
            workingDir = fileRootStr;
        }
    }
    return workingDir;
}
