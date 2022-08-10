// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import * as path from '../../platform/vscode-path/path';
import * as fsExtra from 'fs-extra';
import { Uri } from 'vscode';
import { IWorkspaceService } from './application/types';
import { IConfigurationService, Resource } from './types';
import { getOSType, OSType } from './utils/platform';
import { IFileSystem } from './platform/types';
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const untildify = require('untildify');

export async function tryGetRealPath(expectedPath: Uri): Promise<Uri> {
    try {
        // Real path throws if the expected path is not actually created yet.
        let realPath = await fsExtra.realpath(expectedPath.fsPath);

        // Make sure on linux we use the correct separator
        if (getOSType() != OSType.Windows) {
            realPath = realPath.replace(/\\/g, '/');
        }

        return Uri.file(realPath);
    } catch {
        // So if that happens, just return the original path.
        return expectedPath;
    }
}

export async function calculateWorkingDirectory(
    configService: IConfigurationService,
    workspace: IWorkspaceService,
    fs: IFileSystem,
    resource: Resource
): Promise<Uri | undefined> {
    let workingDir: Uri | undefined;
    // For a local launch calculate the working directory that we should switch into
    const settings = configService.getSettings(resource);
    const fileRootStr = untildify(settings.notebookFileRoot);

    // If we don't have a workspace open the notebookFileRoot seems to often have a random location in it (we use ${workspaceRoot} as default)
    // so only do this setting if we actually have a valid workspace open
    if (fileRootStr && workspace.hasWorkspaceFolders) {
        const fileRoot = Uri.file(fileRootStr);
        const workspaceFolderPath = workspace.workspaceFolders![0].uri;
        if (path.isAbsolute(fileRootStr)) {
            if (await fs.exists(fileRoot)) {
                // User setting is absolute and exists, use it
                workingDir = fileRoot;
            } else {
                // User setting is absolute and doesn't exist, use workspace
                workingDir = workspaceFolderPath;
            }
        } else if (!fileRootStr.includes('${')) {
            // fileRoot is a relative path, combine it with the workspace folder
            const combinedPath = Uri.joinPath(workspaceFolderPath, fileRootStr);
            if (await fs.exists(combinedPath)) {
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
