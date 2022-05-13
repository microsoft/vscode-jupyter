// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { injectable } from 'inversify';
import * as vscode from 'vscode';
import { arePathsSame } from './fileUtils';
import { IFileSystem, TemporaryFile } from './types';

const ENCODING = 'utf8';

/**
 * File system abstraction which wraps the VS Code API.
 */
@injectable()
export class FileSystem implements IFileSystem {
    protected vscfs: vscode.FileSystem;
    constructor() {
        this.vscfs = vscode.workspace.fs;
    }

    createTemporaryLocalFile(options: { fileExtension: string; prefix: string }): Promise<TemporaryFile>;
    createTemporaryLocalFile(fileExtension: string): Promise<TemporaryFile>;
    createTemporaryLocalFile(_fileExtension: unknown): Promise<import('./types').TemporaryFile> {
        throw new Error('Method not supported on Web.');
    }

    ensureLocalDir(_path: string): Promise<void> {
        throw new Error('Method not supported on Web.');
    }
    localDirectoryExists(_dirname: string): Promise<boolean> {
        throw new Error('Method not supported on Web.');
    }
    localFileExists(_filename: string): Promise<boolean> {
        throw new Error('Method not supported on Web.');
    }
    searchLocal(_globPattern: string, _cwd?: string | undefined, _dot?: boolean | undefined): Promise<string[]> {
        throw new Error('Method not supported on Web.');
    }

    // API based on VS Code fs API
    arePathsSame(path1: vscode.Uri, path2: vscode.Uri): boolean {
        if (path1.scheme === 'file' && path1.scheme === path2.scheme) {
            // eslint-disable-next-line local-rules/dont-use-fspath
            return this.areLocalPathsSame(path1.fsPath, path2.fsPath);
        } else {
            return path1.toString() === path2.toString();
        }
    }

    areLocalPathsSame(path1: string, path2: string): boolean {
        return arePathsSame(path1, path2);
    }

    async createLocalDirectory(path: string): Promise<void> {
        await this.createDirectory(vscode.Uri.file(path));
    }

    async deleteLocalDirectory(dirname: string) {
        const uri = vscode.Uri.file(dirname);
        // The "recursive" option disallows directories, even if they
        // are empty.  So we have to deal with this ourselves.
        const files = await this.vscfs.readDirectory(uri);
        if (files && files.length > 0) {
            throw new Error(`directory "${dirname}" not empty`);
        }
        return this.vscfs.delete(uri, {
            recursive: true,
            useTrash: false
        });
    }

    async copyLocal(source: string, destination: string): Promise<void> {
        const srcUri = vscode.Uri.file(source);
        const dstUri = vscode.Uri.file(destination);
        await this.vscfs.copy(srcUri, dstUri, { overwrite: true });
    }

    async deleteLocalFile(path: string): Promise<void> {
        const uri = vscode.Uri.file(path);
        return this.vscfs.delete(uri, {
            recursive: false,
            useTrash: false
        });
    }

    async readLocalData(filename: string): Promise<Buffer> {
        const uri = vscode.Uri.file(filename);
        const data = await this.vscfs.readFile(uri);
        return Buffer.from(data);
    }

    async readLocalFile(filename: string): Promise<string> {
        const uri = vscode.Uri.file(filename);
        return this.readFile(uri);
    }

    async writeLocalFile(filename: string, text: string | Buffer): Promise<void> {
        const uri = vscode.Uri.file(filename);
        return this.writeFile(uri, text);
    }

    async getFiles(dir: vscode.Uri): Promise<vscode.Uri[]> {
        const files = await this.vscfs.readDirectory(dir);
        return files.filter((f) => f[1] === vscode.FileType.File).map((f) => vscode.Uri.file(f[0]));
    }

    // URI-based filesystem functions

    async copy(source: vscode.Uri, destination: vscode.Uri): Promise<void> {
        await this.vscfs.copy(source, destination);
    }

    async createDirectory(uri: vscode.Uri): Promise<void> {
        await this.vscfs.createDirectory(uri);
    }

    async delete(uri: vscode.Uri): Promise<void> {
        await this.vscfs.delete(uri);
    }

    async readFile(uri: vscode.Uri): Promise<string> {
        const result = await this.vscfs.readFile(uri);
        const data = Buffer.from(result);
        return data.toString(ENCODING);
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        return this.vscfs.stat(uri);
    }

    async writeFile(uri: vscode.Uri, text: string | Buffer): Promise<void> {
        const data = typeof text === 'string' ? Buffer.from(text) : text;
        return this.vscfs.writeFile(uri, data);
    }
}
