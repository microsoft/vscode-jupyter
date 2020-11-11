// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Contents } from '@jupyterlab/services';
import {
    Disposable,
    Event,
    EventEmitter,
    FileChangeEvent,
    FileChangeType,
    FileStat,
    FileSystemError,
    FileType,
    Uri,
    workspace
} from 'vscode';
import { traceError } from '../../common/logger';
import { IDisposable } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { RemoteFileSchemeManager } from '../connection/fileSchemeManager';
import { JupyterServerConnectionService } from '../connection/remoteConnectionsService';
import { DirectoryEntry, DirectoryResponse, FileEntry, IFileSystemProvider } from './types';

export class File implements FileStat {
    public type: FileType;
    public ctime: number;
    public mtime: number;
    public size: number;
    public name: string;
    public path: string;
    public data?: Uint8Array;
    public readonly format: Contents.FileFormat;
    constructor(public readonly entry: Readonly<FileEntry>) {
        this.type = FileType.File;
        this.format = entry.format;
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

export class RemoteFileSystem implements IFileSystemProvider {
    public get onDidChangeFile(): Event<FileChangeEvent[]> {
        return this._emitter.event;
    }
    public get isDisposed() {
        return this._isDisposed === true;
    }
    public readonly rootFolder: Uri;
    private _isDisposed?: boolean;

    private _emitter = new EventEmitter<FileChangeEvent[]>();
    private _bufferedEvents: FileChangeEvent[] = [];
    private _fireSoonHandle?: NodeJS.Timer | number;
    private readonly disposables: IDisposable[] = [];
    private jupyterServerConnectionId?: Promise<string>;

    constructor(
        jupyterServerConnectionId: string | undefined,
        public readonly scheme: string,
        private readonly remoteConnections: JupyterServerConnectionService,
        private readonly fileSchemeManager: RemoteFileSchemeManager
    ) {
        if (jupyterServerConnectionId) {
            this.jupyterServerConnectionId = Promise.resolve(jupyterServerConnectionId);
        }
        // Lets assume case sensitivity for the moment (at the end of the day we're using jlab API, hence we're guarded by their API).
        this.disposables.push(workspace.registerFileSystemProvider(scheme, this, { isCaseSensitive: true }));
        this.rootFolder = Uri.file('/').with({ scheme });
    }
    public dispose() {
        if (this._fireSoonHandle) {
            // tslint:disable-next-line: no-any
            clearTimeout(this._fireSoonHandle as any);
        }
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
            if (
                file.entry.type === 'notebook' &&
                file.format === 'json' &&
                file.entry.content &&
                typeof file.entry.content === 'object'
            ) {
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
        _options: { create: boolean; overwrite: boolean }
    ): Promise<void> {
        this._fireSoon({ type: FileChangeType.Changed, uri });
    }

    public rename(_oldUri: Uri, _newUri: Uri, _options: { overwrite: boolean }): void {
        // this._fireSoon({ type: FileChangeType.Deleted, uri: oldUri }, { type: FileChangeType.Created, uri: newUri });
    }

    public async delete(uri: Uri): Promise<void> {
        const entry = await this._lookup(uri, false);
        if (!entry) {
            throw FileSystemError.FileNotFound(uri);
        }
        const contentManager = await this.getContentManager();
        try {
            await contentManager.delete(uri.fsPath);
            this._fireSoon({ type: FileChangeType.Changed, uri }, { uri, type: FileChangeType.Deleted });
        } finally {
            contentManager.dispose();
        }
    }

    // tslint:disable-next-line: no-empty
    public createDirectory(_uri: Uri): void {}

    public watch(_resource: Uri): Disposable {
        // ignore, fires for all changes...
        return { dispose: noop };
    }
    public async createNew(remotePath: Uri, type: 'file' | 'directory' | 'notebook'): Promise<Uri | undefined> {
        const contentManager = await this.getContentManager();
        try {
            const model = await contentManager.newUntitled({ type, path: remotePath.fsPath });
            if (model) {
                const uri = Uri.file(model.path).with({ scheme: this.scheme });
                this._fireSoon(
                    { type: FileChangeType.Created, uri },
                    { uri: remotePath, type: FileChangeType.Changed }
                );
                return uri;
            }
        } finally {
            contentManager.dispose();
        }
    }
    private async getJupyterConnectionId(): Promise<string> {
        if (!this.jupyterServerConnectionId) {
            const getRemoteServer = async () => {
                let servers = await this.remoteConnections.getConnections();
                let server = servers.find((item) => item.fileScheme === this.scheme);
                if (!server) {
                    // find the base url for this scheme (we have it stored from previous session).
                    const baseUrl = await this.fileSchemeManager.getAssociatedUrl(this.scheme);
                    if (baseUrl) {
                        // Get the user to log into this.
                        await this.remoteConnections.addServer(baseUrl);
                    }
                    servers = await this.remoteConnections.getConnections();
                    server = servers.find((item) => item.fileScheme === this.scheme);
                }
                if (!server) {
                    // Don't resolve the promise.
                    // User did not log in, hence no need to load any FS & no need to return any data.
                    // tslint:disable-next-line: no-unnecessary-local-variable promise-must-complete
                    const promise = new Promise<string>(() => noop);
                    return promise;
                }
                return server.id;
            };

            this.jupyterServerConnectionId = getRemoteServer();
        }
        return this.jupyterServerConnectionId!;
    }
    private async getContentManager() {
        const jupyterConnectionId = await this.getJupyterConnectionId();
        const service = await this.remoteConnections.createConnectionManager(jupyterConnectionId);
        return service.contentsManager;
    }

    // --- lookup

    private async _lookup(uri: Uri, silent: false, fetchContents?: boolean): Promise<Directory | File>;
    private async _lookup(uri: Uri, silent: boolean, fetchContents?: boolean): Promise<Directory | File | undefined>;
    private async _lookup(uri: Uri, _silent: boolean, fetchContents?: boolean): Promise<Directory | File | undefined> {
        const contentManager = await this.getContentManager();
        try {
            // When using VSCode file picker (window.showOpenDialog), the paths contain a trailing `/`.
            // That trailing `/` causes the Jupyter REST API to fall over (its not valid).
            const path = uri.fsPath.endsWith('/') ? uri.fsPath.slice(0, -1) : uri.fsPath;
            const item = await contentManager.get(path, { content: fetchContents });
            if (item.type === 'directory') {
                return new Directory(item);
            } else {
                // tslint:disable-next-line: no-any
                return new File(item as any);
            }
        } catch (ex) {
            traceError(`Failed to fetch details of ${uri.fsPath}`, ex);
            throw ex;
        } finally {
            contentManager.dispose();
        }
    }

    private _fireSoon(...events: FileChangeEvent[]): void {
        this._bufferedEvents.push(...events);

        if (this._fireSoonHandle) {
            // tslint:disable-next-line: no-any
            clearTimeout(this._fireSoonHandle as any);
        }

        this._fireSoonHandle = setTimeout(() => {
            this._emitter.fire(this._bufferedEvents);
            this._bufferedEvents.length = 0;
        }, 5);
    }
}
