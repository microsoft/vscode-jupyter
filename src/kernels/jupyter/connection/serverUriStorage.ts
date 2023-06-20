// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EventEmitter, Memento } from 'vscode';
import { inject, injectable, named } from 'inversify';
import { IEncryptedStorage } from '../../../platform/common/application/types';
import { Settings } from '../../../platform/common/constants';
import { IMemento, GLOBAL_MEMENTO } from '../../../platform/common/types';
import { traceInfoIfCI, traceVerbose, traceWarning } from '../../../platform/logging';
import { computeServerId, extractJupyterServerHandleAndId, generateUriFromRemoteProvider } from '../jupyterUtils';
import {
    IJupyterServerUriEntry,
    IJupyterServerUriStorage,
    IJupyterUriProviderRegistration,
    JupyterServerUriHandle
} from '../types';

/**
 * Class for storing Jupyter Server URI values, also manages the MRU list of the servers/urls.
 */
@injectable()
export class JupyterServerUriStorage implements IJupyterServerUriStorage {
    private lastSavedList?: Promise<IJupyterServerUriEntry[]>;
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
    constructor(
        @inject(IEncryptedStorage) private readonly encryptedStorage: IEncryptedStorage,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento,
        @inject(IJupyterUriProviderRegistration)
        private readonly jupyterPickerRegistration: IJupyterUriProviderRegistration
    ) {}
    public async update(serverId: string) {
        const uriList = await this.getAll();

        const existingEntry = uriList.find((entry) => entry.serverId === serverId);
        if (!existingEntry) {
            throw new Error(`Uri not found for Server Id ${serverId}`);
        }

        await this.addToUriList(existingEntry.provider, existingEntry.displayName || '');
    }
    private async addToUriList(
        jupyterHandle: { id: string; handle: JupyterServerUriHandle },
        displayName: string,
        time = Date.now()
    ) {
        const uri = generateUriFromRemoteProvider(jupyterHandle.id, jupyterHandle.handle);
        const [uriList, serverId] = await Promise.all([this.getAll(), computeServerId(uri)]);

        // Check if we have already found a display name for this server
        displayName = uriList.find((entry) => entry.serverId === serverId)?.displayName || displayName || uri;

        // Remove this uri if already found (going to add again with a new time)
        const editedList = uriList.filter((f, i) => f.uri !== uri && i < Settings.JupyterServerUriListMax - 1);

        // Add this entry into the last.
        const idAndHandle = extractJupyterServerHandleAndId(uri);
        const entry: IJupyterServerUriEntry = {
            uri,
            time,
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

        await this.updateMemento(uriList.filter((f) => f.serverId !== serverId));
        const removedItem = uriList.find((f) => f.uri === serverId);
        if (removedItem) {
            this._onDidRemoveUris.fire([removedItem]);
        }
    }
    private async updateMemento(editedList: IJupyterServerUriEntry[]) {
        // Sort based on time. Newest time first
        const sorted = editedList
            .sort((a, b) => b.time - a.time)
            // We have may stored some old bogus entries in the past.
            .filter((item) => item.uri !== Settings.JupyterServerLocalLaunch);

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
            const indexes = this.globalMemento.get<{ index: number; time: number }[]>(Settings.JupyterServerUriList);
            if (indexes && indexes.length > 0) {
                // Pull out the \r separated URI list (\r is an invalid URI character)
                const blob = await this.encryptedStorage.retrieve(
                    Settings.JupyterServerRemoteLaunchService,
                    Settings.JupyterServerRemoteLaunchUriListKey
                );
                if (blob) {
                    // Make sure same length
                    const split = blob.split(Settings.JupyterServerRemoteLaunchUriSeparator);
                    const result = await Promise.all(
                        split.slice(0, Math.min(split.length, indexes.length)).map(async (item, index) => {
                            const uriAndDisplayName = item.split(Settings.JupyterServerRemoteLaunchNameSeparator);
                            const uri = uriAndDisplayName[0];
                            // Old code (we may have stored a bogus url in the past).
                            if (uri === Settings.JupyterServerLocalLaunch) {
                                return;
                            }
                            let idAndHandle: { id: string; handle: JupyterServerUriHandle };
                            try {
                                idAndHandle = extractJupyterServerHandleAndId(uri);
                            } catch {
                                traceWarning(`Failed to parse Uri in storage`, uri);
                                return;
                            }
                            const serverId = await computeServerId(uri);
                            // 'same' is specified for the display name to keep storage shorter if it is the same value as the URI
                            const displayName =
                                uriAndDisplayName[1] === Settings.JupyterServerRemoteLaunchUriEqualsDisplayName ||
                                !uriAndDisplayName[1]
                                    ? uri
                                    : uriAndDisplayName[1];
                            const server: IJupyterServerUriEntry = {
                                time: indexes[index].time,
                                serverId,
                                displayName,
                                uri,
                                isValidated: true,
                                provider: idAndHandle
                            };
                            try {
                                await this.jupyterPickerRegistration.getJupyterServerUri(
                                    idAndHandle.id,
                                    idAndHandle.handle
                                );
                                return server;
                            } catch (ex) {
                                server.isValidated = false;
                                return server;
                            }
                        })
                    );

                    traceVerbose(`Found ${result.length} saved URIs, ${JSON.stringify(result)}`);
                    return result.filter((item) => !!item) as IJupyterServerUriEntry[];
                }
            }
            return [];
        };
        this.lastSavedList = promise();
        return this.lastSavedList;
    }

    public async clear(): Promise<void> {
        const uriList = await this.getAll();
        this.lastSavedList = Promise.resolve([]);
        // Clear out memento and encrypted storage
        await this.globalMemento.update(Settings.JupyterServerUriList, []);
        await this.encryptedStorage.store(
            Settings.JupyterServerRemoteLaunchService,
            Settings.JupyterServerRemoteLaunchUriListKey,
            undefined
        );

        // Notify out that we've removed the list to clean up controller entries, passwords, ect
        this._onDidRemoveUris.fire(uriList);
    }
    public async get(id: string): Promise<IJupyterServerUriEntry | undefined> {
        const savedList = await this.getAll();
        return savedList.find((item) => item.serverId === id);
    }
    public async add(
        jupyterHandle: { id: string; handle: JupyterServerUriHandle },
        options?: { time: number; displayName: string }
    ): Promise<void> {
        traceInfoIfCI(`setUri: ${jupyterHandle.id}.${jupyterHandle.handle}`);
        const displayName =
            options?.displayName ||
            (await this.jupyterPickerRegistration.getJupyterServerUri(jupyterHandle.id, jupyterHandle.handle))
                .displayName;

        // display name is wrong here
        await this.addToUriList(jupyterHandle, displayName, options?.time);
    }
}
