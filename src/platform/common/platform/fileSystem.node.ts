// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from '../../../platform/vscode-path/path';
import * as fs from 'fs-extra';
import glob from 'glob';
import { injectable } from 'inversify';
import * as tmp from 'tmp';
import { promisify } from 'util';
import { TemporaryFile } from './types';
import { IFileSystemNode } from './types.node';
import { ENCODING, FileSystem as FileSystemBase } from './fileSystem';
import { FileType, Uri } from 'vscode';
import { getFilePath } from './fs-paths';

/**
 * File system abstraction which wraps the VS Code API.
 * IMPORTANT: Local functions can only be used in Node.js. In the browser there is no local file system.
 */
@injectable()
export class FileSystem extends FileSystemBase implements IFileSystemNode {
    private globFiles: (pat: string, options?: { cwd: string; dot?: boolean }) => Promise<string[]>;
    constructor() {
        super();
        this.globFiles = promisify(glob);
    }

    public createLocalWriteStream(path: string): fs.WriteStream {
        return fs.createWriteStream(path);
    }

    public async createTemporaryLocalFile(
        options: string | { fileExtension: string; prefix: string }
    ): Promise<TemporaryFile> {
        const suffix = typeof options === 'string' ? options : options.fileExtension;
        const prefix = options && typeof options === 'object' ? options.prefix : undefined;
        const opts: tmp.FileOptions = {
            postfix: suffix,
            prefix
        };
        return new Promise<TemporaryFile>((resolve, reject) => {
            tmp.file(opts, (err, filename, _fd, cleanUp) => {
                if (err) {
                    return reject(err);
                }
                resolve({
                    filePath: filename,
                    dispose: cleanUp
                });
            });
        });
    }

    public async searchLocal(globPattern: string, cwd?: string, dot?: boolean): Promise<string[]> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let options: any;
        if (cwd) {
            options = { ...options, cwd };
        }
        if (dot) {
            options = { ...options, dot };
        }

        const found = await this.globFiles(globPattern, options);
        return Array.isArray(found) ? found : [];
    }

    async writeLocalFile(filename: string, text: string | Buffer): Promise<void> {
        await fs.ensureDir(path.dirname(filename));
        return fs.writeFile(filename, text);
    }

    override async readFile(uri: Uri): Promise<string> {
        if (isLocalFile(uri)) {
            const result = await fs.readFile(getFilePath(uri));
            const data = Buffer.from(result);
            return data.toString(ENCODING);
        } else {
            return super.readFile(uri);
        }
    }

    override async delete(uri: Uri): Promise<void> {
        if (isLocalFile(uri)) {
            if (await this.exists(uri)) {
                const stat = await this.stat(uri);
                if (stat.type === FileType.Directory) {
                    await new Promise((resolve) => fs.rm(getFilePath(uri), { force: true, recursive: true }, resolve));
                } else {
                    await fs.unlink(getFilePath(uri));
                }
            }
        } else {
            await super.delete(uri);
        }
    }

    override async exists(filename: Uri, fileType?: FileType | undefined): Promise<boolean> {
        if (isLocalFile(filename)) {
            return fs.pathExists(getFilePath(filename));
        } else {
            return super.exists(filename, fileType);
        }
    }
    override async createDirectory(uri: Uri): Promise<void> {
        if (isLocalFile(uri)) {
            await fs.ensureDir(getFilePath(uri));
        } else {
            await this.vscfs.createDirectory(uri);
        }
    }
    override async writeFile(uri: Uri, text: string | Buffer): Promise<void> {
        if (isLocalFile(uri)) {
            const filename = getFilePath(uri);
            await fs.ensureDir(path.dirname(filename));
            return fs.writeFile(filename, text);
        } else {
            await this.vscfs.writeFile(uri, typeof text === 'string' ? Buffer.from(text) : text);
        }
    }
    override async copy(source: Uri, destination: Uri, options?: { overwrite: boolean }): Promise<void> {
        if (isLocalFile(source) && isLocalFile(destination)) {
            const overwrite =
                typeof options === undefined || typeof options?.overwrite == undefined ? true : options?.overwrite;
            await fs.copy(getFilePath(source), getFilePath(destination), { overwrite });
        } else {
            await super.copy(source, destination, options);
        }
    }
}

function isLocalFile(uri: Uri) {
    return uri.scheme === 'file';
}
