// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import * as vscode from 'vscode';
import { IExtensionContext, IHttpClient } from '../types';
import { arePathsSame, getHashString } from './fileUtils';
import { IFileSystem, TemporaryFileUri } from './types';
import * as uriPath from '../../vscode-path/resources';
import * as uuid from 'uuid/v4';
import { isFileNotFoundError } from './errors';
import { traceError } from '../../logging';

const ENCODING = 'utf8';

function ensureUri(path: string | vscode.Uri): vscode.Uri {
    if (typeof path === 'string') {
        return vscode.Uri.parse(path);
    }
    return path;
}

function ensureString(path: string | vscode.Uri): string {
    if (typeof path !== 'string') {
        return path.path;
    }
    return path;
}

/**
 * File system abstraction which wraps the VS Code API.
 */
@injectable()
export class FileSystem implements IFileSystem {
    protected vscfs: vscode.FileSystem;
    constructor(
        @inject(IExtensionContext) private readonly extensionContext: IExtensionContext,
        @inject(IHttpClient) private readonly httpClient: IHttpClient
    ) {
        this.vscfs = vscode.workspace.fs;
    }

    // API based on VS Code fs API
    arePathsSame(path1: string | vscode.Uri, path2: string | vscode.Uri): boolean {
        path1 = ensureUri(path1);
        path2 = ensureUri(path2);
        if (path1.scheme === 'file' && path1.scheme === path2.scheme) {
            // eslint-disable-next-line local-rules/dont-use-fspath
            return this.areLocalPathsSame(path1.fsPath, path2.fsPath);
        } else {
            return path1.toString() === path2.toString();
        }
    }

    areLocalPathsSame(path1: string | vscode.Uri, path2: string | vscode.Uri): boolean {
        return arePathsSame(ensureString(path1), ensureString(path2));
    }

    public async createLocalDirectory(path: string | vscode.Uri): Promise<void> {
        await this.createDirectory(path);
    }

    async copyLocal(source: string | vscode.Uri, destination: string | vscode.Uri): Promise<void> {
        const srcUri = ensureUri(source);
        const dstUri = ensureUri(destination);
        await this.vscfs.copy(srcUri, dstUri, { overwrite: true });
    }

    async deleteLocalFile(path: string | vscode.Uri): Promise<void> {
        const uri = ensureUri(path);
        return this.vscfs.delete(uri, {
            recursive: false,
            useTrash: false
        });
    }

    async readLocalData(filename: string | vscode.Uri): Promise<Buffer> {
        const uri = ensureUri(filename);
        const data = await this.vscfs.readFile(uri);
        return Buffer.from(data);
    }

    async readLocalFile(filename: string | vscode.Uri): Promise<string> {
        const uri = ensureUri(filename);
        return this.readFile(uri);
    }

    async writeLocalFile(filename: string | vscode.Uri, text: string | Buffer): Promise<void> {
        const uri = ensureUri(filename);
        return this.writeFile(uri, text);
    }

    async getFiles(dir: string | vscode.Uri): Promise<vscode.Uri[]> {
        const files = await this.vscfs.readDirectory(ensureUri(dir));
        return files.filter((f) => f[1] === vscode.FileType.File).map((f) => ensureUri(f[0]));
    }

    // URI-based filesystem functions

    async copy(source: string | vscode.Uri, destination: string | vscode.Uri): Promise<void> {
        await this.vscfs.copy(ensureUri(source), ensureUri(destination));
    }

    async createDirectory(uri: string | vscode.Uri): Promise<void> {
        await this.vscfs.createDirectory(ensureUri(uri));
    }

    async delete(uri: string | vscode.Uri): Promise<void> {
        await this.vscfs.delete(ensureUri(uri));
    }

    async readFile(uri: string | vscode.Uri): Promise<string> {
        const result = await this.vscfs.readFile(ensureUri(uri));
        const data = Buffer.from(result);
        return data.toString(ENCODING);
    }

    async stat(uri: string | vscode.Uri): Promise<vscode.FileStat> {
        return this.vscfs.stat(ensureUri(uri));
    }

    async writeFile(uri: string | vscode.Uri, text: string | Buffer): Promise<void> {
        const data = typeof text === 'string' ? Buffer.from(text) : text;
        return this.vscfs.writeFile(ensureUri(uri), data);
    }

    async createTemporaryFile(options: { fileExtension?: string; prefix?: string }): Promise<TemporaryFileUri> {
        // Global storage is guaranteed to be a writable location. Maybe the only one that works
        // for both web and node.
        const tmpFolder = uriPath.joinPath(this.extensionContext.globalStorageUri, 'tmp');
        await this.vscfs.createDirectory(tmpFolder);
        const fileUri = uriPath.joinPath(tmpFolder, `${options.prefix}-${uuid()}.${options.fileExtension}`);
        await this.writeFile(fileUri, '');

        // When disposing, the temporary file is destroyed
        return {
            file: fileUri,
            dispose: () => {
                return this.vscfs.delete(fileUri);
            }
        };
    }

    async exists(
        // the "file" to look for
        filename: string | vscode.Uri,
        // the file type to expect; if not provided then any file type
        // matches; otherwise a mismatch results in a "false" value
        fileType?: vscode.FileType
    ): Promise<boolean> {
        filename = ensureUri(filename);
        // Special case. http/https always returns stat true even if the file doesn't
        // exist. In those two cases use the http client instead
        if (filename.scheme.toLowerCase() === 'http' || filename.scheme.toLowerCase() === 'https') {
            return this.httpClient.exists(filename.toString());
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

    async getFileHash(filename: string | vscode.Uri): Promise<string> {
        // The reason for lstat rather than stat is not clear...
        const stat = await this.stat(filename);
        const data = `${stat.ctime}-${stat.mtime}`;
        return getHashString(data);
    }

    public async localDirectoryExists(dirname: string | vscode.Uri): Promise<boolean> {
        return this.exists(ensureUri(dirname), vscode.FileType.Directory);
    }

    public async localFileExists(filename: string | vscode.Uri): Promise<boolean> {
        return this.exists(ensureUri(filename), vscode.FileType.File);
    }
}
