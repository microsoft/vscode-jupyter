// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Resource } from '../types';
import { BaseWorkspaceService, getRootFolder } from './workspace.base';
import * as fs from 'fs-extra';
import * as path from '../../vscode-path/path';
import { injectable } from 'inversify';
import { workspace } from 'vscode';

/**
 * Node implementation of the workspace service. Computing working directory is different for node.
 */
@injectable()
export class WorkspaceService extends BaseWorkspaceService {
    public async computeWorkingDirectory(resource: Resource): Promise<string> {
        return computeWorkingDirectory(resource);
    }
}
export async function computeWorkingDirectory(resource: Resource): Promise<string> {
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
    return (
        (resource ? workspace.getWorkspaceFolder(resource)?.uri.fsPath : resource) ||
        getRootFolder()?.fsPath ||
        process.cwd()
    );
}
