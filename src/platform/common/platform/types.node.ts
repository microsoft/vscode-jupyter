// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as fs from 'fs';
import { IFileSystem, TemporaryFile } from './types';

//===========================
// filesystem operations

export type ReadStream = fs.ReadStream;
export type WriteStream = fs.WriteStream;

export const IFileSystemNode = Symbol('IFileSystemNode');
export interface IFileSystemNode extends IFileSystem {
    areLocalPathsSame(path1: string, path2: string): boolean;
    createLocalDirectory(path: string): Promise<void>;
    copyLocal(source: string, destination: string): Promise<void>;
    deleteLocalFile(path: string): Promise<void>;
    readLocalData(path: string): Promise<Buffer>;
    readLocalFile(path: string): Promise<string>;
    writeLocalFile(path: string, text: string | Buffer): Promise<void>;
    appendLocalFile(path: string, text: string): Promise<void>;
    createLocalWriteStream(path: string): WriteStream;
    createTemporaryLocalFile(options: { fileExtension: string; prefix: string }): Promise<TemporaryFile>;
    createTemporaryLocalFile(fileExtension: string): Promise<TemporaryFile>;
    deleteLocalDirectory(dirname: string): Promise<void>;
    ensureLocalDir(path: string): Promise<void>;
    localDirectoryExists(dirname: string): Promise<boolean>;
    localFileExists(filename: string): Promise<boolean>;
    searchLocal(globPattern: string, cwd?: string, dot?: boolean): Promise<string[]>;
}
