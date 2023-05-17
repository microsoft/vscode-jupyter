// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, named } from 'inversify';
import { Event, EventEmitter, Memento } from 'vscode';
import {
    IWorkspaceService,
    IEncryptedStorage,
    IApplicationEnvironment
} from '../../../platform/common/application/types';
import { Settings } from '../../../platform/common/constants';
import { getFilePath } from '../../../platform/common/platform/fs-paths';
import {
    ICryptoUtils,
    IMemento,
    GLOBAL_MEMENTO,
    IsWebExtension,
    IConfigurationService
} from '../../../platform/common/types';
import { traceInfoIfCI, traceVerbose } from '../../../platform/logging';
import { computeServerId, extractJupyterServerHandleAndId } from '../jupyterUtils';
import { IJupyterServerUriEntry, IJupyterServerUriStorage, IJupyterUriProviderRegistration } from '../types';

/**
 * Class for storing Jupyter Server URI values
 */
@injectable()
export class JupyterServerUriStorage implements IJupyterServerUriStorage {
    private lastSavedList?: Promise<IJupyterServerUriEntry[]>;
    private _onDidChangeUri = new EventEmitter<void>();
    public get onDidChangeUri() {
        return this._onDidChangeUri.event;
    }
    private _onDidRemoveUris = new EventEmitter<IJupyterServerUriEntry[]>();
    public get onDidRemoveUris() {
        return this._onDidRemoveUris.event;
    }
    private _onDidAddUri = new EventEmitter<IJupyterServerUriEntry>();
    public get onDidAddUri() {
        return this._onDidAddUri.event;
    }
    public get onDidChangeConnectionType(): Event<void> {
        return this._onDidChangeUri.event;
    }
    constructor(
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(ICryptoUtils) private readonly crypto: ICryptoUtils,
        @inject(IEncryptedStorage) private readonly encryptedStorage: IEncryptedStorage,
        @inject(IApplicationEnvironment) private readonly appEnv: IApplicationEnvironment,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento,
        @inject(IsWebExtension) readonly isWebExtension: boolean,
        @inject(IConfigurationService) readonly configService: IConfigurationService,
        @inject(IJupyterUriProviderRegistration)
        private readonly jupyterPickerRegistration: IJupyterUriProviderRegistration
    ) {}
    public async addServerToUriList(serverId: string, time: number) {
        // Start with saved list.
        const uriList = await this.getSavedUriList();

        // Check if we have already found a display name for this server
        const existingEntry = uriList.find((entry) => {
            return entry.serverId === serverId;
        });

        if (!existingEntry) {
            throw new Error(`Uri not found for Server Id ${serverId}`);
        }

        await this.addToUriList(existingEntry.uri, time, existingEntry.displayName || '');
    }
    private async addToUriList(uri: string, time: number, displayName: string) {
        // Uri list is saved partially in the global memento and partially in encrypted storage

        // Start with saved list.
        const uriList = await this.getSavedUriList();

        // Compute server id for saving in the list
        const serverId = await computeServerId(uri);

        // Check if we have already found a display name for this server
        const existingEntry = uriList.find((entry) => {
            return entry.serverId === serverId;
        });
        if (existingEntry && existingEntry.displayName) {
            displayName = existingEntry.displayName;
        }

        // Remove this uri if already found (going to add again with a new time)
        const editedList = uriList.filter((f, i) => {
            return f.uri !== uri && i < Settings.JupyterServerUriListMax - 1;
        });

        // Add this entry into the last.
        const entry = { uri, time, serverId, displayName: displayName || uri, isValidated: true };
        editedList.push(entry);

        // Signal that we added in the entry
        this._onDidAddUri.fire(entry);

        return this.updateMemento(editedList);
    }
    public async removeUri(uri: string) {
        // Start with saved list.
        const uriList = await this.getSavedUriList();

        const editedList = uriList.filter((f) => f.uri !== uri);
        await this.updateMemento(editedList);
        const removedItem = uriList.find((f) => f.uri === uri);
        if (removedItem) {
            this._onDidRemoveUris.fire([removedItem]);
        }
    }
    private async updateMemento(editedList: IJupyterServerUriEntry[]) {
        // Sort based on time. Newest time first
        const sorted = editedList.sort((a, b) => {
            return b.time - a.time;
        });

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
    public async getSavedUriList(): Promise<IJupyterServerUriEntry[]> {
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
                                isValidated: true
                            };

                            if (uri === Settings.JupyterServerLocalLaunch) {
                                return;
                            }

                            try {
                                const idAndHandle = extractJupyterServerHandleAndId(uri);
                                if (idAndHandle) {
                                    return this.jupyterPickerRegistration
                                        .getJupyterServerUri(idAndHandle.id, idAndHandle.handle)
                                        .then(
                                            () => server,
                                            () => {
                                                server.isValidated = false;
                                                return server;
                                            }
                                        );
                                }
                            } catch (ex) {
                                traceVerbose(`Failed to extract jupyter server uri ${uri} ${ex}`);
                                server.isValidated = false;
                                return server;
                            }

                            return server;
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

    public async clearUriList(): Promise<void> {
        const uriList = await this.getSavedUriList();
        this.lastSavedList = Promise.resolve([]);
        // Clear out memento and encrypted storage
        await this.globalMemento.update(Settings.JupyterServerUriList, []);
        await this.encryptedStorage.store(
            Settings.JupyterServerRemoteLaunchService,
            Settings.JupyterServerRemoteLaunchUriListKey,
            undefined
        );

        // Notify out that we've removed the list to clean up controller entries, passwords, ect
        this._onDidRemoveUris.fire(
            uriList.map((uriListItem) => {
                return uriListItem;
            })
        );
    }
    public async getUriForServer(id: string): Promise<IJupyterServerUriEntry | undefined> {
        const savedList = await this.getSavedUriList();
        const uriItem = savedList.find((item) => item.serverId === id);

        return uriItem;
    }
    public async setUriToRemote(uri: string, displayName: string): Promise<void> {
        traceInfoIfCI(`setUri: ${uri}`);

        // display name is wrong here
        await this.addToUriList(uri, Date.now(), displayName ?? uri);
        this._onDidChangeUri.fire(); // Needs to happen as soon as we change so that dependencies update synchronously

        // Save in the storage (unique account per workspace)
        const key = await this.getUriAccountKey();
        await this.encryptedStorage.store(Settings.JupyterServerRemoteLaunchService, key, uri);
    }

    /**
     * Returns a unique identifier for the current workspace
     */
    private async getUriAccountKey(): Promise<string> {
        if (this.workspaceService.rootFolder) {
            // Folder situation
            return this.crypto.createHash(getFilePath(this.workspaceService.rootFolder), 'SHA-512');
        } else if (this.workspaceService.workspaceFile) {
            // Workspace situation
            return this.crypto.createHash(getFilePath(this.workspaceService.workspaceFile), 'SHA-512');
        }
        return this.appEnv.machineId; // Global key when no folder or workspace file
    }
}
