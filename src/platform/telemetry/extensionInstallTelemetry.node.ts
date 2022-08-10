// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from '../vscode-path/path';
import { setSharedProperty } from '.';
import { IFileSystemNode } from '../common/platform/types.node';
import { EXTENSION_ROOT_DIR } from '../constants.node';
import { Uri } from 'vscode';

/**
 * Sets shared telemetry property about where the extension was installed from
 * currently we only detect installations from the Python coding pack installer.
 * Those installations get the 'pythonCodingPack'. Otherwise assume the default
 * case as 'MarketPlace'.
 *
 */
export async function setExtensionInstallTelemetryProperties(fs: IFileSystemNode) {
    // Look for PythonCodingPack file under `%USERPROFILE%/.vscode/extensions`
    // folder. If that file exists treat this extension as installed from coding
    // pack.
    //
    // Use parent of EXTENSION_ROOT_DIR to access %USERPROFILE%/.vscode/extensions
    // this is because the installer will add PythonCodingPack to %USERPROFILE%/.vscode/extensions
    // or %USERPROFILE%/.vscode-insiders/extensions depending on what was installed
    // previously by the user. If we always join (<home>, .vscode, extensions), we will
    // end up looking at the wrong place, with respect to the extension that was launched.
    const fileToCheck = Uri.file(path.join(path.dirname(EXTENSION_ROOT_DIR), 'PythonCodingPack'));
    if (await fs.exists(fileToCheck)) {
        setSharedProperty('installSource', 'pythonCodingPack');
    } else {
        // We did not file the `PythonCodingPack` file, assume market place install.
        setSharedProperty('installSource', 'marketPlace');
    }
}
