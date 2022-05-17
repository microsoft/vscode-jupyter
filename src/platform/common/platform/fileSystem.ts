// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import * as vscode from 'vscode';
import { IExtensionContext } from '../types';
import { arePathsSame, getHashString } from './fileUtils';
import { IFileSystem, TemporaryFileUri } from './types';
import * as uriPath from '../../vscode-path/resources';
import * as uuid from 'uuid/v4';
import { isFileNotFoundError } from './errors';
import { traceError } from '../../logging';

const ENCODING = 'utf8';

/**
 * File system abstraction which wraps the VS Code API.
 */
@injectable()
export class FileSystem implements IFileSystem {
    protected vscfs: vscode.FileSystem;
    constructor(@inject(IExtensionContext) private readonly extensionContext: IExtensionContext) {
        this.vscfs = vscode.workspace.fs;
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

    async createTemporaryFile(options: { fileExtension?: string; prefix?: string }): Promise<TemporaryFileUri> {
        // In non node situations, temporary files are created in the globalStorageUri location (extension specific)
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
        filename: vscode.Uri,
        // the file type to expect; if not provided then any file type
        // matches; otherwise a mismatch results in a "false" value
        fileType?: vscode.FileType
    ): Promise<boolean> {
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
        return getHashString(data);
    }
}
