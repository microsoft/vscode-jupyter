// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { ContentsManager } from '@jupyterlab/services';
import { inject, injectable, named } from 'inversify';
import {
    Disposable,
    Event,
    EventEmitter,
    FileChangeEvent,
    FileChangeType,
    FileStat,
    FileSystemError,
    FileType,
    Memento,
    Uri,
    workspace
} from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { traceError } from '../../common/logger';
import { GLOBAL_MEMENTO, IDisposable, IMemento } from '../../common/types';
import { noop } from '../../common/utils/misc';
import {
    DirectoryEntry,
    DirectoryResponse,
    FileEntry,
    IFileSystemProvider,
    IJupyterServerConnectionInfo,
    IJupyterServerAuthServiceProvider
} from './types';

export class File implements FileStat {
    public type: FileType;
    public ctime: number;
    public mtime: number;
    public size: number;
    public name: string;
    public path: string;
    public data?: Uint8Array;
    constructor(public readonly entry: Readonly<FileEntry>) {
        this.type = FileType.File;
        this.ctime = new Date(entry.created).getTime();
        this.mtime = new Date(entry.last_modified).getTime();
        this.size = entry.size;
        this.name = entry.name;
        this.path = entry.path;
    }
}

export class Directory implements FileStat {
    public type: FileType;
    public ctime: number;
    public mtime: number;
    public size: number;
    public name: string;
    public path: string;
    public get children(): (Directory | File)[] {
        if (Array.isArray(this.entry.content)) {
            const content = this.entry.content as (DirectoryEntry | FileEntry)[];
            return content.map((item) => (item.type === 'directory' ? new Directory(item) : new File(item)));
        } else {
            return [];
        }
    }
    constructor(public readonly entry: Readonly<DirectoryEntry | DirectoryResponse>) {
        this.type = FileType.Directory;
        this.ctime = new Date(entry.created).getTime();
        this.mtime = new Date(entry.last_modified).getTime();
        this.size = 0;
        this.name = entry.name;
        this.path = entry.path;
    }
}
export type Entry = File | Directory;

// tslint:disable-next-line: max-classes-per-file
export class RemoteFileSystem implements IFileSystemProvider {
    public get onDidChangeFile(): Event<FileChangeEvent[]> {
        return this._emitter.event;
    }
    public get isDisposed() {
        return this._isDisposed === true;
    }
    public get label() {
        return Uri.parse(this.baseUrl).authority;
    }
    public readonly rootFolder: Uri;
    private _isDisposed?: boolean;

    private _emitter = new EventEmitter<FileChangeEvent[]>();
    private _bufferedEvents: FileChangeEvent[] = [];
    private _fireSoonHandle?: NodeJS.Timer;
    private readonly disposables: IDisposable[] = [];
    private info?: Promise<IJupyterServerConnectionInfo>;

    constructor(
        public readonly scheme: string,
        private baseUrl: string,
        private readonly authService: IJupyterServerAuthServiceProvider,
        info?: IJupyterServerConnectionInfo
    ) {
        if (info) {
            this.info = Promise.resolve(info);
        }
        this.disposables.push(workspace.registerFileSystemProvider(scheme, this, { isCaseSensitive: true }));
        this.rootFolder = Uri.file('/').with({ scheme });
    }
    public dispose() {
        this._isDisposed = true;
        this._emitter.dispose();
        this.disposables.forEach((d) => d.dispose());
    }
    public async stat(uri: Uri): Promise<FileStat> {
        return this._lookup(uri, false);
    }

    public async readDirectory(uri: Uri): Promise<[string, FileType][]> {
        const dir = await this._lookup(uri, false, true);
        if (dir instanceof Directory) {
            let folders: [string, FileType][] = [];
            let files: [string, FileType][] = [];
            dir.children.forEach((child) => {
                if (child instanceof Directory) {
                    folders.push([child.name, FileType.Directory]);
                } else {
                    files.push([child.name, FileType.File]);
                }
            });
            folders = folders.sort((a, b) => (a[0].toLocaleLowerCase() > b[0].toLocaleLowerCase() ? 1 : -1));
            files = files.sort((a, b) => (a[0].toLocaleLowerCase() > b[0].toLocaleLowerCase() ? 1 : -1));
            return [...folders, ...files];
        } else {
            return [];
        }
    }

    public async readFile(uri: Uri): Promise<Uint8Array> {
        const file = await this._lookup(uri, false, true);
        if (file && file instanceof File) {
            let contents: string;
            if (file.entry.type === 'notebook' && file.entry.content && typeof file.entry.content === 'object') {
                contents = JSON.stringify(file.entry.content);
            } else if (typeof file.entry.content === 'string') {
                contents = file.entry.content;
            } else {
                const message = `Unable to determine content of ${uri.toString()}, with type ${typeof file.entry
                    .content}`;
                traceError(message);
                throw new Error(message);
            }
            return new TextEncoder().encode(contents);
        }
        throw FileSystemError.FileNotFound();
    }

    public async writeFile(
        uri: Uri,
        _content: Uint8Array,
        options: { create: boolean; overwrite: boolean }
    ): Promise<void> {
        // Support save as, new file, etc.
        // Check options.create // overwrite
        if (options.create) {
            return;
        } else {
            // const server = await this.getRemoteServer();
            // const file = await server.getFileOrDirectory(uri.fsPath);
            // if (!file) {
            //     throw FileSystemError.FileNotFound();
            // }
            // if (file.type === 'directory') {
            //     throw FileSystemError.FileIsADirectory();
            // }
            // await server.saveFile(file, new TextDecoder().decode(content));
        }
        // const basename = path.posix.basename(uri.path);
        // const parent = this._lookupParentDirectory(uri);
        // let entry = parent.entries.get(basename);
        // if (entry instanceof Directory) {
        //     throw FileSystemError.FileIsADirectory(uri);
        // }
        // if (!entry && !options.create) {
        //     throw FileSystemError.FileNotFound(uri);
        // }
        // if (entry && options.create && !options.overwrite) {
        //     throw FileSystemError.FileExists(uri);
        // }
        // if (!entry) {
        //     entry = new File(basename);
        //     parent.entries.set(basename, entry);
        //     this._fireSoon({ type: FileChangeType.Created, uri });
        // }
        // entry.mtime = Date.now();
        // entry.size = content.byteLength;
        // entry.data = content;

        this._fireSoon({ type: FileChangeType.Changed, uri });
    }

    // --- manage files/folders

    public rename(_oldUri: Uri, _newUri: Uri, _options: { overwrite: boolean }): void {
        // if (!options.overwrite && this._lookup(newUri, true)) {
        //     throw FileSystemError.FileExists(newUri);
        // }
        // const entry = this._lookup(oldUri, false);
        // const oldParent = this._lookupParentDirectory(oldUri);
        // const newParent = this._lookupParentDirectory(newUri);
        // const newName = path.posix.basename(newUri.path);
        // oldParent.entries.delete(entry.name);
        // entry.name = newName;
        // newParent.entries.set(newName, entry);
        // this._fireSoon({ type: FileChangeType.Deleted, uri: oldUri }, { type: FileChangeType.Created, uri: newUri });
    }

    public async delete(uri: Uri): Promise<void> {
        const entry = await this._lookup(uri, false);
        if (!entry) {
            throw FileSystemError.FileNotFound(uri);
        }
        const contentManager = await this.getContentManager();
        await contentManager.delete(uri.fsPath);
        this._fireSoon({ type: FileChangeType.Changed, uri }, { uri, type: FileChangeType.Deleted });
    }

    public createDirectory(_uri: Uri): void {
        // const basename = path.posix.basename(uri.path);
        // const dirname = uri.with({ path: path.posix.dirname(uri.path) });
        // const parent = this._lookupAsDirectory(dirname, false);
        // const entry = new Directory(basename);
        // parent.entries.set(entry.name, entry);
        // parent.mtime = Date.now();
        // parent.size += 1;
        // this._fireSoon({ type: FileChangeType.Changed, uri: dirname }, { type: FileChangeType.Created, uri });
    }

    public watch(_resource: Uri): Disposable {
        // ignore, fires for all changes...
        return { dispose: noop };
    }
    public async createNew(remotePath: Uri, type: 'file' | 'directory' | 'notebook'): Promise<Uri | undefined> {
        const contentManager = await this.getContentManager();
        const model = await contentManager.newUntitled({ type, path: remotePath.fsPath });
        if (model) {
            const uri = Uri.file(model.path).with({ scheme: this.scheme });
            this._fireSoon({ type: FileChangeType.Created, uri }, { uri: remotePath, type: FileChangeType.Changed });
            return uri;
        }
    }
    private async getRemoteServer(): Promise<IJupyterServerConnectionInfo> {
        if (!this.info) {
            const getRemoteServer = async () => {
                let servers = await this.authService.getRemoteConnections();
                let server = servers.find((item) => item.settings.baseUrl.toLowerCase() === this.baseUrl.toLowerCase());
                if (!server) {
                    await this.authService.addServer(this.baseUrl);
                }
                servers = await this.authService.getRemoteConnections();
                server = servers.find((item) => item.settings.baseUrl.toLowerCase() === this.baseUrl.toLowerCase());
                if (!server) {
                    // Don't resolve the promise.
                    // User did not log in, hence no need to load any FS & no need to return any data.
                    // tslint:disable-next-line: no-unnecessary-local-variable promise-must-complete
                    const promise = new Promise<IJupyterServerConnectionInfo>(() => noop);
                    return promise;
                }
                return server;
            };

            this.info = getRemoteServer();
        }
        return this.info!;
    }
    private async getContentManager() {
        const server = await this.getRemoteServer();
        return new ContentsManager({ serverSettings: server.settings });
    }

    // --- lookup

    private async _lookup(uri: Uri, silent: false, fetchContents?: boolean): Promise<Directory | File>;
    private async _lookup(uri: Uri, silent: boolean, fetchContents?: boolean): Promise<Directory | File | undefined>;
    private async _lookup(uri: Uri, _silent: boolean, fetchContents?: boolean): Promise<Directory | File | undefined> {
        const server = await this.getRemoteServer();
        const contentManager = new ContentsManager({ serverSettings: server.settings });
        const item = await contentManager.get(uri.fsPath, { content: fetchContents });
        if (item.type === 'directory') {
            return new Directory(item);
        } else {
            // tslint:disable-next-line: no-any
            return new File(item as any);
        }
    }

    private _fireSoon(...events: FileChangeEvent[]): void {
        this._bufferedEvents.push(...events);

        if (this._fireSoonHandle) {
            clearTimeout(this._fireSoonHandle);
        }

        this._fireSoonHandle = setTimeout(() => {
            this._emitter.fire(this._bufferedEvents);
            this._bufferedEvents.length = 0;
        }, 5);
    }
}

type FileSchemeBaseUri = {
    scheme: string;
    baseUrl: string;
};
// tslint:disable-next-line: max-classes-per-file
@injectable()
export class RemoteFileSystemFactory implements IExtensionSingleActivationService {
    private readonly fileSystemsByScheme = new Map<string, RemoteFileSystem>();
    constructor(
        @inject(IMemento) @named(GLOBAL_MEMENTO) private globalState: Memento,
        @inject(IJupyterServerAuthServiceProvider) private readonly authService: IJupyterServerAuthServiceProvider
    ) {}
    public async activate(): Promise<void> {
        const remoteJupyterFileSchemes = this.globalState.get<FileSchemeBaseUri[]>('REMOTE_JUPYTER_FILE_SCHEMES', []);
        if (Array.isArray(remoteJupyterFileSchemes) && remoteJupyterFileSchemes.length) {
            for (const remoteJupyterFileScheme of remoteJupyterFileSchemes) {
                if (this.fileSystemsByScheme.has(remoteJupyterFileScheme.scheme)) {
                    continue;
                }
                const fileSystem = new RemoteFileSystem(
                    remoteJupyterFileScheme.scheme,
                    remoteJupyterFileScheme.baseUrl,
                    this.authService
                );
                this.fileSystemsByScheme.set(remoteJupyterFileScheme.scheme, fileSystem);
            }
        }
    }
    public getOrCreateRemoteFileSystem(info: IJupyterServerConnectionInfo) {
        let fileSystem = this.fileSystemsByScheme.get(info.fileScheme);
        if (!fileSystem || fileSystem.isDisposed) {
            fileSystem = new RemoteFileSystem(info.fileScheme, info.settings.baseUrl, this.authService, info);
        }
        this.fileSystemsByScheme.set(info.fileScheme, fileSystem);
        const schemes = this.globalState.get<FileSchemeBaseUri[]>('REMOTE_JUPYTER_FILE_SCHEMES', []);
        schemes.push({ scheme: info.fileScheme, baseUrl: info.settings.baseUrl });
        // tslint:disable-next-line: no-suspicious-comment
        // BUG: Possible we log into another remote while this is getting updated.
        // Thus get the old schemes & we end up with the previous scheme not getting saved.
        this.globalState.update('REMOTE_JUPYTER_FILE_SCHEMES', schemes).then(noop, noop);
        return fileSystem;
    }
    public getRemoteFileSystem(scheme: string) {
        return this.fileSystemsByScheme.get(scheme);
    }
}
