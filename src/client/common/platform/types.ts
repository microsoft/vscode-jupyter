// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as fs from 'fs';
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
    readonly pathVariableName: 'Path' | 'PATH';
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

//===========================
// filesystem operations

export import FileType = vscode.FileType;
export import FileStat = vscode.FileStat;
export type ReadStream = fs.ReadStream;
export type WriteStream = fs.WriteStream;

// The low-level filesystem operations on which the extension depends.
export interface IRawFileSystem {
    // Get information about a file (resolve symlinks).
    stat(filename: string): Promise<FileStat>;
    // Get information about a file (do not resolve synlinks).
    lstat(filename: string): Promise<FileStat>;
    // Change a file's permissions.
    chmod(filename: string, mode: string | number): Promise<void>;
    // Move the file to a different location (and/or rename it).
    move(src: string, tgt: string): Promise<void>;

    //***********************
    // files

    // Return the raw bytes of the given file.
    readData(filename: string): Promise<Buffer>;
    // Return the text of the given file (decoded from UTF-8).
    readText(filename: string): Promise<string>;
    // Write the given text to the file (UTF-8 encoded).
    writeText(filename: string, data: {}): Promise<void>;
    // Write the given text to the end of the file (UTF-8 encoded).
    appendText(filename: string, text: string): Promise<void>;
    // Copy a file.
    copyFile(src: string, dest: string): Promise<void>;
    // Delete a file.
    rmfile(filename: string): Promise<void>;

    //***********************
    // directories

    // Create the directory and any missing parent directories.
    mkdirp(dirname: string): Promise<void>;
    // Delete the directory if empty.
    rmdir(dirname: string): Promise<void>;
    // Delete the directory and everything in it.
    rmtree(dirname: string): Promise<void>;
    // Return the contents of the directory.
    listdir(dirname: string): Promise<[string, FileType][]>;

    //***********************
    // not async

    // Get information about a file (resolve symlinks).
    statSync(filename: string): FileStat;
    // Return the text of the given file (decoded from UTF-8).
    readTextSync(filename: string): string;
    // Create a streaming wrappr around an open file (for reading).
    createReadStream(filename: string): ReadStream;
    // Create a streaming wrappr around an open file (for writing).
    createWriteStream(filename: string): WriteStream;
}

export const IFileSystem = Symbol('IFileSystem');
export interface IFileSystem {
    // Local-only filesystem utilities
    appendLocalFile(path: string, text: string): Promise<void>;
    areLocalPathsSame(path1: string, path2: string): boolean;
    createLocalDirectory(path: string): Promise<void>;
    createLocalWriteStream(path: string): WriteStream;
    copyLocal(source: string, destination: string): Promise<void>;
    createTemporaryLocalFile(fileExtension: string, mode?: number): Promise<TemporaryFile>;
    deleteLocalDirectory(dirname: string): Promise<void>;
    deleteLocalFile(path: string): Promise<void>;
    ensureLocalDir(path: string): Promise<void>;
    getDisplayName(path: string): string;
    getFileHash(path: string): Promise<string>;
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
    stat(uri: vscode.Uri): Promise<FileStat>;
    writeFile(uri: vscode.Uri, text: string | Buffer): Promise<void>;
    getFiles(dir: vscode.Uri): Promise<vscode.Uri[]>;
}
