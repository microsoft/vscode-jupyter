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
    readonly homeDir: vscode.Uri | undefined;
    readonly tempDir: vscode.Uri | undefined;
}

//===========================
// temp FS

export type TemporaryFile = { filePath: string } & vscode.Disposable;
export type TemporaryDirectory = { path: string } & vscode.Disposable;

export interface ITempFileSystem {
    createFile(suffix: string, mode?: number): Promise<TemporaryFile>;
}

// Where to fine executables.
//
// In particular this class provides all the tools needed to find
// executables, including through an environment variable.
export interface IExecutables {
    delimiter: string;
    envVar: string;
}
