// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

/* eslint-disable  */

import * as fs from 'fs-extra';
import * as vscode from 'vscode';
import '../extensions';

// This helper function determines the file type of the given stats
// object.  The type follows the convention of node's fs module, where
// a file has exactly one type.  Symlinks are not resolved.
export function convertFileType(stat: fs.Stats): vscode.FileType {
    if (stat.isFile()) {
        return vscode.FileType.File;
    } else if (stat.isDirectory()) {
        return vscode.FileType.Directory;
    } else if (stat.isSymbolicLink()) {
        // The caller is responsible for combining this ("logical or")
        // with File or Directory as necessary.
        return vscode.FileType.SymbolicLink;
    } else {
        return vscode.FileType.Unknown;
    }
}

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
