// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as path from '../../vscode-path/path';
import { getOSType, OSType } from '../utils/platform';
import { getDisplayPath as getDisplayPathCommon } from './fs-paths';
import { Uri, WorkspaceFolder } from 'vscode';

// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const untildify = require('untildify');

export const homePath = Uri.file(untildify('~')); // This is the only thing requiring a node version

export class Executables {
    constructor(
        // the $PATH delimiter to use
        public readonly delimiter: string,
        // the OS type to target
        private readonly osType: OSType
    ) {}
    // Create a new object using common-case default values.
    // We do not use an alternate constructor because defaults in the
    // constructor runs counter to our typical approach.
    public static withDefaults(): Executables {
        return new Executables(
            // Use node's value.
            path.delimiter,
            // Use the current OS.
            getOSType()
        );
    }

    public get envVar(): string {
        return this.osType === OSType.Windows ? 'Path' : 'PATH';
    }
}

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
