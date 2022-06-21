// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import * as path from '../../platform/vscode-path/path';
import * as fsExtra from 'fs-extra';
import { Uri } from 'vscode';
import { fsPathToUri } from '../vscode-path/utils';
import { IWorkspaceService } from './application/types';
import { IFileSystemNode } from './platform/types.node';
import { IConfigurationService, Resource } from './types';
import { getOSType, OSType } from './utils/platform';
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const untildify = require('untildify');

export async function tryGetRealPath(expectedPath: Uri): Promise<Uri | undefined> {
    try {
        // Real path throws if the expected path is not actually created yet.
        let realPath = await fsExtra.realpath(expectedPath.fsPath);

        // Make sure on linux we use the correct separator
        if (getOSType() != OSType.Windows) {
            realPath = realPath.replace(/\\/g, '/');
        }

        return fsPathToUri(realPath);
    } catch {
        // So if that happens, just return the original path.
        return expectedPath;
    }
}

export async function calculateWorkingDirectory(
    configService: IConfigurationService,
    workspace: IWorkspaceService,
    fs: IFileSystemNode,
    resource: Resource
): Promise<string | undefined> {
    let workingDir: string | undefined;
    // For a local launch calculate the working directory that we should switch into
    const settings = configService.getSettings(resource);
    const fileRoot = untildify(settings.notebookFileRoot);

    // If we don't have a workspace open the notebookFileRoot seems to often have a random location in it (we use ${workspaceRoot} as default)
    // so only do this setting if we actually have a valid workspace open
    if (fileRoot && workspace.hasWorkspaceFolders) {
        const workspaceFolderPath = workspace.workspaceFolders![0].uri.fsPath;
        if (path.isAbsolute(fileRoot)) {
            if (await fs.localDirectoryExists(fileRoot)) {
                // User setting is absolute and exists, use it
                workingDir = fileRoot;
            } else {
                // User setting is absolute and doesn't exist, use workspace
                workingDir = workspaceFolderPath;
            }
        } else if (!fileRoot.includes('${')) {
            // fileRoot is a relative path, combine it with the workspace folder
            const combinedPath = path.join(workspaceFolderPath, fileRoot);
            if (await fs.localDirectoryExists(combinedPath)) {
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
