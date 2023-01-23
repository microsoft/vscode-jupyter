// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from 'fs';
import { IFileSystem, TemporaryFile } from './types';

//===========================
// filesystem operations
export type WriteStream = fs.WriteStream;

export const IFileSystemNode = Symbol('IFileSystemNode');
export interface IFileSystemNode extends IFileSystem {
    createLocalWriteStream(path: string): WriteStream;
    createTemporaryLocalFile(options: { fileExtension: string; prefix: string }): Promise<TemporaryFile>;
    createTemporaryLocalFile(fileExtension: string): Promise<TemporaryFile>;
    searchLocal(globPattern: string, cwd?: string, dot?: boolean): Promise<string[]>;
}
