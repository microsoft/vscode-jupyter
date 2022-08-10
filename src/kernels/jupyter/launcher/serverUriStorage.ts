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
import { ICryptoUtils, IMemento, GLOBAL_MEMENTO, IsWebExtension } from '../../../platform/common/types';
import { traceError } from '../../../platform/logging';
import { computeServerId } from '../jupyterUtils';
import { IJupyterServerUriStorage, IServerConnectionType } from '../types';

export const mementoKeyToIndicateIfConnectingToLocalKernelsOnly = 'connectToLocalKernelsOnly';
export const currentServerHashKey = 'currentServerHash';

/**
 * Class for storing Jupyter Server URI values
 */
@injectable()
export class JupyterServerUriStorage implements IJupyterServerUriStorage, IServerConnectionType {
    private lastSavedList?: Promise<
        { uri: string; serverId: string; time: number; displayName?: string | undefined }[]
    >;
    private currentUriPromise: Promise<string | undefined> | undefined;
    private _currentServerId: string | undefined;
    private _localOnly: boolean = false;
    private _onDidChangeUri = new EventEmitter<void>();
    public get onDidChangeUri() {
        return this._onDidChangeUri.event;
    }
    private _onDidRemoveUris = new EventEmitter<string[]>();
    public get onDidRemoveUris() {
        return this._onDidRemoveUris.event;
    }
    public get currentServerId(): string | undefined {
        return this._currentServerId;
    }
    public get onDidChange(): Event<void> {
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
        @inject(IsWebExtension) readonly isWebExtension: boolean
    ) {
        // Remember if local only
        this._localOnly = isWebExtension
            ? false
            : this.globalMemento.get<boolean>(mementoKeyToIndicateIfConnectingToLocalKernelsOnly, true);
        this._currentServerId = this.globalMemento.get<string | undefined>(currentServerHashKey, undefined);

        // Cache our current state so we don't keep asking for it from the encrypted storage
        this.getUri().ignoreErrors();
    }
    public async addToUriList(uri: string, time: number, displayName: string) {
        // Uri list is saved partially in the global memento and partially in encrypted storage

        // Start with saved list.
        const uriList = await this.getSavedUriList();

        // Compute server id for saving in the list
        const serverId = await computeServerId(uri);

        // Remove this uri if already found (going to add again with a new time)
        const editedList = uriList.filter((f, i) => {
            return f.uri !== uri && i < Settings.JupyterServerUriListMax - 1;
        });

        // Add this entry into the last.
        editedList.push({ uri, time, serverId, displayName: displayName || uri });

        return this.updateMemento(editedList);
    }
    public async removeUri(uri: string) {
        const activeUri = await this.getUri();
        // Start with saved list.
        const uriList = await this.getSavedUriList();

        // Remove this uri if already found (going to add again with a new time)
        const editedList = uriList.filter((f) => f.uri !== uri);
        await this.updateMemento(editedList);
        if (activeUri === uri) {
            await this.setUriToLocal();
        }
        this._onDidRemoveUris.fire([uri]);
    }
    private async updateMemento(
        editedList: { uri: string; serverId: string; time: number; displayName?: string | undefined }[]
    ) {
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
    public async getSavedUriList(): Promise<
        { uri: string; serverId: string; time: number; displayName?: string | undefined }[]
    > {
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
                    const result = [];
                    for (let i = 0; i < split.length && i < indexes.length; i += 1) {
                        // Split out the display name and the URI (they were combined because display name may have secret tokens in it too)
                        const uriAndDisplayName = split[i].split(Settings.JupyterServerRemoteLaunchNameSeparator);
                        const uri = uriAndDisplayName[0];
                        const serverId = await computeServerId(uri);

                        // 'same' is specified for the display name to keep storage shorter if it is the same value as the URI
                        const displayName =
                            uriAndDisplayName[1] === Settings.JupyterServerRemoteLaunchUriEqualsDisplayName ||
                            !uriAndDisplayName[1]
                                ? uri
                                : uriAndDisplayName[1];
                        result.push({ time: indexes[i].time, serverId, displayName, uri });
                    }
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
                return uriListItem.uri;
            })
        );
    }
    public getUri(): Promise<string | undefined> {
        if (!this.currentUriPromise) {
            this.currentUriPromise = this.getUriInternal();
        }

        return this.currentUriPromise;
    }
    public async getRemoteUri(): Promise<string | undefined> {
        try {
            const uri = await this.getUri();
            switch (uri) {
                case Settings.JupyterServerLocalLaunch:
                    return;
                case Settings.JupyterServerRemoteLaunch:
                    // In `getUriInternal` its not possible for us to end up with Settings.JupyterServerRemoteLaunch.
                    // If we do, then this means the uri was never saved or not in encrypted store, hence no point returning and invalid entry.
                    return;
                default:
                    return uri;
            }
        } catch (e) {
            traceError(`Exception getting uri: ${e}`);
            return;
        }
    }
    public async setUriToLocal(): Promise<void> {
        await this.setUri(Settings.JupyterServerLocalLaunch);
    }
    public async setUriToRemote(uri: string, displayName: string): Promise<void> {
        // Make sure to add to the saved list before we set the uri. Otherwise
        // handlers for the URI changing will use the saved list to make sure the
        // server id matches
        await this.addToUriList(uri, Date.now(), displayName);
        await this.setUri(uri);
    }

    public async setUriToNone(): Promise<void> {
        return this.setUri(undefined);
    }

    public async setUri(uri: string | undefined) {
        // Set the URI as our current state
        this.currentUriPromise = Promise.resolve(uri);
        this._currentServerId = uri ? await computeServerId(uri) : undefined;
        this._localOnly = (uri === Settings.JupyterServerLocalLaunch || uri === undefined) && !this.isWebExtension;
        this._onDidChangeUri.fire(); // Needs to happen as soon as we change so that dependencies update synchronously

        // No update the async parts
        await this.globalMemento.update(mementoKeyToIndicateIfConnectingToLocalKernelsOnly, this._localOnly);
        await this.globalMemento.update(currentServerHashKey, this._currentServerId);

        if (!this._localOnly && uri) {
            await this.addToUriList(uri, Date.now(), uri);

            // Save in the storage (unique account per workspace)
            const key = this.getUriAccountKey();
            await this.encryptedStorage.store(Settings.JupyterServerRemoteLaunchService, key, uri);
        }
    }
    private async getUriInternal(): Promise<string | undefined> {
        if (this.isLocalLaunch) {
            return Settings.JupyterServerLocalLaunch;
        } else {
            // Should be stored in encrypted storage based on the workspace
            const key = this.getUriAccountKey();
            const storedUri = await this.encryptedStorage.retrieve(Settings.JupyterServerRemoteLaunchService, key);

            // Update server id if not already set
            if (!this._currentServerId && storedUri) {
                this._currentServerId = await computeServerId(storedUri);
            }

            return storedUri;
        }
    }

    /**
     * Returns a unique identifier for the current workspace
     */
    private getUriAccountKey(): string {
        if (this.workspaceService.rootFolder) {
            // Folder situation
            return this.crypto.createHash(getFilePath(this.workspaceService.rootFolder), 'string', 'SHA512');
        } else if (this.workspaceService.workspaceFile) {
            // Workspace situation
            return this.crypto.createHash(getFilePath(this.workspaceService.workspaceFile), 'string', 'SHA512');
        }
        return this.appEnv.machineId; // Global key when no folder or workspace file
    }
}
