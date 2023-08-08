// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EventEmitter, Memento, Uri } from 'vscode';
import { inject, injectable, named } from 'inversify';
import { IEncryptedStorage } from '../../../platform/common/application/types';
import { Identifiers, Settings } from '../../../platform/common/constants';
import { IMemento, GLOBAL_MEMENTO, IExtensionContext, IDisposableRegistry } from '../../../platform/common/types';
import { traceError, traceInfoIfCI, traceVerbose } from '../../../platform/logging';
import {
    extractJupyterServerHandleAndId,
    generateIdFromRemoteProvider,
    getOwnerExtensionOfProviderHandle
} from '../jupyterUtils';
import {
    IJupyterServerUriEntry,
    IJupyterServerUriStorage,
    IJupyterUriProviderRegistration,
    JupyterServerProviderHandle
} from '../types';
import { IFileSystem } from '../../../platform/common/platform/types';
import * as path from '../../../platform/vscode-path/resources';
import { noop } from '../../../platform/common/utils/misc';
import { Disposables } from '../../../platform/common/utils';

export type StorageMRUItem = {
    displayName: string;
    time: number;
    serverHandle: {
        /**
         * Jupyter Server Provider Id.
         */
        id: string;
        /**
         * Jupyter Server handle, unique for each server.
         */
        handle: string;
        /**
         * Extension that owns this server.
         */
        extensionId: string;
    };
};

/**
 * Class for storing Jupyter Server URI values, also manages the MRU list of the servers/urls.
 */
@injectable()
export class JupyterServerUriStorage extends Disposables implements IJupyterServerUriStorage {
    private _onDidChangeUri = new EventEmitter<void>();
    public get onDidChange() {
        return this._onDidChangeUri.event;
    }
    private _onDidRemoveUris = new EventEmitter<IJupyterServerUriEntry[]>();
    public get onDidRemove() {
        return this._onDidRemoveUris.event;
    }
    private _onDidAddUri = new EventEmitter<IJupyterServerUriEntry>();
    public get onDidAdd() {
        return this._onDidAddUri.event;
    }
    private readonly oldStorage: OldStorage;
    private readonly newStorage: NewStorage;
    private storageEventsHooked?: boolean;
    constructor(
        @inject(IEncryptedStorage) encryptedStorage: IEncryptedStorage,
        @inject(IMemento) @named(GLOBAL_MEMENTO) globalMemento: Memento,
        @inject(IJupyterUriProviderRegistration)
        private readonly jupyterPickerRegistration: IJupyterUriProviderRegistration,
        @inject(IFileSystem)
        fs: IFileSystem,
        @inject(IExtensionContext)
        private readonly context: IExtensionContext,
        @inject(IDisposableRegistry)
        disposables: IDisposableRegistry
    ) {
        super();
        disposables.push(this);
        const storageFile = Uri.joinPath(this.context.globalStorageUri, 'remoteServersMRUList.json');
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        this.oldStorage = new OldStorage(encryptedStorage, globalMemento);
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        this.newStorage = new NewStorage(fs, storageFile, this.oldStorage);
        this.disposables.push(this._onDidAddUri);
        this.disposables.push(this._onDidChangeUri);
        this.disposables.push(this._onDidRemoveUris);
        this.disposables.push(this.newStorage);
    }
    private hookupStorageEvents() {
        if (this.storageEventsHooked) {
            return;
        }
        this.storageEventsHooked = true;
        this.newStorage.onDidAdd((e) => this._onDidAddUri.fire(e), this, this.disposables);
        this.newStorage.onDidChange((e) => this._onDidChangeUri.fire(e), this, this.disposables);
        this.newStorage.onDidRemove((e) => this._onDidRemoveUris.fire(e), this, this.disposables);
    }
    public async getAll(): Promise<IJupyterServerUriEntry[]> {
        this.hookupStorageEvents();
        await this.newStorage.migrateMRU();
        return this.newStorage.getAll();
    }
    public async clear(): Promise<void> {
        this.hookupStorageEvents();
        await this.newStorage.migrateMRU();
        await Promise.all([this.oldStorage.clear(), this.newStorage.clear()]);
    }
    public async add(
        jupyterHandle: JupyterServerProviderHandle,
        options?: { time: number; displayName: string }
    ): Promise<void> {
        this.hookupStorageEvents();
        await this.newStorage.migrateMRU();
        traceInfoIfCI(`setUri: ${jupyterHandle.id}.${jupyterHandle.handle}`);
        const entry: IJupyterServerUriEntry = {
            time: options?.time ?? Date.now(),
            displayName: options?.displayName,
            provider: jupyterHandle
        };

        if (!options) {
            const server = await this.jupyterPickerRegistration.getJupyterServerUri(jupyterHandle, true);
            entry.displayName = server.displayName;
        }
        await this.newStorage.add(entry);
    }
    public async update(server: JupyterServerProviderHandle) {
        this.hookupStorageEvents();
        await this.newStorage.migrateMRU();
        await this.newStorage.update(server);
    }
    public async remove(server: JupyterServerProviderHandle) {
        this.hookupStorageEvents();
        await this.newStorage.migrateMRU();
        await this.newStorage.remove(server);
    }
}

class OldStorage {
    constructor(
        @inject(IEncryptedStorage) private readonly encryptedStorage: IEncryptedStorage,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento
    ) {}
    public async getAllRaw(): Promise<IJupyterServerUriEntry[]> {
        // List is in the global memento, URIs are in encrypted storage
        const indexes = this.globalMemento.get<{ index: number; time: number }[]>(Settings.JupyterServerUriList);
        if (!Array.isArray(indexes) || indexes.length === 0) {
            return [];
        }

        // Pull out the \r separated URI list (\r is an invalid URI character)
        const blob = await this.encryptedStorage.retrieve(
            Settings.JupyterServerRemoteLaunchService,
            Settings.JupyterServerRemoteLaunchUriListKey
        );
        if (!blob) {
            return [];
        }
        // Make sure same length
        const split = blob.split(Settings.JupyterServerRemoteLaunchUriSeparator);
        const servers: IJupyterServerUriEntry[] = [];
        await Promise.all(
            split.slice(0, Math.min(split.length, indexes.length)).map(async (item, index) => {
                const uriAndDisplayName = item.split(Settings.JupyterServerRemoteLaunchNameSeparator);
                const uri = uriAndDisplayName[0];
                // Old code (we may have stored a bogus url in the past).
                if (uri === Settings.JupyterServerLocalLaunch) {
                    return;
                }
                try {
                    const idAndHandle = extractJupyterServerHandleAndId(uri);
                    // 'same' is specified for the display name to keep storage shorter if it is the same value as the URI
                    const displayName =
                        uriAndDisplayName[1] === Settings.JupyterServerRemoteLaunchUriEqualsDisplayName ||
                        !uriAndDisplayName[1]
                            ? uri
                            : uriAndDisplayName[1];
                    servers.push({
                        time: indexes[index].time,
                        displayName,
                        provider: idAndHandle
                    });
                } catch (ex) {
                    if (uri.startsWith(Identifiers.REMOTE_URI)) {
                        traceError(`Failed to parse stored Uri information`, ex);
                    }
                }
            })
        );

        traceVerbose(`Found ${servers.length} saved URIs, ${JSON.stringify(servers)}`);
        return servers;
    }
    public async clear(): Promise<void> {
        // Clear out memento and encrypted storage
        await this.globalMemento.update(Settings.JupyterServerUriList, []).then(noop, noop);
        await this.encryptedStorage
            .store(Settings.JupyterServerRemoteLaunchService, Settings.JupyterServerRemoteLaunchUriListKey, undefined)
            .then(noop, noop);
    }
}

class NewStorage {
    private _onDidChangeUri = new EventEmitter<void>();
    public get onDidChange() {
        return this._onDidChangeUri.event;
    }
    private _onDidRemoveUris = new EventEmitter<IJupyterServerUriEntry[]>();
    public get onDidRemove() {
        return this._onDidRemoveUris.event;
    }
    private _onDidAddUri = new EventEmitter<IJupyterServerUriEntry>();
    public get onDidAdd() {
        return this._onDidAddUri.event;
    }

    private migration: Promise<void> | undefined;
    private updatePromise = Promise.resolve();
    constructor(
        private readonly fs: IFileSystem,
        private readonly storageFile: Uri,
        private readonly oldStorage: OldStorage
    ) {}
    dispose() {
        this._onDidAddUri.dispose();
        this._onDidChangeUri.dispose();
        this._onDidRemoveUris.dispose();
    }
    async migrateMRU() {
        if (!this.migration) {
            this.migration = (async () => {
                // Do not store the fact that we migrated in memento,
                // we do not want such state to be transferred across machines.
                if (await this.fs.exists(this.storageFile)) {
                    return;
                }
                const items = await this.oldStorage.getAllRaw();
                const dir = path.dirname(this.storageFile);
                if (!(await this.fs.exists(dir))) {
                    await this.fs.createDirectory(dir);
                }
                const storageItems = items.map((item) => {
                    return <StorageMRUItem>{
                        serverHandle: item.provider,
                        displayName: item.displayName || '',
                        time: item.time
                    };
                });
                await this.fs.writeFile(this.storageFile, JSON.stringify(storageItems));
            })();
        }
        return this.migration;
    }
    public async add(item: IJupyterServerUriEntry) {
        return (this.updatePromise = this.updatePromise
            .then(async () => {
                const all = await this.getAllRaw();
                const existingEntry = all.find(
                    (entry) =>
                        `${entry.serverHandle.id}#${entry.serverHandle.handle}` ===
                        `${item.provider.id}#${item.provider.handle}`
                );
                // Check if we have already found a display name for this server
                item.displayName =
                    item.displayName || existingEntry?.displayName || generateIdFromRemoteProvider(item.provider);

                const newItem: StorageMRUItem = {
                    displayName: item.displayName || '',
                    serverHandle: item.provider,
                    time: item.time
                };
                // Remove this uri if already found (going to add again with a new time)
                const newList = [newItem].concat(
                    all
                        .sort((a, b) => b.time - a.time) // Also sort by time
                        .filter(
                            (entry) =>
                                `${entry.serverHandle.extensionId}#${entry.serverHandle.id}#${entry.serverHandle.handle}` !==
                                `${item.provider.extensionId}#${item.provider.id}#${item.provider.handle}`
                        )
                );
                const removedItems = newList.splice(Settings.JupyterServerUriListMax);

                await this.fs.writeFile(this.storageFile, JSON.stringify(newList));

                if (!existingEntry) {
                    this._onDidAddUri.fire(item);
                }
                if (removedItems.length) {
                    const removeJupyterUris = await Promise.all(
                        removedItems.map(async (removedItem) => {
                            return <IJupyterServerUriEntry>{
                                provider: removedItem.serverHandle,
                                time: removedItem.time,
                                displayName: removedItem.displayName || ''
                            };
                        })
                    );
                    this._onDidRemoveUris.fire(removeJupyterUris);
                }
                this._onDidChangeUri.fire();
            })
            .catch(noop));
    }
    public async update(server: JupyterServerProviderHandle) {
        const uriList = await this.getAllImpl();

        const existingEntry = uriList.find(
            (entry) => entry.provider.id === server.id && entry.provider.handle === server.handle
        );
        if (!existingEntry) {
            throw new Error(`Uri not found for Server Id ${JSON.stringify(server)}`);
        }
        const entry: IJupyterServerUriEntry = {
            provider: existingEntry.provider,
            time: Date.now(),
            displayName: existingEntry.displayName || ''
        };
        await this.add(entry);
    }
    public async remove(server: JupyterServerProviderHandle) {
        await (this.updatePromise = this.updatePromise
            .then(async () => {
                const all = await this.getAllImpl();
                if (all.length === 0) {
                    return;
                }
                const editedList = all.filter(
                    (f) => f.provider.id !== server.id || f.provider.handle !== server.handle
                );
                const removedItems = all.filter(
                    (f) => f.provider.id === server.id && f.provider.handle === server.handle
                );

                if (editedList.length === 0) {
                    await this.clear();
                } else if (removedItems.length) {
                    const items = editedList.map((item) => {
                        return <StorageMRUItem>{
                            displayName: item.displayName,
                            serverHandle: item.provider,
                            time: item.time
                        };
                    });
                    await this.fs.writeFile(this.storageFile, JSON.stringify(items));
                    this._onDidRemoveUris.fire(removedItems);
                }
            })
            .catch(noop));
    }
    public async getAll(): Promise<IJupyterServerUriEntry[]> {
        return this.getAllImpl().then((items) => items.sort((a, b) => b.time - a.time));
    }
    public async clear(): Promise<void> {
        const all = await this.getAllImpl();
        await this.fs.delete(this.storageFile);
        if (all.length) {
            this._onDidRemoveUris.fire(all);
        }
    }
    private async getAllImpl(): Promise<IJupyterServerUriEntry[]> {
        const data = await this.getAllRaw();
        const entries: IJupyterServerUriEntry[] = [];

        await Promise.all(
            data.map(async (item) => {
                const uri = generateIdFromRemoteProvider(item.serverHandle);
                const server: IJupyterServerUriEntry = {
                    time: item.time,
                    displayName: item.displayName || uri,
                    provider: item.serverHandle
                };
                entries.push(server);
            })
        );
        return entries;
    }
    private async getAllRaw(): Promise<StorageMRUItem[]> {
        if (!(await this.fs.exists(this.storageFile))) {
            return [];
        }
        const json = await this.fs.readFile(this.storageFile);
        const items: StorageMRUItem[] = [];
        (JSON.parse(json) as StorageMRUItem[]).map((item) => {
            item.serverHandle.extensionId =
                item.serverHandle.extensionId || getOwnerExtensionOfProviderHandle(item.serverHandle.id) || '';
            if (item.serverHandle.extensionId) {
                items.push(item);
            }
        });
        return items;
    }
}
