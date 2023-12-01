// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import * as vscode from 'vscode';
import { IFileSystem } from './types';
import * as uriPath from '../../vscode-path/resources';
import { isFileNotFoundError } from './errors';
import { traceError } from '../../logging';
import { computeHash } from '../crypto';
import { HttpClient } from '../net/httpClient';

export const ENCODING = 'utf8';

/**
 * File system abstraction which wraps the VS Code API.
 */
@injectable()
export class FileSystem implements IFileSystem {
    protected vscfs: vscode.FileSystem;
    constructor() {
        this.vscfs = vscode.workspace.fs;
    }

    // API based on VS Code fs API
    arePathsSame(path1: vscode.Uri, path2: vscode.Uri): boolean {
        return uriPath.isEqual(path1, path2);
    }

    async getFiles(dir: vscode.Uri): Promise<vscode.Uri[]> {
        const files = await this.vscfs.readDirectory(dir);
        return files.filter((f) => f[1] === vscode.FileType.File).map((f) => vscode.Uri.file(f[0]));
    }

    // URI-based filesystem functions

    async copy(source: vscode.Uri, destination: vscode.Uri, options?: { overwrite: boolean }): Promise<void> {
        await this.vscfs.copy(source, destination, options);
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

    async exists(
        // the "file" to look for
        filename: vscode.Uri,
        // the file type to expect; if not provided then any file type
        // matches; otherwise a mismatch results in a "false" value
        fileType?: vscode.FileType
    ): Promise<boolean> {
        // Special case. http/https always returns stat true even if the file doesn't
        // exist. In those two cases use the http client instead
        if (filename.scheme.toLowerCase() === 'http' || filename.scheme.toLowerCase() === 'https') {
            return new HttpClient().exists(filename.toString());
        }

        // Otherwise use stat
        let stat: vscode.FileStat;
        try {
            // Note that we are using stat() rather than lstat().  This
            // means that any symlinks are getting resolved.
            stat = await this.stat(filename);
        } catch (err) {
            if (isFileNotFoundError(err)) {
                return false;
            }
            traceError(`stat() failed for "${filename}"`, err);
            return false;
        }

        if (fileType === undefined) {
            return true;
        }
        if (fileType === vscode.FileType.Unknown) {
            // FileType.Unknown == 0, hence do not use bitwise operations.
            return stat.type === vscode.FileType.Unknown;
        }
        return (stat.type & fileType) === fileType;
    }

    async getFileHash(filename: vscode.Uri): Promise<string> {
        // The reason for lstat rather than stat is not clear...
        const stat = await this.stat(filename);
        const data = `${stat.ctime}-${stat.mtime}`;
        return computeHash(data, 'SHA-512');
    }
}
