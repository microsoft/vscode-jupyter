// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EventEmitter, Memento, Uri } from 'vscode';
import { inject, injectable, named } from 'inversify';
import { IEncryptedStorage } from '../../../platform/common/application/types';
import { JVSC_EXTENSION_ID, Settings } from '../../../platform/common/constants';
import { IMemento, GLOBAL_MEMENTO, IExtensionContext, IDisposableRegistry } from '../../../platform/common/types';
import { traceError, traceInfoIfCI, traceVerbose, traceWarning } from '../../../platform/logging';
import { jupyterServerHandleFromString, jupyterServerHandleToString } from '../jupyterUtils';
import {
    IJupyterServerUriEntry,
    IJupyterServerUriStorage,
    IJupyterUriProviderRegistration,
    JupyterServerProviderHandle
} from '../types';
import * as path from '../../../platform/vscode-path/resources';
import { IFileSystem } from '../../../platform/common/platform/types';
import { Disposables } from '../../../platform/common/utils';

const MAX_MRU_COUNT = 10;
const JupyterServerRemoteLaunchUriListKey = 'remote-uri-list';

type StorageMRUItem = {
    displayName: string;
    time: number;
    serverHandle: JupyterServerProviderHandle;
};
const JupyterServerUriList = 'jupyter.jupyterServer.uriList';
const JupyterServerLocalLaunch = 'local';
const JupyterServerRemoteLaunchUriEqualsDisplayName = 'same';
const JupyterServerRemoteLaunchNameSeparator = '\n';

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
    private pendingUpdate = Promise.resolve();
    private readonly migration: MigrateOldMRU;
    private readonly storageFile: Uri;
    private previousGetAll?: Promise<IJupyterServerUriEntry[]>;

    constructor(
        @inject(IEncryptedStorage) private readonly encryptedStorage: IEncryptedStorage,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento,
        @inject(IJupyterUriProviderRegistration)
        private readonly jupyterPickerRegistration: IJupyterUriProviderRegistration,
        @inject(IExtensionContext) private readonly context: IExtensionContext,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry
    ) {
        super();
        disposables.push(this);
        this.disposables.push(this._onDidAddUri);
        this.disposables.push(this._onDidChangeUri);
        this.disposables.push(this._onDidRemoveUris);
        this._onDidRemoveUris.event(
            (e) => this.onDidRemoveHandles(e.map((item) => item.serverHandle)),
            this,
            this.disposables
        );
        this.storageFile = Uri.joinPath(this.context.globalStorageUri, 'remoteServersMRUList.json');
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        this.migration = new MigrateOldMRU(this.encryptedStorage, this.globalMemento, this.fs, this.storageFile);
    }
    public async update(serverHandle: JupyterServerProviderHandle) {
        await this.migration.migrateMRU();
        await this.add(serverHandle);
        this._onDidChangeUri.fire();
    }
    public async remove(serverHandle: JupyterServerProviderHandle) {
        await this.migration.migrateMRU();
        await this.updateStore({ remove: serverHandle });
    }
    public async getAll(): Promise<IJupyterServerUriEntry[]> {
        if (this.previousGetAll) {
            return this.previousGetAll;
        }
        this.previousGetAll = (async () => {
            await this.migration.migrateMRU();
            let items: StorageMRUItem[] = [];
            if (await this.fs.exists(this.storageFile)) {
                items = JSON.parse(await this.fs.readFile(this.storageFile)) as StorageMRUItem[];
            } else {
                return [];
            }
            const result = await Promise.all(
                items.map(async (item) => {
                    // This can fail if the URI is invalid
                    const server: IJupyterServerUriEntry = {
                        time: item.time,
                        displayName: item.displayName,
                        isValidated: true,
                        serverHandle: item.serverHandle
                    };

                    try {
                        const displayName = await this.jupyterPickerRegistration.getDisplayName(item.serverHandle);
                        server.displayName = displayName || server.displayName || item.displayName;
                        return server;
                    } catch (ex) {
                        server.isValidated = false;
                        return server;
                    }
                })
            );

            traceVerbose(`Found ${result.length} saved URIs, ${JSON.stringify(result)}`);
            return result;
        })();
        // Once we're done with the promise, remove the cache.
        // We don't want to cache, but we want to reduce multiple concurrent calls to `getAll` to a single call.
        this.previousGetAll.finally(() => (this.previousGetAll = undefined));
        return this.previousGetAll;
    }
    public async clear(): Promise<void> {
        await this.updateStore({ clearAll: true });
    }
    public async get(serverHandle: JupyterServerProviderHandle): Promise<IJupyterServerUriEntry | undefined> {
        await this.migration.migrateMRU();
        const savedList = await this.getAll();
        const serverHandleId = jupyterServerHandleToString(serverHandle);
        return savedList.find((item) => jupyterServerHandleToString(item.serverHandle) === serverHandleId);
    }
    public async add(serverHandle: JupyterServerProviderHandle): Promise<void> {
        await this.migration.migrateMRU();
        traceInfoIfCI(`setUri: ${serverHandle.id}.${serverHandle.handle}`);
        const displayName = await this.jupyterPickerRegistration.getDisplayName(serverHandle);
        await this.updateStore({ add: { serverHandle, time: Date.now(), displayName } });
    }
    /**
     * If we're no longer in a handle, then notify the jupyter uri providers as well.
     * This will allow them to clean up any state they have.
     * E.g. in the case of User userServerUriProvider.ts, we need to clear the old server list
     * if the corresponding entry is removed from MRU.
     */
    private async onDidRemoveHandles(serverHandles: JupyterServerProviderHandle[]) {
        for (const handle of serverHandles) {
            try {
                const provider = await this.jupyterPickerRegistration.getProvider(handle.id);
                if (provider?.removeHandle) {
                    await provider.removeHandle(handle.handle);
                }
            } catch (ex) {
                traceWarning(`Failed to get provider for ${handle.id} to delete handle ${handle.handle}`, ex);
            }
        }
    }
    private async updateStore(
        options: { add: StorageMRUItem } | { remove: JupyterServerProviderHandle } | { clearAll: true }
    ) {
        this.pendingUpdate = this.pendingUpdate
            .catch((ex) => traceError('Error in updating MRU', ex))
            .finally(async () => {
                const dir = path.dirname(this.storageFile);
                if (!(await this.fs.exists(dir))) {
                    await this.fs.createDirectory(dir);
                }
                const uriList = await this.getAll();
                let items = uriList.map(
                    (item) =>
                        <StorageMRUItem>{
                            displayName: item.displayName,
                            serverHandle: item.serverHandle,
                            time: item.time
                        }
                );

                if ('clearAll' in options) {
                    await this.fs.writeFile(this.storageFile, JSON.stringify([]));

                    // This is required so the individual publishers of JupyterUris can clean up their state
                    // I.e. they need to know that these handles are no longer saved in MRU, so they too can clean their state.
                    this._onDidRemoveUris.fire(uriList);
                    this._onDidChangeUri.fire();
                    return;
                }
                let entryToRemove: IJupyterServerUriEntry | undefined;
                if ('add' in options) {
                    // Ensure we don't have duplicates.
                    const id = jupyterServerHandleToString(options.add.serverHandle);
                    items = items.filter((item) => jupyterServerHandleToString(item.serverHandle) !== id);
                    items.push(options.add);
                } else {
                    // Remove them
                    const id = jupyterServerHandleToString(options.remove);
                    items = items.filter((item) => jupyterServerHandleToString(item.serverHandle) !== id);
                    entryToRemove = uriList.find((item) => jupyterServerHandleToString(item.serverHandle) === id);
                    if (!entryToRemove) {
                        // Not found, nothing to remove
                        return;
                    }
                }
                const itemsToSave = items.slice(0, MAX_MRU_COUNT - 1);
                const itemsToRemove = items.slice(MAX_MRU_COUNT);
                if (!(await this.fs.exists(dir))) {
                    await this.fs.createDirectory(dir);
                }
                await this.fs.writeFile(this.storageFile, JSON.stringify(itemsToSave));

                if (itemsToRemove.length) {
                    // This is required so the individual publishers of JupyterUris can clean up their state
                    // I.e. they need to know that these handles are no longer saved in MRU, so they too can clean their state.
                    this._onDidRemoveUris.fire(
                        itemsToRemove.map(
                            (item) =>
                                <IJupyterServerUriEntry>{
                                    serverHandle: item.serverHandle,
                                    time: item.time,
                                    displayName: item.displayName,
                                    isValidated: false
                                }
                        )
                    );
                }

                this._onDidChangeUri.fire();

                if ('add' in options) {
                    this._onDidAddUri.fire({
                        serverHandle: options.add.serverHandle,
                        time: options.add.time,
                        displayName: options.add.displayName,
                        isValidated: true
                    });
                } else if (entryToRemove) {
                    this._onDidRemoveUris.fire([entryToRemove]);
                }
            });
        await this.pendingUpdate;
    }
}

class MigrateOldMRU {
    private migration: Promise<void> | undefined;
    constructor(
        private readonly encryptedStorage: IEncryptedStorage,
        private readonly globalMemento: Memento,
        private readonly fs: IFileSystem,
        private readonly storageFile: Uri
    ) {}
    async migrateMRU() {
        if (!this.migration) {
            this.migration = this.migrateMRUImpl();
        }
        return this.migration;
    }
    private async migrateMRUImpl() {
        // Do not store the fact that we migrated in memento,
        // we do not want such state to be transferred across machines.
        if (await this.fs.exists(this.storageFile)) {
            return;
        }
        const items = await this.getMRU();
        if (items.length === 0) {
            return;
        }
        const dir = path.dirname(this.storageFile);
        if (!(await this.fs.exists(dir))) {
            await this.fs.createDirectory(dir);
        }
        const storageItems = items.map(
            (item) =>
                <StorageMRUItem>{
                    serverHandle: item.serverHandle,
                    displayName: item.displayName || '',
                    time: item.time
                }
        );
        await Promise.all([this.clear(), this.fs.writeFile(this.storageFile, JSON.stringify(storageItems))]);
    }
    private async clear(): Promise<void> {
        await Promise.all([
            this.globalMemento.update(JupyterServerUriList, []),
            this.encryptedStorage.store(`${JVSC_EXTENSION_ID}.${JupyterServerRemoteLaunchUriListKey}`, undefined)
        ]);
    }

    private async getMRU() {
        // List is in the global memento, URIs are in encrypted storage
        const indexes = this.globalMemento.get<{ index: number; time: number }[]>(JupyterServerUriList);
        if (!Array.isArray(indexes) || indexes.length === 0) {
            return [];
        }
        // Pull out the \r separated URI list (\r is an invalid URI character)
        const blob = await this.encryptedStorage.retrieve(
            `${JVSC_EXTENSION_ID}.${JupyterServerRemoteLaunchUriListKey}`
        );
        if (!blob) {
            return [];
        }
        // Make sure same length
        const split = blob.split(Settings.JupyterServerRemoteLaunchUriSeparator);
        const result = await Promise.all(
            split.map(async (item, index) => {
                const uriAndDisplayName = item.split(JupyterServerRemoteLaunchNameSeparator);
                const uri = uriAndDisplayName[0];
                // Old code (we may have stored a bogus url in the past).
                if (uri === JupyterServerLocalLaunch) {
                    return;
                }

                try {
                    // This can fail if the URI is invalid (from old versions of this extension).
                    const serverHandle = jupyterServerHandleFromString(uri);
                    // 'same' is specified for the display name to keep storage shorter if it is the same value as the URI
                    const displayName =
                        uriAndDisplayName[1] === JupyterServerRemoteLaunchUriEqualsDisplayName || !uriAndDisplayName[1]
                            ? uri
                            : uriAndDisplayName[1];
                    return <IJupyterServerUriEntry>{
                        time: indexes[index].time, // Assumption is that during retrieval, indexes and blob will be in sync.
                        displayName,
                        isValidated: false,
                        serverHandle
                    };
                } catch (ex) {
                    //
                    traceError(`Failed to parse URI ${item}: `, ex);
                }
            })
        );

        traceVerbose(`Found ${result.length} saved URIs, ${JSON.stringify(result)}`);
        return result.filter((item) => !!item) as IJupyterServerUriEntry[];
    }
}
