// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

/* eslint-disable  */

import { createHash } from 'crypto';
import * as fs from 'fs-extra';
import { ReadStream, WriteStream } from 'fs-extra';
import * as path from '../../vscode-path/path';
import * as vscode from 'vscode';
import '../extensions';
import { createDirNotEmptyError, isFileExistsError } from './errors';
import { IRawFileSystem } from './types.node';

const ENCODING = 'utf8';

// This helper function determines the file type of the given stats
// object.  The type follows the convention of node's fs module, where
// a file has exactly one type.  Symlinks are not resolved.
export function convertFileType(stat: fs.Stats): vscode.FileType {
    if (stat.isFile()) {
        return vscode.FileType.File;
    } else if (stat.isDirectory()) {
        return vscode.FileType.Directory;
    } else if (stat.isSymbolicLink()) {
        // The caller is responsible for combining this ("logical or")
        // with File or Directory as necessary.
        return vscode.FileType.SymbolicLink;
    } else {
        return vscode.FileType.Unknown;
    }
}

export function convertStat(old: fs.Stats, filetype: vscode.FileType): vscode.FileStat {
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

//==========================================
// "raw" filesystem

// This is the parts of the vscode.workspace.fs API that we use here.
// See: https://code.visualstudio.com/api/references/vscode-api#FileSystem
// Note that we have used all the API functions *except* "rename()".
interface IVSCodeFileSystemAPI {
    copy(source: vscode.Uri, target: vscode.Uri, options?: { overwrite: boolean }): Thenable<void>;
    createDirectory(uri: vscode.Uri): Thenable<void>;
    delete(uri: vscode.Uri, options?: { recursive: boolean; useTrash: boolean }): Thenable<void>;
    readDirectory(uri: vscode.Uri): Thenable<[string, vscode.FileType][]>;
    readFile(uri: vscode.Uri): Thenable<Uint8Array>;
    rename(source: vscode.Uri, target: vscode.Uri, options?: { overwrite: boolean }): Thenable<void>;
    stat(uri: vscode.Uri): Thenable<vscode.FileStat>;
    writeFile(uri: vscode.Uri, content: Uint8Array): Thenable<void>;
}

// This is the parts of the 'fs-extra' module that we use in RawFileSystem.
interface IRawFSExtra {
    lstat(filename: string): Promise<fs.Stats>;
    chmod(filePath: string, mode: string | number): Promise<void>;
    appendFile(filename: string, data: {}): Promise<void>;

    // non-async
    lstatSync(filename: string): fs.Stats;
    statSync(filename: string): fs.Stats;
    readFileSync(path: string, encoding: string): string;
    createReadStream(filename: string): ReadStream;
    createWriteStream(filename: string): WriteStream;
}

// Later we will drop "FileSystem", switching usage to
// "FileSystemUtils" and then rename "RawFileSystem" to "FileSystem".

// The low-level filesystem operations used by the extension.
export class RawFileSystem implements IRawFileSystem {
    constructor(
        // the VS Code FS API to use
        protected readonly vscfs: IVSCodeFileSystemAPI,
        // the node FS API to use
        protected readonly fsExtra: IRawFSExtra
    ) {}

    // Create a new object using common-case default values.
    public static withDefaults(
        vscfs?: IVSCodeFileSystemAPI, // default: the actual "vscode.workspace.fs" namespace
        fsExtra?: IRawFSExtra // default: the "fs-extra" module
    ): RawFileSystem {
        return new RawFileSystem(
            vscfs || vscode.workspace.fs,
            // The "fs-extra" module is effectively equivalent to node's "fs"
            // module (but is a bit more async-friendly).  So we use that
            // instead of "fs".
            (fsExtra || fs) as any
        );
    }

    public async stat(filename: string): Promise<vscode.FileStat> {
        // Note that, prior to the November release of VS Code,
        // stat.ctime was always 0.
        // See: https://github.com/microsoft/vscode/issues/84525
        const uri = vscode.Uri.file(filename);
        return this.vscfs.stat(uri);
    }

    public async lstat(filename: string): Promise<vscode.FileStat> {
        // TODO https://github.com/microsoft/vscode/issues/71204 (84514)):
        //   This functionality has been requested for the VS Code API.
        const stat = await this.fsExtra.lstat(filename);
        // Note that, unlike stat(), lstat() does not include the type
        // of the symlink's target.
        const fileType = convertFileType(stat);
        return convertStat(stat, fileType);
    }

    public async chmod(filename: string, mode: string | number): Promise<void> {
        // TODO (https://github.com/microsoft/vscode/issues/73122 (84513)):
        //   This functionality has been requested for the VS Code API.
        return this.fsExtra.chmod(filename, mode);
    }

    public async move(src: string, tgt: string): Promise<void> {
        const srcUri = vscode.Uri.file(src);
        const tgtUri = vscode.Uri.file(tgt);
        // The VS Code API will automatically create the target parent
        // directory if it does not exist (even though the docs imply
        // otherwise).  So we have to manually stat, just to be sure.
        // Note that this behavior was reported, but won't be changing.
        // See: https://github.com/microsoft/vscode/issues/84177
        await this.vscfs.stat(vscode.Uri.file(path.dirname(tgt)));
        // We stick with the pre-existing behavior where files are
        // overwritten and directories are not.
        const options = { overwrite: false };
        try {
            await this.vscfs.rename(srcUri, tgtUri, options);
        } catch (err) {
            if (!isFileExistsError(err)) {
                throw err; // re-throw
            }
            const stat = await this.vscfs.stat(tgtUri);
            if (stat.type === vscode.FileType.Directory) {
                throw err; // re-throw
            }
            options.overwrite = true;
            await this.vscfs.rename(srcUri, tgtUri, options);
        }
    }

    public async readData(filename: string): Promise<Buffer> {
        const uri = vscode.Uri.file(filename);
        const data = await this.vscfs.readFile(uri);
        return Buffer.from(data);
    }

    public async readText(filename: string): Promise<string> {
        const uri = vscode.Uri.file(filename);
        const result = await this.vscfs.readFile(uri);
        const data = Buffer.from(result);
        return data.toString(ENCODING);
    }

    public async writeText(filename: string, text: string): Promise<void> {
        const uri = vscode.Uri.file(filename);
        const data = Buffer.from(text);
        await this.vscfs.writeFile(uri, data);
    }

    public async appendText(filename: string, text: string): Promise<void> {
        // TODO: We *could* use the new API for this.
        // See https://github.com/microsoft/vscode-python/issues/9900
        return this.fsExtra.appendFile(filename, text);
    }

    public async copyFile(src: string, dest: string): Promise<void> {
        const srcURI = vscode.Uri.file(src);
        const destURI = vscode.Uri.file(dest);
        // The VS Code API will automatically create the target parent
        // directory if it does not exist (even though the docs imply
        // otherwise).  So we have to manually stat, just to be sure.
        // Note that this behavior was reported, but won't be changing.
        // See: https://github.com/microsoft/vscode/issues/84177
        await this.vscfs.stat(vscode.Uri.file(path.dirname(dest)));
        await this.vscfs.copy(srcURI, destURI, {
            overwrite: true
        });
    }

    public async rmfile(filename: string): Promise<void> {
        const uri = vscode.Uri.file(filename);
        return this.vscfs.delete(uri, {
            recursive: false,
            useTrash: false
        });
    }

    public async rmdir(dirname: string): Promise<void> {
        const uri = vscode.Uri.file(dirname);
        // The "recursive" option disallows directories, even if they
        // are empty.  So we have to deal with this ourselves.
        const files = await this.vscfs.readDirectory(uri);
        if (files && files.length > 0) {
            throw createDirNotEmptyError(dirname);
        }
        return this.vscfs.delete(uri, {
            recursive: true,
            useTrash: false
        });
    }

    public async rmtree(dirname: string): Promise<void> {
        const uri = vscode.Uri.file(dirname);
        // TODO (https://github.com/microsoft/vscode/issues/84177):
        //   The docs say "throws - FileNotFound when uri doesn't exist".
        //   However, it happily does nothing.  So for now we have to
        //   manually stat, just to be sure.
        await this.vscfs.stat(uri);
        return this.vscfs.delete(uri, {
            recursive: true,
            useTrash: false
        });
    }

    public async mkdirp(dirname: string): Promise<void> {
        const uri = vscode.Uri.file(dirname);
        await this.vscfs.createDirectory(uri);
    }

    public async listdir(dirname: string): Promise<[string, vscode.FileType][]> {
        const uri = vscode.Uri.file(dirname);
        const files = await this.vscfs.readDirectory(uri);
        return files.map(([basename, filetype]) => {
            const filename = path.join(dirname, basename);
            return [filename, filetype] as [string, vscode.FileType];
        });
    }

    //****************************
    // non-async

    // VS Code has decided to never support any sync functions (aside
    // from perhaps create*Stream()).
    // See: https://github.com/microsoft/vscode/issues/84518

    public statSync(filename: string): vscode.FileStat {
        // We follow the filetype behavior of the VS Code API, by
        // acknowledging symlinks.
        let stat = this.fsExtra.lstatSync(filename);
        let filetype = vscode.FileType.Unknown;
        if (stat.isSymbolicLink()) {
            filetype = vscode.FileType.SymbolicLink;
            stat = this.fsExtra.statSync(filename);
        }
        filetype |= convertFileType(stat);
        return convertStat(stat, filetype);
    }

    public readTextSync(filename: string): string {
        return this.fsExtra.readFileSync(filename, ENCODING);
    }

    public createReadStream(filename: string): ReadStream {
        // TODO (https://github.com/microsoft/vscode/issues/84515):
        //   This functionality has been requested for the VS Code API.
        return this.fsExtra.createReadStream(filename);
    }

    public createWriteStream(filename: string): WriteStream {
        // TODO (https://github.com/microsoft/vscode/issues/84515):
        //   This functionality has been requested for the VS Code API.
        return this.fsExtra.createWriteStream(filename);
    }
}

// We *could* use ICryptoUtils, but it's a bit overkill, issue tracked
// in https://github.com/microsoft/vscode-python/issues/8438.
export function getHashString(data: string): string {
    const hash = createHash('sha512');
    hash.update(data);
    return hash.digest('hex');
}
