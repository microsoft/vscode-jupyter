// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { inject, injectable, named } from 'inversify';
import { EventEmitter, Memento } from 'vscode';
import {
    IWorkspaceService,
    IEncryptedStorage,
    IApplicationEnvironment
} from '../../../platform/common/application/types';
import { Settings } from '../../../platform/common/constants';
import { getFilePath } from '../../../platform/common/platform/fs-paths';
import { ICryptoUtils, IMemento, GLOBAL_MEMENTO } from '../../../platform/common/types';
import { IJupyterServerUriStorage } from '../types';
import { ServerConnectionType } from './serverConnectionType';

/**
 * Class for storing Jupyter Server URI values
 */
@injectable()
export class JupyterServerUriStorage implements IJupyterServerUriStorage {
    private remoteUris: string[] = [];
    private currentUriPromise: Promise<string[]> | undefined;
    private _onDidChangeUri = new EventEmitter<void>();
    public get onDidChangeUri() {
        return this._onDidChangeUri.event;
    }
    private _onDidRemoveUri = new EventEmitter<string>();
    public get onDidRemoveUri() {
        return this._onDidRemoveUri.event;
    }
    constructor(
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(ICryptoUtils) private readonly crypto: ICryptoUtils,
        @inject(IEncryptedStorage) private readonly encryptedStorage: IEncryptedStorage,
        @inject(IApplicationEnvironment) private readonly appEnv: IApplicationEnvironment,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento,
        @inject(ServerConnectionType) private readonly serverConnectionType: ServerConnectionType
    ) {
        // Cache our current state so we don't keep asking for it from the encrypted storage
        this.getUris().ignoreErrors();
    }
    public async addToUriList(uri: string, time: number, displayName: string) {
        // Uri list is saved partially in the global memento and partially in encrypted storage

        // Start with saved list.
        const uriList = await this.getSavedUriList();

        // Remove this uri if already found (going to add again with a new time)
        const editedList = uriList.filter((f, i) => {
            return f.uri !== uri && i < Settings.JupyterServerUriListMax - 1;
        });

        // Add this entry into the last.
        editedList.push({ uri, time, displayName: displayName || uri });

        return this.updateMemento(editedList);
    }
    public async removeUri(uri: string) {
        const activeUris = await this.getUris();
        // Start with saved list.
        const uriList = await this.getSavedUriList();

        // Remove this uri if already found (going to add again with a new time)
        const editedList = uriList.filter((f) => f.uri !== uri);
        await this.updateMemento(editedList);
        activeUris.splice(activeUris.indexOf(uri), 1);
        if (activeUris.length === 0) {
            await this.setUriToLocal();
        }
        this._onDidRemoveUri.fire(uri);
    }
    private async updateMemento(editedList: { uri: string; time: number; displayName?: string | undefined }[]) {
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
    public async getSavedUriList(): Promise<{ uri: string; time: number; displayName?: string | undefined }[]> {
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

                    // 'same' is specified for the display name to keep storage shorter if it is the same value as the URI
                    const displayName =
                        uriAndDisplayName[1] === Settings.JupyterServerRemoteLaunchUriEqualsDisplayName ||
                        !uriAndDisplayName[1]
                            ? uri
                            : uriAndDisplayName[1];
                    result.push({ time: indexes[i].time, displayName, uri });
                }
                return result;
            }
        }
        return [];
    }
    public async clearUriList(): Promise<void> {
        // Clear out memento and encrypted storage
        await this.globalMemento.update(Settings.JupyterServerUriList, []);
        await this.encryptedStorage.store(
            Settings.JupyterServerRemoteLaunchService,
            Settings.JupyterServerRemoteLaunchUriListKey,
            undefined
        );
    }
    private getUris(): Promise<string[]> {
        if (!this.currentUriPromise) {
            this.currentUriPromise = this.getUriInternal();
        }

        return this.currentUriPromise;
    }
    public async getRemoteUris(): Promise<string[]> {
        return this.getUris();
    }
    public async setUriToLocal(): Promise<void> {
        this.remoteUris = [];
        this.currentUriPromise = Promise.resolve(this.remoteUris);
        await this.serverConnectionType.setIsLocalLaunch(true);
        this._onDidChangeUri.fire();
    }
    public async addRemoteUri(uri: string, displayName: string): Promise<void> {
        this.remoteUris.push(uri);
        // Set the URI as our current state
        this.currentUriPromise = Promise.resolve(this.remoteUris);
        await this.addToUriList(uri, Date.now(), displayName);
        await this.serverConnectionType.setIsLocalLaunch(false);

        // Save in the storage (unique account per workspace)
        await this.encryptedStorage.store(
            Settings.JupyterServerRemoteLaunchService,
            this.getUrisAccountKey(),
            JSON.stringify(this.remoteUris)
        );
        this._onDidChangeUri.fire();
    }

    private async getUriInternal(): Promise<string[]> {
        if (this.serverConnectionType.isLocalLaunch) {
            return [];
        } else {
            // Should be stored in encrypted storage based on the workspace
            const [storedUri, storedUrisStr] = await Promise.all([
                // Old keys when we only supported one Uri.
                this.encryptedStorage.retrieve(Settings.JupyterServerRemoteLaunchService, this.getUriAccountKey()),
                this.encryptedStorage.retrieve(Settings.JupyterServerRemoteLaunchService, this.getUrisAccountKey())
            ]);
            let storedUris: string[] | undefined;
            try {
                storedUris = storedUrisStr ? JSON.parse(storedUrisStr) : undefined;
            } catch {
                //
            }
            this.remoteUris = Array.isArray(storedUris) ? storedUris : storedUri ? [storedUri] : [];
            return this.remoteUris;
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
    private getUrisAccountKey() {
        return `${this.getUriAccountKey()}_MULTIPLE`;
    }
}
