// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { SemVer } from 'semver';
import * as vscode from 'vscode';
import { OSType } from '../utils/platform';

//===========================
// platform

export const IsWindows = Symbol('IS_WINDOWS');

export const IPlatformService = Symbol('IPlatformService');
export interface IPlatformService {
    readonly osType: OSType;
    osRelease: string;
    readonly virtualEnvBinName: 'bin' | 'Scripts';

    // convenience methods
    readonly isWindows: boolean;
    readonly isMac: boolean;
    readonly isLinux: boolean;
    readonly is64bit: boolean;
    getVersion(): Promise<SemVer>;
}

//===========================
// temp FS

export type TemporaryFile = { filePath: string } & vscode.Disposable;
export type TemporaryDirectory = { path: string } & vscode.Disposable;

export interface ITempFileSystem {
    createFile(suffix: string, mode?: number): Promise<TemporaryFile>;
}

//===========================
// FS paths

// The low-level file path operations used by the extension.
export interface IFileSystemPaths {
    readonly sep: string;
    join(...filenames: string[]): string;
    dirname(filename: string): string;
    basename(filename: string, suffix?: string): string;
    normalize(filename: string): string;
    normCase(filename: string): string;
}

// Where to fine executables.
//
// In particular this class provides all the tools needed to find
// executables, including through an environment variable.
export interface IExecutables {
    delimiter: string;
    envVar: string;
}

export const IFileSystemPathUtils = Symbol('IFileSystemPathUtils');
// A collection of high-level utilities related to filesystem paths.
export interface IFileSystemPathUtils {
    readonly paths: IFileSystemPaths;
    readonly executables: IExecutables;
    readonly home: string;
    // Return true if the two paths are equivalent on the current
    // filesystem and false otherwise.  On Windows this is significant.
    // On non-Windows the filenames must always be exactly the same.
    arePathsSame(path1: string, path2: string): boolean;
    // Return the clean (displayable) form of the given filename.
    getDisplayName(pathValue: string, cwd?: string): string;
}
