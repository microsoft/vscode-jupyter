// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EventEmitter, Memento } from 'vscode';
import { inject, injectable, named } from 'inversify';
import { IEncryptedStorage } from '../../../platform/common/application/types';
import { Settings } from '../../../platform/common/constants';
import { IMemento, GLOBAL_MEMENTO } from '../../../platform/common/types';
import { traceError, traceInfoIfCI, traceVerbose } from '../../../platform/logging';
import { jupyterServerHandleFromString, jupyterServerHandleToString } from '../jupyterUtils';
import {
    IJupyterServerUriEntry,
    IJupyterServerUriStorage,
    IJupyterUriProviderRegistration,
    JupyterServerProviderHandle
} from '../types';

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
    constructor(
        @inject(IEncryptedStorage) private readonly encryptedStorage: IEncryptedStorage,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento,
        @inject(IJupyterUriProviderRegistration)
        private readonly jupyterPickerRegistration: IJupyterUriProviderRegistration
    ) {}
    public async update(serverHandle: JupyterServerProviderHandle) {
        const uriList = await this.getAll();
        const serverHandleId = jupyterServerHandleToString(serverHandle);
        const existingEntry = uriList.find(
            (entry) => jupyterServerHandleToString(entry.serverHandle) === serverHandleId
        );
        if (!existingEntry) {
            throw new Error(`Uri not found for Server Id ${serverHandleId}`);
        }

        await this.addToUriList(existingEntry.serverHandle, existingEntry.displayName || '');
    }
    private async addToUriList(serverHandle: JupyterServerProviderHandle, displayName: string) {
        const serverHandleId = jupyterServerHandleToString(serverHandle);
        const uriList = await this.getAll();

        // Check if we have already found a display name for this server
        displayName =
            uriList.find((entry) => jupyterServerHandleToString(entry.serverHandle) === serverHandleId)?.displayName ||
            displayName ||
            serverHandleId;

        // Remove this uri if already found (going to add again with a new time)
        const editedList = uriList.filter(
            (f, i) =>
                jupyterServerHandleToString(f.serverHandle) !== serverHandleId &&
                i < Settings.JupyterServerUriListMax - 1
        );

        // Add this entry into the last.
        const entry: IJupyterServerUriEntry = {
            time: Date.now(),
            serverHandle,
            displayName,
            isValidated: true
        };
        editedList.push(entry);

        // Signal that we added in the entry
        await this.updateMemento(editedList);
        this._onDidAddUri.fire(entry);
        this._onDidChangeUri.fire(); // Needs to happen as soon as we change so that dependencies update synchronously
    }
    public async remove(serverHandle: JupyterServerProviderHandle) {
        const uriList = await this.getAll();
        const serverHandleId = jupyterServerHandleToString(serverHandle);
        await this.updateMemento(uriList.filter((f) => jupyterServerHandleToString(f.serverHandle) !== serverHandleId));
        const removedItem = uriList.find((f) => jupyterServerHandleToString(f.serverHandle) === serverHandleId);
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

        // Write the uris to the storage in one big blob (max length issues?)
        // This is because any part of the URI may be a secret (we don't know it's just token values for instance)
        const blob = sorted
            .map(
                (e) =>
                    `${jupyterServerHandleToString(e.serverHandle)}${Settings.JupyterServerRemoteLaunchNameSeparator}${
                        !e.displayName || e.displayName === e.uri
                            ? Settings.JupyterServerRemoteLaunchUriEqualsDisplayName
                            : e.displayName
                    }`
            )
            .join(Settings.JupyterServerRemoteLaunchUriSeparator);
        await Promise.all([
            this.globalMemento.update(Settings.JupyterServerUriList, mementoList),
            this.encryptedStorage.store(
                Settings.JupyterServerRemoteLaunchService,
                Settings.JupyterServerRemoteLaunchUriListKey,
                blob
            )
        ]);
    }
    public async getAll(): Promise<IJupyterServerUriEntry[]> {
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
        const result = await Promise.all(
            split.slice(0, Math.min(split.length, indexes.length)).map(async (item, index) => {
                const uriAndDisplayName = item.split(Settings.JupyterServerRemoteLaunchNameSeparator);
                const uri = uriAndDisplayName[0];
                // Old code (we may have stored a bogus url in the past).
                if (uri === Settings.JupyterServerLocalLaunch) {
                    return;
                }

                try {
                    // This can fail if the URI is invalid (from old versions of this extension).
                    const serverHandle = jupyterServerHandleFromString(uri);
                    // 'same' is specified for the display name to keep storage shorter if it is the same value as the URI
                    const displayName =
                        uriAndDisplayName[1] === Settings.JupyterServerRemoteLaunchUriEqualsDisplayName ||
                        !uriAndDisplayName[1]
                            ? uri
                            : uriAndDisplayName[1];
                    const server: IJupyterServerUriEntry = {
                        time: indexes[index].time,
                        displayName,
                        isValidated: true,
                        serverHandle
                    };

                    try {
                        await this.jupyterPickerRegistration.getJupyterServerUri(serverHandle);
                        return server;
                    } catch (ex) {
                        server.isValidated = false;
                        return server;
                    }
                } catch (ex) {
                    //
                    traceError(`Failed to parse URI ${item}: `, ex);
                }
            })
        );

        traceVerbose(`Found ${result.length} saved URIs, ${JSON.stringify(result)}`);
        return result.filter((item) => !!item) as IJupyterServerUriEntry[];
    }

    public async clear(): Promise<void> {
        const uriList = await this.getAll();
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
    public async get(serverHandle: JupyterServerProviderHandle): Promise<IJupyterServerUriEntry | undefined> {
        const savedList = await this.getAll();
        const serverHandleId = jupyterServerHandleToString(serverHandle);
        return savedList.find((item) => jupyterServerHandleToString(item.serverHandle) === serverHandleId);
    }
    public async add(serverHandle: JupyterServerProviderHandle): Promise<void> {
        traceInfoIfCI(`setUri: ${serverHandle.id}.${serverHandle.handle}`);
        const server = await this.jupyterPickerRegistration.getJupyterServerUri(serverHandle);

        // display name is wrong here
        await this.addToUriList(serverHandle, server.displayName);
    }
}
