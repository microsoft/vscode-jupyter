import * as fs from 'fs-extra';
import * as glob from 'glob';
import { inject, injectable } from 'inversify';
import * as tmp from 'tmp';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { TemporaryFile } from './types';
import { IFileSystemNode } from './types.node';
import { FileSystem as FileSystemBase } from './fileSystem';
import { IExtensionContext, IHttpClient } from '../types';
import { arePathsSame } from './fileUtils.node';

/**
 * File system abstraction which wraps the VS Code API.
 * IMPORTANT: Local functions can only be used in Node.js
 */
@injectable()
export class FileSystem extends FileSystemBase implements IFileSystemNode {
    private globFiles: (pat: string, options?: { cwd: string; dot?: boolean }) => Promise<string[]>;
    constructor(@inject(IExtensionContext) context: IExtensionContext, @inject(IHttpClient) httpClient: IHttpClient) {
        super(context, httpClient);
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
        await new Promise((resolve) => fs.rm(dirname, { force: true, recursive: true }, resolve));
    }

    public async ensureLocalDir(path: string): Promise<void> {
        return fs.ensureDir(path);
    }

    public async localDirectoryExists(dirname: string): Promise<boolean> {
        return this.exists(vscode.Uri.file(dirname), vscode.FileType.Directory);
    }

    public async localFileExists(filename: string): Promise<boolean> {
        return this.exists(vscode.Uri.file(filename), vscode.FileType.File);
    }
    public async deleteLocalFile(path: string): Promise<void> {
        await fs.unlink(path);
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

    areLocalPathsSame(path1: string, path2: string): boolean {
        return arePathsSame(path1, path2);
    }

    public async createLocalDirectory(path: string): Promise<void> {
        await this.createDirectory(vscode.Uri.file(path));
    }

    async copyLocal(source: string, destination: string): Promise<void> {
        const srcUri = vscode.Uri.file(source);
        const dstUri = vscode.Uri.file(destination);
        await this.vscfs.copy(srcUri, dstUri, { overwrite: true });
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
}
