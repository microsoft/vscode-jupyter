// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import * as fsExtra from 'fs-extra';
import { Uri } from 'vscode';
import { getOSType, OSType } from './utils/platform';

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
