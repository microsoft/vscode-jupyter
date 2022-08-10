// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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
    arePathsSame(path1: vscode.Uri, path2: vscode.Uri): boolean;
    copy(source: vscode.Uri, destination: vscode.Uri, options?: { overwrite: boolean }): Promise<void>;
    createDirectory(uri: vscode.Uri): Promise<void>;
    delete(uri: vscode.Uri): Promise<void>;
    readFile(uri: vscode.Uri): Promise<string>;
    stat(uri: vscode.Uri): Promise<vscode.FileStat>;
    writeFile(uri: vscode.Uri, text: string | Buffer): Promise<void>;
    getFiles(dir: vscode.Uri): Promise<vscode.Uri[]>;
    createTemporaryFile(options: { fileExtension?: string; prefix?: string }): Promise<TemporaryFileUri>;
    exists(uri: vscode.Uri, fileType?: vscode.FileType): Promise<boolean>;
    getFileHash(filename: vscode.Uri): Promise<string>;
}
