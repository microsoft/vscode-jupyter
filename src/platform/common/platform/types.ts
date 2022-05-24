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

export type TemporaryFileUri = { file: vscode.Uri } & vscode.Disposable;
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
    areLocalPathsSame(path1: string | vscode.Uri, path2: string | vscode.Uri): boolean;
    createLocalDirectory(path: string | vscode.Uri): Promise<void>;
    copyLocal(source: string | vscode.Uri, destination: string | vscode.Uri): Promise<void>;
    localDirectoryExists(dirname: string | vscode.Uri): Promise<boolean>;
    localFileExists(filename: string | vscode.Uri): Promise<boolean>;
    deleteLocalFile(path: string | vscode.Uri): Promise<void>;
    readLocalData(path: string | vscode.Uri): Promise<Buffer>;
    readLocalFile(path: string | vscode.Uri): Promise<string>;
    writeLocalFile(path: string | vscode.Uri, text: string | Buffer): Promise<void>;
    arePathsSame(path1: string | vscode.Uri, path2: string | vscode.Uri): boolean;
    copy(source: string | vscode.Uri, destination: string | vscode.Uri): Promise<void>;
    createDirectory(path: string | vscode.Uri): Promise<void>;
    delete(path: string | vscode.Uri): Promise<void>;
    readFile(path: string | vscode.Uri): Promise<string>;
    stat(path: string | vscode.Uri): Promise<vscode.FileStat>;
    writeFile(path: string | vscode.Uri, text: string | Buffer): Promise<void>;
    getFiles(dir: string | vscode.Uri): Promise<vscode.Uri[]>;
    createTemporaryFile(options: { fileExtension?: string; prefix?: string }): Promise<TemporaryFileUri>;
    exists(path: string | vscode.Uri, fileType?: vscode.FileType): Promise<boolean>;
    getFileHash(path: string | vscode.Uri): Promise<string>;
}
