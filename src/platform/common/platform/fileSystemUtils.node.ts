// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

/* eslint-disable  */

import * as fs from 'fs-extra';
import * as vscode from 'vscode';
import '../extensions';

export function convertStat(old: fs.Stats, filetype: vscode.FileType): vscode.FileStat {
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
