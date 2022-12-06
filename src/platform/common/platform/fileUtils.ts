// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { getOSType, OSType } from '../utils/platform';
import * as path from '../../../platform/vscode-path/path';

export function normCasePath(filePath: string): string {
    return getOSType() === OSType.Windows ? path.normalize(filePath).toUpperCase() : path.normalize(filePath);
}

export function arePathsSame(path1: string, path2: string): boolean {
    return normCasePath(path1) === normCasePath(path2);
}
