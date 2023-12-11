// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EventEmitter, Memento, env } from 'vscode';
import { inject, injectable, named } from 'inversify';
import { Settings } from '../../../platform/common/constants';
import { IMemento, GLOBAL_MEMENTO, IDisposableRegistry } from '../../../platform/common/types';
import { traceError, traceInfoIfCI } from '../../../platform/logging';
import { generateIdFromRemoteProvider } from '../jupyterUtils';
import { IJupyterServerUriEntry, IJupyterServerUriStorage, JupyterServerProviderHandle } from '../types';
import { noop } from '../../../platform/common/utils/misc';
import { DisposableBase } from '../../../platform/common/utils/lifecycle';

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
export class JupyterServerUriStorage extends DisposableBase implements IJupyterServerUriStorage {
    private _onDidLoad = this._register(new EventEmitter<void>());
    public get onDidLoad() {
        return this._onDidLoad.event;
    }
    private _onDidChangeUri = this._register(new EventEmitter<void>());
    public get onDidChange() {
        return this._onDidChangeUri.event;
    }
    private _onDidRemoveUris = this._register(new EventEmitter<JupyterServerProviderHandle[]>());
    public get onDidRemove() {
        return this._onDidRemoveUris.event;
    }
    private _onDidAddUri = this._register(new EventEmitter<IJupyterServerUriEntry>());
    public get onDidAdd() {
        return this._onDidAddUri.event;
    }
    private readonly newStorage: NewStorage;
    private storageEventsHooked?: boolean;
    private _all: IJupyterServerUriEntry[] = [];
    public get all() {
        this.updateStore();
        return this._all;
    }
    constructor(
        @inject(IMemento) @named(GLOBAL_MEMENTO) globalMemento: Memento,
        @inject(IDisposableRegistry)
        disposables: IDisposableRegistry
    ) {
        super();
        disposables.push(this);
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        this.newStorage = this._register(new NewStorage(globalMemento));
    }
    private hookupStorageEvents() {
        if (this.storageEventsHooked) {
            return;
        }
        this.storageEventsHooked = true;
        this._register(this.newStorage.onDidAdd((e) => this._onDidAddUri.fire(e), this));
        this._register(this.newStorage.onDidChange((e) => this._onDidChangeUri.fire(e), this));
        this._register(this.newStorage.onDidRemove((e) => this._onDidRemoveUris.fire(e), this));
    }
    private updateStore(): IJupyterServerUriEntry[] {
        this.hookupStorageEvents();
        const previous = this._all;
        this._all = this.newStorage.getAll();
        if (previous.length !== this._all.length || JSON.stringify(this._all) !== JSON.stringify(previous)) {
            this._onDidLoad.fire();
        }
        return this._all;
    }
    public async clear(): Promise<void> {
        this.hookupStorageEvents();
        await this.newStorage.clear();
        this._all = [];
        this._onDidLoad.fire();
    }
    public async add(jupyterHandle: JupyterServerProviderHandle, options?: { time: number }): Promise<void> {
        this.hookupStorageEvents();
        traceInfoIfCI(`setUri: ${jupyterHandle.id}.${jupyterHandle.handle}`);
        const entry: IJupyterServerUriEntry = {
            time: options?.time ?? Date.now(),
            displayName: '',
            provider: jupyterHandle
        };

        await this.newStorage.add(entry);
        this.updateStore();
    }
    public async update(server: JupyterServerProviderHandle) {
        this.hookupStorageEvents();
        await this.newStorage.update(server);
        this.updateStore();
    }
    public async remove(server: JupyterServerProviderHandle) {
        this.hookupStorageEvents();
        await this.newStorage.remove(server);
        this.updateStore();
    }
}

class NewStorage {
    private _onDidChangeUri = new EventEmitter<void>();
    public get onDidChange() {
        return this._onDidChangeUri.event;
    }
    private _onDidRemoveUris = new EventEmitter<JupyterServerProviderHandle[]>();
    public get onDidRemove() {
        return this._onDidRemoveUris.event;
    }
    private _onDidAddUri = new EventEmitter<IJupyterServerUriEntry>();
    public get onDidAdd() {
        return this._onDidAddUri.event;
    }

    private updatePromise = Promise.resolve();
    private readonly mementoKey: string;
    constructor(private readonly memento: Memento) {
        // Ensure the key is unique per machine,
        // this way when memento is transferred across machines it will not corrupt the memento on that machine.
        this.mementoKey = `MEMENTO_KEY_FOR_STORING_USED_JUPYTER_PROVIDERS_${env.machineId}`;
    }
    dispose() {
        this._onDidAddUri.dispose();
        this._onDidChangeUri.dispose();
        this._onDidRemoveUris.dispose();
    }
    public async add(item: IJupyterServerUriEntry) {
        return (this.updatePromise = this.updatePromise
            .then(async () => {
                const all = this.getAll();
                const existingEntry = all.find(
                    (entry) =>
                        generateIdFromRemoteProvider(entry.provider) === generateIdFromRemoteProvider(item.provider)
                );
                // Check if we have already found a display name for this server
                const newItem: StorageMRUItem = {
                    displayName:
                        item.displayName || existingEntry?.displayName || generateIdFromRemoteProvider(item.provider),
                    serverHandle: item.provider,
                    time: item.time
                };
                // Remove this uri if already found (going to add again with a new time)
                const newList = [newItem].concat(
                    all
                        .sort((a, b) => b.time - a.time) // Also sort by time
                        .filter(
                            (entry) =>
                                generateIdFromRemoteProvider(entry.provider) !==
                                generateIdFromRemoteProvider(item.provider)
                        )
                        .map((item) => {
                            return <StorageMRUItem>{
                                displayName: item.displayName,
                                serverHandle: item.provider,
                                time: item.time
                            };
                        })
                );
                const removedItems = newList.splice(Settings.JupyterServerUriListMax);

                await this.memento.update(this.mementoKey, newList);

                if (!existingEntry) {
                    this._onDidAddUri.fire(item);
                }
                if (removedItems.length) {
                    const removeJupyterUris = removedItems.map((removedItem) => {
                        return <IJupyterServerUriEntry>{
                            provider: removedItem.serverHandle,
                            time: removedItem.time,
                            displayName: removedItem.displayName || ''
                        };
                    });
                    this._onDidRemoveUris.fire(removeJupyterUris.map((item) => item.provider));
                }
                this._onDidChangeUri.fire();
            })
            .catch(noop));
    }
    public async update(server: JupyterServerProviderHandle) {
        const uriList = this.getAll();

        const existingEntry = uriList.find(
            (entry) => entry.provider.id === server.id && entry.provider.handle === server.handle
        );
        const entry: IJupyterServerUriEntry = {
            provider: server,
            time: Date.now(),
            displayName: existingEntry?.displayName || ''
        };
        await this.add(entry);
    }
    public async remove(server: JupyterServerProviderHandle) {
        await (this.updatePromise = this.updatePromise
            .then(async () => {
                let removedTriggered = false;
                try {
                    const all = this.getAll();
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
                        removedTriggered = true;
                        await this.memento.update(this.mementoKey, items);
                        this._onDidRemoveUris.fire(removedItems.map((item) => item.provider));
                    }
                } finally {
                    // TODO: This is debt.
                    // For the old code we must trigger the event even if the item does not exist.
                    // This is required by the Kernel Finder.
                    // Kernel Finder Controller will look at this URI storage and build a list of kernel finder.
                    // When we add a new server and then remove it even without using it.
                    // The the item still shows up in the quick pick and the kernel finder still exists.
                    // Thats because the kernel finder controller monitors this event and then disposes the corresponding kernel finder.
                    if (!removedTriggered) {
                        this._onDidRemoveUris.fire([server]);
                    }
                }
            })
            .catch((ex) => traceError(`Failed to remove Server handle ${JSON.stringify(server)}`, ex)));
    }
    public getAll(): IJupyterServerUriEntry[] {
        const data = this.memento.get<StorageMRUItem[]>(this.mementoKey, []);
        const entries: IJupyterServerUriEntry[] = [];

        data.forEach(async (item) => {
            const uri = generateIdFromRemoteProvider(item.serverHandle);
            const server: IJupyterServerUriEntry = {
                time: item.time,
                displayName: item.displayName || uri,
                provider: item.serverHandle
            };
            entries.push(server);
        });
        return entries;
    }
    public async clear(): Promise<void> {
        const all = this.getAll();
        await this.memento.update(this.mementoKey, []);
        if (all.length) {
            this._onDidRemoveUris.fire(all.map((e) => e.provider));
        }
    }
}
