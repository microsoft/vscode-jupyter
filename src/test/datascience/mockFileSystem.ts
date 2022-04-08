/* eslint-disable local-rules/dont-use-fspath */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import * as fsextra from 'fs-extra';
import * as path from '../../platform/vscode-path/path';
import { FileStat, FileType, Uri } from 'vscode';
import { FileSystem } from '../../platform/common/platform/fileSystem.node';
import { convertStat } from '../../platform/common/platform/fileSystemUtils.node';
import { createDeferred } from '../../platform/common/utils/async';

// This is necessary for unit tests and functional tests, since they
// do not run under VS Code so they do not have access to the actual
// "vscode" namespace.
export class FakeVSCodeFileSystemAPI {
    public isWritableFileSystem(_scheme: string): boolean | undefined {
        return;
    }
    public async readFile(uri: Uri): Promise<Uint8Array> {
        return fsextra.readFile(uri.fsPath);
    }
    public async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
        await fsextra.mkdirs(path.dirname(uri.fsPath));
        return fsextra.writeFile(uri.fsPath, Buffer.from(content));
    }
    public async delete(uri: Uri, _options?: { recursive: boolean; useTrash: boolean }): Promise<void> {
        return (
            fsextra
                // Make sure the file exists before deleting.
                .stat(uri.fsPath)
                .then(() => fsextra.remove(uri.fsPath))
        );
    }
    public async stat(uri: Uri): Promise<FileStat> {
        const filename = uri.fsPath;

        let filetype = FileType.Unknown;
        let stat = await fsextra.lstat(filename);
        if (stat.isSymbolicLink()) {
            filetype = FileType.SymbolicLink;
            stat = await fsextra.stat(filename);
        }
        if (stat.isFile()) {
            filetype |= FileType.File;
        } else if (stat.isDirectory()) {
            filetype |= FileType.Directory;
        }
        return convertStat(stat, filetype);
    }
    public async readDirectory(uri: Uri): Promise<[string, FileType][]> {
        const names: string[] = await fsextra.readdir(uri.fsPath);
        const promises = names.map((name) => {
            const filename = path.join(uri.fsPath, name);
            return (
                fsextra
                    // Get the lstat info and deal with symlinks if necessary.
                    .lstat(filename)
                    .then(async (stat) => {
                        let filetype = FileType.Unknown;
                        if (stat.isFile()) {
                            filetype = FileType.File;
                        } else if (stat.isDirectory()) {
                            filetype = FileType.Directory;
                        } else if (stat.isSymbolicLink()) {
                            filetype = FileType.SymbolicLink;
                            stat = await fsextra.stat(filename);
                            if (stat.isFile()) {
                                filetype |= FileType.File;
                            } else if (stat.isDirectory()) {
                                filetype |= FileType.Directory;
                            }
                        }
                        return [name, filetype] as [string, FileType];
                    })
                    .catch(() => [name, FileType.Unknown] as [string, FileType])
            );
        });
        return Promise.all(promises);
    }
    public async createDirectory(uri: Uri): Promise<void> {
        return fsextra.mkdirp(uri.fsPath);
    }
    public async copy(src: Uri, dest: Uri): Promise<void> {
        const deferred = createDeferred<void>();
        const rs = fsextra
            // Set an error handler on the stream.
            .createReadStream(src.fsPath)
            .on('error', (err) => {
                deferred.reject(err);
            });
        const ws = fsextra
            .createWriteStream(dest.fsPath)
            // Set an error & close handler on the stream.
            .on('error', (err) => {
                deferred.reject(err);
            })
            .on('close', () => {
                deferred.resolve();
            });
        rs.pipe(ws);
        return deferred.promise;
    }
    public async rename(src: Uri, dest: Uri): Promise<void> {
        return fsextra.rename(src.fsPath, dest.fsPath);
    }
}
export class MockFileSystem extends FileSystem {
    private contentOverloads = new Map<string, string>();

    constructor() {
        super();
        this.vscfs = new FakeVSCodeFileSystemAPI();
    }
    public async readLocalFile(filePath: string): Promise<string> {
        const contents = this.contentOverloads.get(this.getFileKey(filePath));
        if (contents) {
            return contents;
        }
        return super.readLocalFile(filePath);
    }
    public async writeLocalFile(filePath: string, contents: string): Promise<void> {
        this.contentOverloads.set(this.getFileKey(filePath), contents);
    }
    public async readFile(filePath: Uri): Promise<string> {
        const contents = this.contentOverloads.get(this.getFileKey(filePath.fsPath));
        if (contents) {
            return contents;
        }
        return super.readFile(filePath);
    }
    public addFileContents(filePath: string, contents: string): void {
        this.contentOverloads.set(filePath, contents);
    }
    private getFileKey(filePath: string): string {
        return filePath.toLowerCase();
    }
    public async localFileExists(filePath: string) {
        const exists = this.contentOverloads.has(this.getFileKey(filePath));
        if (exists) {
            return exists;
        }
        return super.localFileExists(filePath);
    }
}
