// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as fs from 'fs';
import * as vscode from 'vscode';
import { IFileSystem, TemporaryFile } from './types';

//===========================
// filesystem operations

export import FileType = vscode.FileType;
export type ReadStream = fs.ReadStream;
export type WriteStream = fs.WriteStream;

export const IFileSystemNode = Symbol('IFileSystemNode');
export interface IFileSystemNode extends IFileSystem {
    appendLocalFile(path: string, text: string): Promise<void>;
    createLocalWriteStream(path: string): WriteStream;
    createTemporaryLocalFile(options: { fileExtension: string; prefix: string }): Promise<TemporaryFile>;
    createTemporaryLocalFile(fileExtension: string): Promise<TemporaryFile>;
    deleteLocalDirectory(dirname: string): Promise<void>;
    ensureLocalDir(path: string): Promise<void>;
    getFileHash(filename: string): Promise<string>;
    localDirectoryExists(dirname: string): Promise<boolean>;
    localFileExists(filename: string): Promise<boolean>;
    searchLocal(globPattern: string, cwd?: string, dot?: boolean): Promise<string[]>;
}
