// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Resource } from '../types';
import { BaseWorkspaceService } from './workspace.base';
import * as fs from 'fs-extra';
import * as path from '../../vscode-path/path';
import { injectable } from 'inversify';
import { IWorkspaceService } from './types';

export async function computeWorkingDirectory(resource: Resource, workspace: IWorkspaceService): Promise<string> {
    const fileExists = resource && resource.scheme === 'file' ? await fs.pathExists(resource.fsPath) : false;
    const dirExists =
        resource && resource.scheme === 'file' ? await fs.pathExists(path.dirname(resource.fsPath)) : false;

    // If we have a file with an extension, use the dir of the file
    if (dirExists && resource && resource.fsPath.includes('.')) {
        return path.dirname(resource.fsPath);
    }
    // If we have a dir then use the dir.
    if (fileExists && resource && (await fs.stat(resource.fsPath)).isDirectory()) {
        return resource.fsPath;
    }

    // Otherwise a file without an extension or directory doesn't exist. Just use the workspace root
    return workspace.getWorkspaceFolder(resource)?.uri.fsPath || workspace.rootFolder?.fsPath || process.cwd();
}

/**
 * Node implementation of the workspace service. Computing working directory is different for node.
 */
@injectable()
export class WorkspaceService extends BaseWorkspaceService {
    public computeWorkingDirectory(resource: Resource): Promise<string> {
        return computeWorkingDirectory(resource, this);
    }
}
