// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getDisplayPath as getDisplayPathCommon } from './fs-paths';
import { Uri, WorkspaceFolder } from 'vscode';
import { homedir } from 'os';

export const homePath = Uri.file(homedir()); // This is the only thing requiring a node version

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
    return getDisplayPathCommon(file ? Uri.file(file) : undefined, folders, homePath);
}

export function getDisplayPath(
    file?: Uri | string,
    workspaceFolders: readonly WorkspaceFolder[] | WorkspaceFolder[] = []
) {
    return getDisplayPathCommon(file, workspaceFolders, homePath);
}
