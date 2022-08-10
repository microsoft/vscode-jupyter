// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { getOSType, OSType } from '../utils/platform';
import * as path from '../../../platform/vscode-path/path';
import * as hashjs from 'hash.js';

export function normCasePath(filePath: string): string {
    return getOSType() === OSType.Windows ? path.normalize(filePath).toUpperCase() : path.normalize(filePath);
}

export function arePathsSame(path1: string, path2: string): boolean {
    return normCasePath(path1) === normCasePath(path2);
}

// We *could* use ICryptoUtils, but it's a bit overkill, issue tracked
// in https://github.com/microsoft/vscode-python/issues/8438.
export function getHashString(data: string): string {
    return hashjs.sha512().update(data).digest('hex');
}
