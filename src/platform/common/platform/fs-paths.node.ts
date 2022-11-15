// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getOSType, OSType } from '../utils/platform';
import { getDisplayPath as getDisplayPathCommon } from './fs-paths';
import { Uri, WorkspaceFolder } from 'vscode';
import { homedir } from 'os';

export const homePath = Uri.file(homedir()); // This is the only thing requiring a node version

export function removeHomeFromFile(file: string | undefined) {
    if (getOSType() === OSType.Windows) {
        if (file && file.toLowerCase().startsWith(homePath.fsPath.toLowerCase())) {
            return `~${file.slice(homePath.fsPath.length)}`;
        }
    } else {
        if (file && file.startsWith(homePath.fsPath)) {
            return `~${file.slice(homePath.fsPath.length)}`;
        }
    }
    return file || '';
}

export function getDisplayPathFromLocalFile(file: string | undefined, cwd?: string | undefined) {
    const folders: WorkspaceFolder[] = cwd
        ? [
              {
                  uri: Uri.file(cwd),
                  name: '',
                  index: 0
              }
          ]
        : [];
    return getDisplayPath(file ? Uri.file(file) : undefined, folders);
}

export function getDisplayPath(file?: Uri, workspaceFolders: readonly WorkspaceFolder[] | WorkspaceFolder[] = []) {
    return getDisplayPathCommon(file, workspaceFolders, homePath);
}
