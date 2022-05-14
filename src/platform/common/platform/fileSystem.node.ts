import * as fs from 'fs-extra';
import * as glob from 'glob';
import { injectable } from 'inversify';
import * as tmp from 'tmp';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { traceError } from '../../logging';
import { createDirNotEmptyError, isFileNotFoundError } from './errors.node';
import { convertFileType, convertStat, getHashString } from './fileSystemUtils.node';
import { TemporaryFile } from './types';
import { FileType, IFileSystemNode } from './types.node';
import { FileSystem as FileSystemBase } from './fileSystem';

/**
 * File system abstraction which wraps the VS Code API.
 */
@injectable()
export class FileSystem extends FileSystemBase implements IFileSystemNode {
    private globFiles: (pat: string, options?: { cwd: string; dot?: boolean }) => Promise<string[]>;
    constructor() {
        super();
        this.globFiles = promisify(glob);
    }

    public async appendLocalFile(path: string, text: string): Promise<void> {
        return fs.appendFile(path, text);
    }

    public createLocalWriteStream(path: string): fs.WriteStream {
        return fs.createWriteStream(path);
    }

    public async createTemporaryLocalFile(
        options: string | { fileExtension: string; prefix: string }
    ): Promise<TemporaryFile> {
        const suffix = typeof options === 'string' ? options : options.fileExtension;
        const prefix = options && typeof options === 'object' ? options.prefix : undefined;
        const opts: tmp.Options = {
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

    public async deleteLocalDirectory(dirname: string) {
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

    public async ensureLocalDir(path: string): Promise<void> {
        return fs.ensureDir(path);
    }

    public async getFileHash(filename: string): Promise<string> {
        // The reason for lstat rather than stat is not clear...
        const stat = await this.lstat(filename);
        const data = `${stat.ctime}-${stat.mtime}`;
        return getHashString(data);
    }

    public async localDirectoryExists(dirname: string): Promise<boolean> {
        return this.localPathExists(dirname, FileType.Directory);
    }

    public async localFileExists(filename: string): Promise<boolean> {
        return this.localPathExists(filename, FileType.File);
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

    private async lstat(filename: string): Promise<vscode.FileStat> {
        // eslint-disable-next-line
        // TODO https://github.com/microsoft/vscode/issues/71204 (84514)):
        //   This functionality has been requested for the VS Code API.
        const stat = await fs.lstat(filename);
        // Note that, unlike stat(), lstat() does not include the type
        // of the symlink's target.
        const fileType = convertFileType(stat);
        return convertStat(stat, fileType);
    }

    private async localPathExists(
        // the "file" to look for
        filename: string,
        // the file type to expect; if not provided then any file type
        // matches; otherwise a mismatch results in a "false" value
        fileType?: FileType
    ): Promise<boolean> {
        let stat: vscode.FileStat;
        try {
            // Note that we are using stat() rather than lstat().  This
            // means that any symlinks are getting resolved.
            const uri = vscode.Uri.file(filename);
            stat = await this.stat(uri);
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
        if (fileType === FileType.Unknown) {
            // FileType.Unknown == 0, hence do not use bitwise operations.
            return stat.type === FileType.Unknown;
        }
        return (stat.type & fileType) === fileType;
    }
}
