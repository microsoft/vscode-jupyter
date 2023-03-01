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
import { noop } from '../../../platform/common/utils/misc';
import { traceError, traceInfoIfCI, traceVerbose } from '../../../platform/logging';
import { computeServerId, extractJupyterServerHandleAndId } from '../jupyterUtils';
import { IJupyterServerUriEntry, IJupyterServerUriStorage, IJupyterUriProviderRegistration } from '../types';

export const mementoKeyToIndicateIfConnectingToLocalKernelsOnly = 'connectToLocalKernelsOnly';
export const currentServerHashKey = 'currentServerHash';

/**
 * Class for storing Jupyter Server URI values
 */
@injectable()
export class JupyterServerUriStorage implements IJupyterServerUriStorage {
    private lastSavedList?: Promise<IJupyterServerUriEntry[]>;
    private currentUriPromise: Promise<IJupyterServerUriEntry | undefined> | undefined;
    private _currentServerId: string | undefined;
    private _localOnly: boolean = false;
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
    public get currentServerId(): string | undefined {
        return this._currentServerId;
    }
    public get onDidChangeConnectionType(): Event<void> {
        return this._onDidChangeUri.event;
    }
    public get isLocalLaunch(): boolean {
        return this._localOnly;
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
    ) {
        // Remember if local only
        traceInfoIfCI(`JupyterServerUriStorage: isWebExtension: ${isWebExtension}`);
        traceInfoIfCI(
            `Global memento: ${this.globalMemento.get<boolean>(
                mementoKeyToIndicateIfConnectingToLocalKernelsOnly,
                true
            )}`
        );
        this._localOnly = isWebExtension
            ? false
            : this.globalMemento.get<boolean>(mementoKeyToIndicateIfConnectingToLocalKernelsOnly, true);
        this._currentServerId = this.globalMemento.get<string | undefined>(currentServerHashKey, undefined);

        // Cache our current state so we don't keep asking for it from the encrypted storage
        this.getUri().catch(noop);
    }
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
    public async addToUriList(uri: string, time: number, displayName: string) {
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

        if (this.currentUriPromise) {
            const currentUri = await this.currentUriPromise;
            if (currentUri && currentUri.uri === uri) {
                this.currentUriPromise = Promise.resolve(entry);
            }
        }

        // Signal that we added in the entry
        this._onDidAddUri.fire(entry);

        return this.updateMemento(editedList);
    }
    public async removeUri(uri: string) {
        const activeUri = await this.getUri();
        // Start with saved list.
        const uriList = await this.getSavedUriList();

        const editedList = uriList.filter((f) => f.uri !== uri);
        await this.updateMemento(editedList);
        if (activeUri?.uri === uri) {
            await this.setUriToLocal();
        }
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
                                return server;
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
                    return result;
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
    public getUri(): Promise<IJupyterServerUriEntry | undefined> {
        if (!this.currentUriPromise) {
            this.currentUriPromise = this.getUriInternal();
        }

        return this.currentUriPromise;
    }
    public async getRemoteUri(): Promise<IJupyterServerUriEntry | undefined> {
        try {
            const uri = await this.getUri();
            traceInfoIfCI(`getRemoteUri: ${uri?.uri}`);
            if (uri?.uri === Settings.JupyterServerLocalLaunch) {
                return;
            }
            return uri;
        } catch (e) {
            traceError(`Exception getting uri: ${e}`);
            return;
        }
    }
    public async getUriForServer(id: string): Promise<IJupyterServerUriEntry | undefined> {
        const savedList = await this.getSavedUriList();
        const uriItem = savedList.find((item) => item.serverId === id);

        return uriItem;
    }
    public async setUriToLocal(): Promise<void> {
        traceInfoIfCI(`setUriToLocal`);
        await this.setUri(Settings.JupyterServerLocalLaunch, undefined);
    }
    public async setUriToRemote(uri: string, displayName: string): Promise<void> {
        // Make sure to add to the saved list before we set the uri. Otherwise
        // handlers for the URI changing will use the saved list to make sure the
        // server id matches
        await this.addToUriList(uri, Date.now(), displayName);
        await this.setUri(uri, displayName);
    }

    public async setUriToNone(): Promise<void> {
        traceInfoIfCI(`setUriToNone`);
        return this.setUri(undefined, undefined);
    }

    public async setUri(uri: string | undefined, displayName: string | undefined) {
        // Set the URI as our current state
        this._currentServerId = uri ? await computeServerId(uri) : undefined;
        const entry: IJupyterServerUriEntry | undefined =
            uri && this._currentServerId
                ? {
                      uri,
                      time: Date.now(),
                      serverId: this._currentServerId,
                      displayName: displayName || uri,
                      isValidated: true
                  }
                : undefined;

        this.currentUriPromise = Promise.resolve(entry);
        traceInfoIfCI(`setUri: ${uri}`);
        this._localOnly = (uri === Settings.JupyterServerLocalLaunch || uri === undefined) && !this.isWebExtension;
        this._onDidChangeUri.fire(); // Needs to happen as soon as we change so that dependencies update synchronously

        // No update the async parts
        await this.globalMemento.update(mementoKeyToIndicateIfConnectingToLocalKernelsOnly, this._localOnly);
        await this.globalMemento.update(currentServerHashKey, this._currentServerId);

        if (!this._localOnly && uri) {
            // disaplay name is wrong here
            await this.addToUriList(uri, Date.now(), displayName ?? uri);

            // Save in the storage (unique account per workspace)
            const key = await this.getUriAccountKey();
            await this.encryptedStorage.store(Settings.JupyterServerRemoteLaunchService, key, uri);
        }
    }
    private async getUriInternal(): Promise<IJupyterServerUriEntry | undefined> {
        const savedList = await this.getSavedUriList();
        if (this.isLocalLaunch) {
            return (
                savedList.find((item) => item.uri === Settings.JupyterServerLocalLaunch) ?? {
                    uri: Settings.JupyterServerLocalLaunch,
                    time: Date.now(),
                    serverId: '',
                    displayName: 'local',
                    isValidated: true
                }
            );
        } else {
            // Should be stored in encrypted storage based on the workspace
            const key = await this.getUriAccountKey();
            const storedUri = await this.encryptedStorage.retrieve(Settings.JupyterServerRemoteLaunchService, key);

            // Update server id if not already set
            if (!this._currentServerId && storedUri) {
                this._currentServerId = await computeServerId(storedUri);
            }

            return savedList.find((item) => item.serverId === this._currentServerId);
        }
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
