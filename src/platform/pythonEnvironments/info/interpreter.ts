// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Uri } from 'vscode';
import * as uriPath from '../../vscode-path/resources';
import { PythonEnvironment } from '.';
import { getOSType, OSType } from '../../common/utils/platform';
import { getFilePath } from '../../common/platform/fs-paths';
import { getTelemetrySafeHashedString } from '../../telemetry/helpers';

export function getInterpreterHash(interpreter: PythonEnvironment | {uri: Uri}){
    const interpreterPath = getNormalizedInterpreterPath(interpreter.uri);
    return getTelemetrySafeHashedString(interpreterPath.path);
}
/**
 * Sometimes on CI, we have paths such as (this could happen on user machines as well)
 *  - /opt/hostedtoolcache/Python/3.8.11/x64/python
 *  - /opt/hostedtoolcache/Python/3.8.11/x64/bin/python
 *  They are both the same.
 * This function will take that into account.
 */
export function areInterpreterPathsSame(path1: Uri = Uri.file(''), path2:Uri = Uri.file(''), ostype = getOSType(), forceLowerCase: boolean = false){
    const norm1 = getNormalizedInterpreterPath(path1, ostype, ostype == OSType.Windows || forceLowerCase);
    const norm2 = getNormalizedInterpreterPath(path2, ostype, ostype == OSType.Windows || forceLowerCase);
    return norm1 === norm2 || uriPath.isEqual(norm1, norm2, true);
}
/**
 * Sometimes on CI, we have paths such as (this could happen on user machines as well)
 *  - /opt/hostedtoolcache/Python/3.8.11/x64/python
 *  - /opt/hostedtoolcache/Python/3.8.11/x64/bin/python
 *  They are both the same.
 * This function will take that into account.
 */
 export function getNormalizedInterpreterPath(path:Uri = Uri.file(''), ostype = getOSType(), forceLowerCase: boolean = false){
    let fsPath = getFilePath(path);
    if (forceLowerCase) {
        fsPath = fsPath.toLowerCase();
    }

    // No need to generate hashes, its unnecessarily slow.
    if (!fsPath.endsWith('/bin/python')) {
        return Uri.file(fsPath);
    }
    // Sometimes on CI, we have paths such as (this could happen on user machines as well)
    // - /opt/hostedtoolcache/Python/3.8.11/x64/python
    // - /opt/hostedtoolcache/Python/3.8.11/x64/bin/python
    // They are both the same.
    // To ensure we treat them as the same, lets drop the `bin` on unix.
    if ([OSType.Linux, OSType.OSX].includes(ostype)){
        // We need to exclude paths such as `/usr/bin/python`
        return fsPath.endsWith('/bin/python') && fsPath.split('/').length > 4 ? Uri.file(fsPath.replace('/bin/python', '/python')) : Uri.file(fsPath);
    }
    return Uri.file(fsPath);
}
