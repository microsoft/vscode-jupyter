// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EventEmitter, Memento, Uri } from 'vscode';
import { inject, injectable, named } from 'inversify';
import { IEncryptedStorage } from '../../../platform/common/application/types';
import { Identifiers, Settings } from '../../../platform/common/constants';
import {
    IMemento,
    GLOBAL_MEMENTO,
    IExperimentService,
    Experiments,
    IExtensionContext,
    IDisposableRegistry
} from '../../../platform/common/types';
import { traceError, traceInfoIfCI, traceVerbose } from '../../../platform/logging';
import { computeServerId, extractJupyterServerHandleAndId, generateUriFromRemoteProvider } from '../jupyterUtils';
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
    serverHandle: JupyterServerProviderHandle;
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
        @inject(IExperimentService)
        private readonly experiments: IExperimentService,
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
        this.oldStorage = new OldStorage(encryptedStorage, globalMemento, jupyterPickerRegistration);
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        this.newStorage = new NewStorage(jupyterPickerRegistration, fs, storageFile, this.oldStorage);
        this.disposables.push(this._onDidAddUri);
        this.disposables.push(this._onDidChangeUri);
        this.disposables.push(this._onDidRemoveUris);
        this.disposables.push(this.oldStorage);
        this.disposables.push(this.newStorage);
    }
    private hookupStorageEvents() {
        if (this.storageEventsHooked) {
            return;
        }
        this.storageEventsHooked = true;
        if (this.experiments.inExperiment(Experiments.NewRemoteUriStorage)) {
            this.newStorage.onDidAdd((e) => this._onDidAddUri.fire(e), this, this.disposables);
            this.newStorage.onDidChange((e) => this._onDidChangeUri.fire(e), this, this.disposables);
            this.newStorage.onDidRemove((e) => this._onDidRemoveUris.fire(e), this, this.disposables);
        } else {
            this.oldStorage.onDidAdd((e) => this._onDidAddUri.fire(e), this, this.disposables);
            this.oldStorage.onDidChange((e) => this._onDidChangeUri.fire(e), this, this.disposables);
            this.oldStorage.onDidRemove((e) => this._onDidRemoveUris.fire(e), this, this.disposables);
        }
    }
    public async getAll(): Promise<IJupyterServerUriEntry[]> {
        this.hookupStorageEvents();
        await this.newStorage.migrateMRU();
        if (this.experiments.inExperiment(Experiments.NewRemoteUriStorage)) {
            return this.newStorage.getAll();
        } else {
            return this.oldStorage.getAll();
        }
    }
    public async clear(): Promise<void> {
        this.hookupStorageEvents();
        await this.newStorage.migrateMRU();
        await Promise.all([this.oldStorage.clear(), this.newStorage.clear()]);
    }
    public async get(server: string | JupyterServerProviderHandle): Promise<IJupyterServerUriEntry | undefined> {
        this.hookupStorageEvents();
        await this.newStorage.migrateMRU();
        const savedList = await this.getAll();
        if (typeof server === 'string') {
            return savedList.find((item) => item.serverId === server);
        } else {
            return savedList.find((item) => item.provider.id === server.id && item.provider.handle === server.handle);
        }
    }
    public async add(
        jupyterHandle: JupyterServerProviderHandle,
        options?: { time: number; displayName: string }
    ): Promise<void> {
        this.hookupStorageEvents();
        await this.newStorage.migrateMRU();
        traceInfoIfCI(`setUri: ${jupyterHandle.id}.${jupyterHandle.handle}`);
        const uri = generateUriFromRemoteProvider(jupyterHandle.id, jupyterHandle.handle);
        const serverId = await computeServerId(uri);
        const entry: IJupyterServerUriEntry = {
            uri,
            time: options?.time ?? Date.now(),
            serverId,
            displayName: options?.displayName,
            isValidated: true,
            provider: jupyterHandle
        };

        if (!options) {
            const server = await this.jupyterPickerRegistration.getJupyterServerUri(
                jupyterHandle.id,
                jupyterHandle.handle,
                true
            );
            entry.displayName = server.displayName;
        }
        await Promise.all([this.newStorage.add(entry), this.oldStorage.add(entry)]);
    }
    public async update(server: JupyterServerProviderHandle) {
        this.hookupStorageEvents();
        await this.newStorage.migrateMRU();
        await Promise.all([this.newStorage.update(server), this.oldStorage.update(server)]);
    }
    public async remove(server: string | JupyterServerProviderHandle) {
        this.hookupStorageEvents();
        await this.newStorage.migrateMRU();
        await Promise.all([this.newStorage.remove(server), this.oldStorage.remove(server)]);
    }
}

class OldStorage {
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

    private lastSavedList?: Promise<IJupyterServerUriEntry[]>;
    constructor(
        @inject(IEncryptedStorage) private readonly encryptedStorage: IEncryptedStorage,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento,
        @inject(IJupyterUriProviderRegistration)
        private readonly jupyterPickerRegistration: IJupyterUriProviderRegistration
    ) {}
    dispose() {
        this._onDidAddUri.dispose();
        this._onDidChangeUri.dispose();
        this._onDidRemoveUris.dispose();
    }

    public async add(item: IJupyterServerUriEntry) {
        traceInfoIfCI(`setUri: ${item.provider.id}.${item.provider.handle}`);
        await this.addToUriList(item.provider, item.serverId, item.displayName || '', item.time);
    }
    public async update(server: string | JupyterServerProviderHandle) {
        const uriList = await this.getAll();

        const existingEntry =
            typeof server === 'string'
                ? uriList.find((entry) => entry.serverId === server)
                : uriList.find((entry) => entry.provider.id === server.id && entry.provider.handle === server.handle);
        if (!existingEntry) {
            throw new Error(`Uri not found for Server Id ${JSON.stringify(server)}`);
        }

        await this.addToUriList(
            existingEntry.provider,
            existingEntry.serverId,
            existingEntry.displayName || '',
            Date.now()
        );
    }
    public async remove(server: string | JupyterServerProviderHandle) {
        const uriList = await this.getAll();
        const editedList =
            typeof server === 'string'
                ? uriList.filter((f) => f.serverId !== server)
                : uriList.filter((f) => f.provider.id !== server.id && f.provider.handle !== server.handle);
        if (editedList.length === 0) {
            await this.clear();
        } else {
            await this.updateMemento(editedList);
            const removedItem =
                typeof server === 'string'
                    ? uriList.find((f) => f.serverId === server)
                    : uriList.find((f) => f.provider.id === server.id && f.provider.handle === server.handle);
            if (removedItem) {
                this._onDidRemoveUris.fire([removedItem]);
            }
        }
    }
    private async addToUriList(
        jupyterHandle: { id: string; handle: string },
        serverId: string,
        displayName: string,
        time: number
    ) {
        const uri = generateUriFromRemoteProvider(jupyterHandle.id, jupyterHandle.handle);
        const uriList = await this.getAll();

        // Check if we have already found a display name for this server
        displayName = uriList.find((entry) => entry.serverId === serverId)?.displayName || displayName || uri;
        const entry: IJupyterServerUriEntry = {
            uri,
            time,
            serverId,
            displayName,
            isValidated: true,
            provider: jupyterHandle
        };

        // Remove this uri if already found (going to add again with a new time)
        const editedList = [entry].concat(
            uriList
                .sort((a, b) => b.time - a.time) // First sort by time
                .filter((f) => f.uri !== uri)
        );
        const removedItems = editedList.splice(Settings.JupyterServerUriListMax);

        // Signal that we added in the entry
        this._onDidAddUri.fire(entry);
        this._onDidChangeUri.fire(); // Needs to happen as soon as we change so that dependencies update synchronously
        await this.updateMemento(editedList);
        if (removedItems.length) {
            this._onDidRemoveUris.fire(removedItems);
        }
    }

    private async updateMemento(editedList: IJupyterServerUriEntry[]) {
        // Sort based on time. Newest time first
        const sorted = editedList.sort((a, b) => b.time - a.time);

        // Transform the sorted into just indexes. Uris can't show up in
        // non encrypted storage (so remove even the display name)
        const mementoList = sorted.map((v, i) => {
            return { index: i, time: v.time };
        });

        // Then write just the indexes to global memento
        this.lastSavedList = Promise.resolve(sorted);
        await this.globalMemento.update(Settings.JupyterServerUriList, mementoList);

        // Write the uris to the storage in one big blob (max length issues?)
        // This is because any part of the URI may be a secret (we don't know it's just token values for instance)
        const blob = sorted
            .map(
                (e) =>
                    `${e.uri}${Settings.JupyterServerRemoteLaunchNameSeparator}${
                        !e.displayName || e.displayName === e.uri
                            ? Settings.JupyterServerRemoteLaunchUriEqualsDisplayName
                            : e.displayName
                    }`
            )
            .join(Settings.JupyterServerRemoteLaunchUriSeparator);
        return this.encryptedStorage.store(
            Settings.JupyterServerRemoteLaunchService,
            Settings.JupyterServerRemoteLaunchUriListKey,
            blob
        );
    }
    public async getAll(): Promise<IJupyterServerUriEntry[]> {
        if (this.lastSavedList) {
            return this.lastSavedList.then((items) => items.sort((a, b) => b.time - a.time));
        }
        const promise = async () => {
            // List is in the global memento, URIs are in encrypted storage
            const allServers = await this.getAllRaw();
            const result = await Promise.all(
                allServers.map(async (server) => {
                    try {
                        await this.jupyterPickerRegistration.getJupyterServerUri(
                            server.provider.id,
                            server.provider.handle,
                            true
                        );
                        server.isValidated = true;
                        return server;
                    } catch (ex) {
                        server.isValidated = false;
                        return server;
                    }
                })
            );

            traceVerbose(`Found ${result.length} saved URIs, ${JSON.stringify(result)}`);
            return result.filter((item) => !!item) as IJupyterServerUriEntry[];
        };
        this.lastSavedList = promise();
        return this.lastSavedList.then((items) => items.sort((a, b) => b.time - a.time));
    }
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
                    const serverId = await computeServerId(uri);
                    // 'same' is specified for the display name to keep storage shorter if it is the same value as the URI
                    const displayName =
                        uriAndDisplayName[1] === Settings.JupyterServerRemoteLaunchUriEqualsDisplayName ||
                        !uriAndDisplayName[1]
                            ? uri
                            : uriAndDisplayName[1];
                    servers.push({
                        time: indexes[index].time,
                        serverId,
                        displayName,
                        uri,
                        isValidated: false,
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
        const oldList = this.lastSavedList ? (await this.lastSavedList).slice() : [];
        this.lastSavedList = Promise.resolve([]);
        // Clear out memento and encrypted storage
        await this.globalMemento.update(Settings.JupyterServerUriList, []);
        await this.encryptedStorage.store(
            Settings.JupyterServerRemoteLaunchService,
            Settings.JupyterServerRemoteLaunchUriListKey,
            undefined
        );

        this._onDidRemoveUris.fire(oldList);
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
        @inject(IJupyterUriProviderRegistration)
        private readonly jupyterPickerRegistration: IJupyterUriProviderRegistration,
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
                item.displayName = item.displayName || existingEntry?.displayName || item.uri;

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
                                `${entry.serverHandle.id}#${entry.serverHandle.handle}` !==
                                `${item.provider.id}#${item.provider.handle}`
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
                                serverId: await computeServerId(
                                    generateUriFromRemoteProvider(
                                        removedItem.serverHandle.id,
                                        removedItem.serverHandle.handle
                                    )
                                ),
                                time: removedItem.time,
                                uri: generateUriFromRemoteProvider(
                                    removedItem.serverHandle.id,
                                    removedItem.serverHandle.handle
                                ),
                                displayName: removedItem.displayName || '',
                                isValidated: false
                            };
                        })
                    );
                    this._onDidRemoveUris.fire(removeJupyterUris);
                }
                this._onDidChangeUri.fire();
            })
            .catch(noop));
    }
    public async update(server: string | JupyterServerProviderHandle) {
        const uriList = await this.getAllImpl(false);

        const existingEntry =
            typeof server === 'string'
                ? uriList.find((entry) => entry.serverId === server)
                : uriList.find((entry) => entry.provider.id === server.id && entry.provider.handle === server.handle);
        if (!existingEntry) {
            throw new Error(`Uri not found for Server Id ${JSON.stringify(server)}`);
        }
        const entry: IJupyterServerUriEntry = {
            provider: existingEntry.provider,
            serverId: existingEntry.serverId,
            time: Date.now(),
            uri: generateUriFromRemoteProvider(existingEntry.provider.id, existingEntry.provider.handle),
            displayName: existingEntry.displayName || '',
            isValidated: true
        };
        await this.add(entry);
    }
    public async remove(server: string | JupyterServerProviderHandle) {
        await (this.updatePromise = this.updatePromise
            .then(async () => {
                const all = await this.getAllImpl(false);
                if (all.length === 0) {
                    return;
                }
                const editedList =
                    typeof server === 'string'
                        ? all.filter((f) => f.serverId !== server)
                        : all.filter((f) => f.provider.id !== server.id && f.provider.handle !== server.handle);
                const removedItems =
                    typeof server === 'string'
                        ? all.filter((f) => f.serverId === server)
                        : all.filter((f) => f.provider.id === server.id && f.provider.handle === server.handle);

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
        return this.getAllImpl(true).then((items) => items.sort((a, b) => b.time - a.time));
    }
    public async clear(): Promise<void> {
        const all = await this.getAllImpl(false);
        await this.fs.delete(this.storageFile);
        if (all.length) {
            this._onDidRemoveUris.fire(all);
        }
    }
    private async getAllImpl(validate = true): Promise<IJupyterServerUriEntry[]> {
        const data = await this.getAllRaw();
        const entries: IJupyterServerUriEntry[] = [];

        await Promise.all(
            data.map(async (item) => {
                const uri = generateUriFromRemoteProvider(item.serverHandle.id, item.serverHandle.handle);
                const serverId = await computeServerId(uri);
                const server: IJupyterServerUriEntry = {
                    time: item.time,
                    serverId,
                    displayName: item.displayName || uri,
                    uri,
                    isValidated: false,
                    provider: item.serverHandle
                };
                entries.push(server);
                if (!validate) {
                    return;
                }
                try {
                    await this.jupyterPickerRegistration.getJupyterServerUri(
                        item.serverHandle.id,
                        item.serverHandle.handle,
                        true
                    );
                    server.isValidated = true;
                } catch (ex) {
                    server.isValidated = false;
                }
            })
        );
        return entries;
    }
    private async getAllRaw(): Promise<StorageMRUItem[]> {
        if (!(await this.fs.exists(this.storageFile))) {
            return [];
        }
        const json = await this.fs.readFile(this.storageFile);
        return JSON.parse(json) as StorageMRUItem[];
    }
}
