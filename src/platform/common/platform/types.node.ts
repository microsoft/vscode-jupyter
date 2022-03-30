// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as fs from 'fs';
import * as vscode from 'vscode';
import { TemporaryFile } from './types';

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
