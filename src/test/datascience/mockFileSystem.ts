// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable local-rules/dont-use-fspath */

'use strict';

import * as fsextra from 'fs-extra';
import * as path from '../../platform/vscode-path/path';
import { FileStat, FileType, Uri } from 'vscode';
import { createDeferred } from '../../platform/common/utils/async';

export function convertStat(old: fsextra.Stats, filetype: FileType): FileStat {
    return {
        type: filetype,
        size: old.size,
        // FileStat.ctime and FileStat.mtime only have 1-millisecond
        // resolution, while node provides nanosecond resolution.  So
        // for now we round to the nearest integer.
        // See: https://github.com/microsoft/vscode/issues/84526
        ctime: Math.round(old.ctimeMs),
        mtime: Math.round(old.mtimeMs)
    };
}

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
