import * as vscode from 'vscode';
import { inject, injectable } from 'inversify';
import { FileSystem as FileSystemBase } from './fileSystem';
import { IExtensionContext } from '../types';
import { createDirNotEmptyError, isFileNotFoundError } from './errors';
import { traceError } from '../../logging';
import { IFileSystem } from './types';

/**
 * File system abstraction which wraps the VS Code API.
 */
@injectable()
export class FileSystem extends FileSystemBase implements IFileSystem {
    constructor(@inject(IExtensionContext) private readonly context: IExtensionContext) {
        super();
        this.rootDirectory = this.context.extensionUri.path;
    }

    public override normalize(path: string) {
        return vscode.Uri.parse(path);
    }

    public override async getFiles(dir: vscode.Uri): Promise<vscode.Uri[]> {
        const files = await this.vscfs.readDirectory(dir);
        return files.filter((f) => f[1] === vscode.FileType.File).map((f) => this.normalize(f[0]));
    }

    public override async copyLocal(source: string, destination: string): Promise<void> {
        const srcUri = this.normalize(source);
        const dstUri = this.normalize(destination);
        await this.vscfs.copy(srcUri, dstUri, { overwrite: true });
    }

    public async deleteLocalDirectory(dirname: string) {
        const uri = this.normalize(dirname);
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

    public override async deleteLocalFile(path: string): Promise<void> {
        const uri = this.normalize(path);
        return this.vscfs.delete(uri, {
            recursive: false,
            useTrash: false
        });
    }

    public async localDirectoryExists(dirname: string): Promise<boolean> {
        return this.localPathExists(dirname, vscode.FileType.Directory);
    }

    public async localFileExists(filename: string): Promise<boolean> {
        return this.localPathExists(filename, vscode.FileType.File);
    }

    public override async readLocalFile(filename: string): Promise<string> {
        const uri = this.normalize(filename);
        return this.readFile(uri);
    }

    public override async writeLocalFile(filename: string, text: string): Promise<void> {
        const uri = this.normalize(filename);
        return this.writeFile(uri, text);
    }

    public override async readFile(uri: vscode.Uri): Promise<string> {
        const result = await this.vscfs.readFile(uri);
        return new TextDecoder().decode(result);
    }

    public override async writeFile(uri: vscode.Uri, text: string): Promise<void> {
        return this.vscfs.writeFile(uri, new TextEncoder().encode(text));
    }

    public async localPathExists(
        // the "file" to look for
        filename: string,
        // the file type to expect; if not provided then any file type
        // matches; otherwise a mismatch results in a "false" value
        fileType?: vscode.FileType
    ): Promise<boolean> {
        let statResult: vscode.FileStat;
        try {
            // Note that we are using stat() rather than lstat().  This
            // means that any symlinks are getting resolved.
            const uri = this.normalize(filename);
            statResult = await this.stat(uri);
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
            return statResult.type === vscode.FileType.Unknown;
        }
        return (statResult.type & fileType) === fileType;
    }
}
