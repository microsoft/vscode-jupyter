// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable local-rules/dont-use-fspath */

import * as fsextra from 'fs-extra';
import { FileStat, FileType } from 'vscode';

export function convertStat(old: fsextra.Stats, filetype: FileType): FileStat {
    return {
        type: filetype,
        size: old.size,
        // FileStat.ctime and FileStat.mtime only have 1-millisecond
        // resolution, while node provides nanosecond resolution.  So
        // for now we round to the nearest integer.
        // See: https://github.com/microsoft/vscode/issues/84526
        ctime: Math.round(old.ctimeMs),
        mtime: Math.round(old.mtimeMs)
    };
}
