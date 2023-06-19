// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EventEmitter, Memento, Uri } from 'vscode';
import { inject, injectable, named } from 'inversify';
import { IEncryptedStorage } from '../../../platform/common/application/types';
import { Settings } from '../../../platform/common/constants';
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
import { JupyterServerUriHandle } from '../../../api';
import { IFileSystem } from '../../../platform/common/platform/types';
import * as path from '../../../platform/vscode-path/resources';

type StorageMRUItem = {
    displayName: string;
    time: number;
    serverHandle: JupyterServerProviderHandle;
};

/**
 * Class for storing Jupyter Server URI values, also manages the MRU list of the servers/urls.
 */
@injectable()
export class JupyterServerUriStorage implements IJupyterServerUriStorage {
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
    constructor(
        @inject(IEncryptedStorage) encryptedStorage: IEncryptedStorage,
        @inject(IMemento) @named(GLOBAL_MEMENTO) globalMemento: Memento,
        @inject(IJupyterUriProviderRegistration)
        private readonly jupyterPickerRegistration: IJupyterUriProviderRegistration,
        @inject(IExperimentService)
        private readonly experiments: IExperimentService,
        @inject(IExperimentService)
        fs: IFileSystem,
        @inject(IExtensionContext)
        private readonly context: IExtensionContext,
        @inject(IDisposableRegistry)
        disposables: IDisposableRegistry
    ) {
        const storageFile = Uri.joinPath(this.context.globalStorageUri, 'remoteServersMRUList.json');
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        this.oldStorage = new OldStorage(encryptedStorage, globalMemento, jupyterPickerRegistration);
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        this.newStorage = new NewStorage(jupyterPickerRegistration, fs, storageFile, this.oldStorage);
        disposables.push(this._onDidAddUri);
        disposables.push(this._onDidChangeUri);
        disposables.push(this._onDidRemoveUris);
    }
    public async getAll(): Promise<IJupyterServerUriEntry[]> {
        await this.newStorage.migrateMRU();
        if (this.experiments.inExperiment(Experiments.NewRemoteUriStorage)) {
            return this.newStorage.getAll();
        } else {
            return this.oldStorage.getAll();
        }
    }
    public async clear(): Promise<void> {
        await this.newStorage.migrateMRU();
        const uriList = await this.getAll();
        await Promise.all([this.oldStorage.clear(), this.newStorage.clear()]);
        // Notify out that we've removed the list to clean up controller entries, passwords, ect
        this._onDidRemoveUris.fire(uriList);
    }
    public async get(id: string): Promise<IJupyterServerUriEntry | undefined> {
        const savedList = await this.getAll();
        return savedList.find((item) => item.serverId === id);
    }
    public async add(jupyterHandle: { id: string; handle: JupyterServerUriHandle }): Promise<void> {
        traceInfoIfCI(`setUri: ${jupyterHandle.id}.${jupyterHandle.handle}`);
        const server = await this.jupyterPickerRegistration.getJupyterServerUri(jupyterHandle.id, jupyterHandle.handle);

        // display name is wrong here
        await this.addToUriList(jupyterHandle, server.displayName);
    }
    public async update(serverId: string) {
        const uriList = await this.getAll();

        const existingEntry = uriList.find((entry) => entry.serverId === serverId);
        if (!existingEntry) {
            throw new Error(`Uri not found for Server Id ${serverId}`);
        }

        await this.addToUriList(existingEntry.provider, existingEntry.displayName || '');
    }
    private async addToUriList(jupyterHandle: { id: string; handle: JupyterServerUriHandle }, displayName: string) {
        const uri = generateUriFromRemoteProvider(jupyterHandle.id, jupyterHandle.handle);
        const [uriList, serverId] = await Promise.all([this.getAll(), computeServerId(uri)]);

        // Check if we have already found a display name for this server
        displayName = uriList.find((entry) => entry.serverId === serverId)?.displayName || displayName || uri;

        // Remove this uri if already found (going to add again with a new time)
        const editedList = uriList
            .sort((a, b) => b.time - a.time) // First sort by time
            .filter((f, i) => f.uri !== uri && i < Settings.JupyterServerUriListMax - 1);

        // Add this entry into the last.
        const idAndHandle = extractJupyterServerHandleAndId(uri);
        const entry: IJupyterServerUriEntry = {
            uri,
            time: Date.now(),
            serverId,
            displayName,
            isValidated: true,
            provider: idAndHandle
        };
        editedList.push(entry);

        // Signal that we added in the entry
        this._onDidAddUri.fire(entry);
        this._onDidChangeUri.fire(); // Needs to happen as soon as we change so that dependencies update synchronously
        return this.updateMemento(editedList);
    }
    public async remove(serverId: string) {
        const uriList = await this.getAll();
        const editedList = uriList.filter((f) => f.serverId !== serverId);
        if (editedList.length === 0) {
            await this.clear();
        } else {
            await this.updateMemento(uriList.filter((f) => f.serverId !== serverId));
            const removedItem = uriList.find((f) => f.uri === serverId);
            if (removedItem) {
                this._onDidRemoveUris.fire([removedItem]);
            }
        }
    }
    private async updateMemento(editedList: IJupyterServerUriEntry[]) {
        await this.newStorage.migrateMRU();
        await Promise.all([this.oldStorage.updateMemento(editedList), this.newStorage.updateMemento(editedList)]);
    }
}

class OldStorage {
    private lastSavedList?: Promise<IJupyterServerUriEntry[]>;
    constructor(
        @inject(IEncryptedStorage) private readonly encryptedStorage: IEncryptedStorage,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento,
        @inject(IJupyterUriProviderRegistration)
        private readonly jupyterPickerRegistration: IJupyterUriProviderRegistration
    ) {}
    public async updateMemento(editedList: IJupyterServerUriEntry[]) {
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
            return this.lastSavedList;
        }
        const promise = async () => {
            // List is in the global memento, URIs are in encrypted storage
            const allServers = await this.getAllRaw();
            const result = await Promise.all(
                allServers.map(async (server) => {
                    try {
                        await this.jupyterPickerRegistration.getJupyterServerUri(
                            server.provider.id,
                            server.provider.handle
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
        return this.lastSavedList;
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
                    traceError(`Failed to parse stored Uri information`, ex);
                }
            })
        );

        traceVerbose(`Found ${servers.length} saved URIs, ${JSON.stringify(servers)}`);
        return servers;
    }

    public async clear(): Promise<void> {
        this.lastSavedList = Promise.resolve([]);
        // Clear out memento and encrypted storage
        await this.globalMemento.update(Settings.JupyterServerUriList, []);
        await this.encryptedStorage.store(
            Settings.JupyterServerRemoteLaunchService,
            Settings.JupyterServerRemoteLaunchUriListKey,
            undefined
        );
    }
}

class NewStorage {
    private migration: Promise<void> | undefined;
    constructor(
        @inject(IJupyterUriProviderRegistration)
        private readonly jupyterPickerRegistration: IJupyterUriProviderRegistration,
        private readonly fs: IFileSystem,
        private readonly storageFile: Uri,
        private readonly oldStorage: OldStorage
    ) {}
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
                const storageItems = items.map(
                    (item) =>
                        <StorageMRUItem>{
                            serverHandle: item.provider,
                            displayName: item.displayName || '',
                            time: item.time
                        }
                );
                await this.fs.writeFile(this.storageFile, JSON.stringify(storageItems));
            })();
        }
        return this.migration;
    }
    public async updateMemento(editedList: IJupyterServerUriEntry[]) {
        // Sort based on time. Newest time first
        const storageItems = editedList
            .sort((a, b) => b.time - a.time)
            .map((v) => {
                return <StorageMRUItem>{
                    displayName: v.displayName || '',
                    serverHandle: v.provider,
                    time: v.time
                };
            });

        await this.fs.writeFile(this.storageFile, JSON.stringify(storageItems));
    }
    public async getAll(): Promise<IJupyterServerUriEntry[]> {
        const json = await this.fs.readFile(this.storageFile);
        const data = JSON.parse(json) as StorageMRUItem[];
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
                    isValidated: true,
                    provider: item.serverHandle
                };
                try {
                    await this.jupyterPickerRegistration.getJupyterServerUri(
                        item.serverHandle.id,
                        item.serverHandle.handle
                    );
                    return server;
                } catch (ex) {
                    server.isValidated = false;
                    return server;
                }
            })
        );
        return entries;
    }

    public async clear(): Promise<void> {
        await this.fs.writeFile(this.storageFile, JSON.stringify([]));
    }
}
