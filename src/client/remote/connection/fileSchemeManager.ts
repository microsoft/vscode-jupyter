// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Uri } from 'vscode';
import { IEncryptedStorage } from '../../common/application/types';
import { JVSC_EXTENSION_ID } from '../../common/constants';
import { traceError } from '../../common/logger';
import { IJupyterConnection } from '../../datascience/types';

const KeyToStoreFileSchemesAgainstConnections = 'RemoteConnectionsWithFileSchemes';
type ConnectionWithScheme = {
    url: string;
    fileScheme: string;
};
/**
 * Responsible for generating a file scheme for a Jupyter Server.
 * Assume we connection to servers http://myserver:8888/ & http://yourserver:8888/
 * The file schemes (for remote file system provider) will need to be unique.
 * We try to use myserver8888 & yourserver8888 as the file scehemes.
 * We also store the file scheme & url mapping.
 * If you close VS Code with a remote file open & then re-open VS Code tomorrow, then VS Code asks extension for contents of the file myserver8888://test.ipynb.
 * At this point, extension is not connected to the remote server, & we need the url for the server.
 * This is why we save the url against the file scheme.
 *
 * Also, its possible someone connects to a jupyter hub server, at this point
 * we have an address http://myserver:8888/user/donjayamanne/
 * We cannot use the file scheme myserver8888, at this point we use myserver8888userdonjayamanne.
 *
 * Basically file schemes need to be unique & we need to store the original Url it was associated with.
 * This class does that.
 */
@injectable()
export class RemoteFileSchemeManager {
    private loadedStorage?: Promise<ConnectionWithScheme[]>;
    private saving: Promise<void> = Promise.resolve();
    constructor(@inject(IEncryptedStorage) private readonly encryptedStorage: IEncryptedStorage) {}
    /**
     * Gets the file scheme associated with a Remote Url (& saves it for future use).
     */
    public async getFileScheme(info: IJupyterConnection): Promise<string> {
        const existingItems = await this.getStoredSettings();
        const found = existingItems.find((item) => item.url.toLowerCase() === info.baseUrl.toLowerCase());
        if (found) {
            return found.fileScheme;
        }

        // Generate a file scheme.
        const fileScheme = this.generateFileScheme(info, existingItems);
        await this.saveFileScheme(fileScheme, info.baseUrl);
        // Save this if not already saved.
        return fileScheme;
    }
    /**
     * Gets the Url that was associated with a give file scheme.
     */
    public async getAssociatedUrl(fileScheme: string): Promise<string | undefined> {
        const settings = await this.getStoredSettings();
        return settings.find((item) => item.fileScheme === fileScheme)?.url;
    }
    private async saveFileScheme(fileScheme: string, url: string) {
        this.saving = this.saving
            .then(async () => {
                // Always get latest before updating.
                // We don't want to override information from another session.
                let existingStorage = await this.getStoredSettings();
                // Remove previous entries for the same scheme & url.
                // We don't want duplicates.
                existingStorage = existingStorage.filter(
                    (item) => item.fileScheme !== fileScheme && item.url.toLowerCase() !== url.toLowerCase()
                );
                existingStorage.push({ fileScheme, url });

                await this.encryptedStorage.store(
                    JVSC_EXTENSION_ID,
                    KeyToStoreFileSchemesAgainstConnections,
                    JSON.stringify(existingStorage)
                );
            })
            .catch((ex) => traceError('Failed to save Url & scheme in protected store', ex));

        await this.saving;
    }
    private generateFileScheme(info: IJupyterConnection, availableSchemes: ConnectionWithScheme[]) {
        const baseUrl = info.baseUrl.toLowerCase();
        let fileScheme = Uri.parse(baseUrl).authority.replace(/[^a-z0-9+]+/gi, '');
        // if we have other servers with the same scheme, then use the full url.
        if (availableSchemes.some((item) => item.fileScheme === fileScheme)) {
            fileScheme = baseUrl.replace(/[^a-z0-9+]+/gi, '');
        }
        return fileScheme;
    }
    private async getStoredSettings() {
        if (this.loadedStorage) {
            return this.loadedStorage;
        }
        return (this.loadedStorage = this.encryptedStorage
            .retrieve(JVSC_EXTENSION_ID, KeyToStoreFileSchemesAgainstConnections)
            .then((data) => {
                if (!data || data.length === 0) {
                    return [];
                }
                try {
                    return JSON.parse(data) as ConnectionWithScheme[];
                } catch (ex) {
                    traceError('Failed to parse secret stored in store with connection & file scheme', ex);
                    return [];
                }
            }));
    }
}
