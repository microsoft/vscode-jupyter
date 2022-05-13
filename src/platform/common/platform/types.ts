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

export const IFileSystem = Symbol('IFileSystem');
export interface IFileSystem {
    // Local-only filesystem utilities
    areLocalPathsSame(path1: string, path2: string): boolean;
    createLocalDirectory(path: string): Promise<void>;
    copyLocal(source: string, destination: string): Promise<void>;
    createTemporaryLocalFile(options: { fileExtension: string; prefix: string }): Promise<TemporaryFile>;
    createTemporaryLocalFile(fileExtension: string): Promise<TemporaryFile>;
    deleteLocalDirectory(dirname: string): Promise<void>;
    deleteLocalFile(path: string): Promise<void>;
    ensureLocalDir(path: string): Promise<void>;
    localDirectoryExists(dirname: string): Promise<boolean>;
    localFileExists(filename: string): Promise<boolean>;
    readLocalData(path: string): Promise<Buffer>;
    readLocalFile(path: string): Promise<string>;
    searchLocal(globPattern: string, cwd?: string, dot?: boolean): Promise<string[]>;
    writeLocalFile(path: string, text: string | Buffer): Promise<void>;

    // vscode.Uri-based filesystem utilities wrapping the VS Code filesystem API
    arePathsSame(path1: vscode.Uri, path2: vscode.Uri): boolean;
    copy(source: vscode.Uri, destination: vscode.Uri): Promise<void>;
    createDirectory(uri: vscode.Uri): Promise<void>;
    delete(uri: vscode.Uri): Promise<void>;
    readFile(uri: vscode.Uri): Promise<string>;
    stat(uri: vscode.Uri): Promise<vscode.FileStat>;
    writeFile(uri: vscode.Uri, text: string | Buffer): Promise<void>;
    getFiles(dir: vscode.Uri): Promise<vscode.Uri[]>;
}