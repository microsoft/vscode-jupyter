// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from '../../vscode-path/path';
import { workspace } from 'vscode';
import { Resource } from '../types';
import { getOSType, OSType } from '../utils/platform';
import { IWorkspaceService } from './types';

/**
 * Wrapper around vscode's workspace namespace.
 */
export abstract class BaseWorkspaceService implements IWorkspaceService {
    public abstract computeWorkingDirectory(resource: Resource): Promise<string>;
}

export function getWorkspaceFolderIdentifier(resource: Resource, defaultValue: string = ''): string {
    const workspaceFolder = resource
        ? workspace.getWorkspaceFolder(resource)
        : workspace.workspaceFolders
        ? workspace.workspaceFolders[0] // Default to first folder if resource not passed in.
        : undefined;
    return workspaceFolder
        ? path.normalize(
              getOSType() === OSType.Windows ? workspaceFolder.uri.path.toUpperCase() : workspaceFolder.uri.path
          )
        : defaultValue;
}

export function getRootFolder() {
    const firstWorkspace =
        Array.isArray(workspace.workspaceFolders) && workspace.workspaceFolders.length > 0
            ? workspace.workspaceFolders[0]
            : undefined;
    return firstWorkspace?.uri;
}
