// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { inject, injectable, named } from 'inversify';
import * as keytar from 'keytar';
import { ConfigurationTarget, Memento } from 'vscode';
import { IWorkspaceService } from '../../common/application/types';
import { GLOBAL_MEMENTO, IConfigurationService, IMemento } from '../../common/types';
import { Settings } from '../constants';
import { IJupyterServerUriStorage } from '../types';

/**
 * Class for storing Jupyter Server URI values
 */
@injectable()
export class JupyterServerUriStorage implements IJupyterServerUriStorage {
    constructor(
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento
    ) {}
    public async addToUriList(uri: string, time: number, displayName: string) {
        // Uri list is saved partially in the global memento and partially in keytar

        // Start with saved list.
        const uriList = await this.getSavedUriList();

        // Make sure not already in the list. Redundant to add more than once.
        // We could reorder the list but seems unnecessary?
        if (!uriList.find((f) => f.uri === uri)) {
            // Make sure we leave out the max
            const editList = uriList.filter((f, i) => {
                return f.uri !== uri && i < Settings.JupyterServerUriListMax - 1;
            });
            editList.splice(0, 0, { uri, time, displayName });

            // Transform the editList into just indexes
            const mementoList = editList.map((v, i) => {
                return { index: i, time: v.time, displayName: v.displayName };
            });

            // Then write just the indexes to global memento
            await this.globalMemento.update(Settings.JupyterServerUriList, mementoList);

            // Write the uris to the keytar storage in one big blob (max length issues?)
            // This is because any part of the URI may be a secret (we don't know it's just token values for instance)
            const blob = editList.map((e) => e.uri).join(Settings.JupyterServerRemoteLaunchUriSeparator);
            return keytar.setPassword(
                Settings.JupyterServerRemoteLaunchService,
                Settings.JupyterServerRemoteLaunchUriAccount,
                blob
            );
        }
    }
    public async getSavedUriList(): Promise<{ uri: string; time: number; displayName?: string | undefined }[]> {
        // List is in the global memento, URIs are in keytar storage
        const indexes = this.globalMemento.get<{ index: number; time: number; displayName?: string }[]>(
            Settings.JupyterServerUriList
        );
        if (indexes && indexes.length > 0) {
            // Pull out the \r separated URI list (\r is an invalid URI character)
            const blob = await keytar.getPassword(
                Settings.JupyterServerRemoteLaunchService,
                Settings.JupyterServerRemoteLaunchUriAccount
            );
            if (blob) {
                return blob.split(Settings.JupyterServerRemoteLaunchUriSeparator).map((u, i) => {
                    return { time: indexes[i].time, displayName: indexes[i].displayName, uri: u };
                });
            }
        }
        return [];
    }
    public async getUri(): Promise<string> {
        const uri = this.configService.getSettings(undefined).jupyterServerURI;
        if (uri === Settings.JupyterServerLocalLaunch) {
            return uri;
        } else {
            // If settings has a token in it, remove it
            if (uri !== Settings.JupyterServerRemoteLaunch) {
                await this.setUri(uri);
            }

            // Should be stored in keytar storage
            const storedUri = await keytar.getPassword(
                Settings.JupyterServerRemoteLaunchService,
                this.getWorkspaceAccount()
            );

            return storedUri || uri;
        }
    }

    public async setUri(uri: string) {
        if (uri === Settings.JupyterServerLocalLaunch) {
            // Just save directly into the settings
            await this.configService.updateSetting(
                'jupyterServerURI',
                Settings.JupyterServerLocalLaunch,
                undefined,
                ConfigurationTarget.Workspace
            );
        } else {
            // This is a remote setting. Save in the settings as remote
            await this.configService.updateSetting(
                'jupyterServerURI',
                Settings.JupyterServerRemoteLaunch,
                undefined,
                ConfigurationTarget.Workspace
            );

            // Save in the keytar storage (unique account per workspace)
            await keytar.setPassword(Settings.JupyterServerRemoteLaunchService, this.getWorkspaceAccount(), uri);
        }
    }

    /**
     * Returns a unique identifier for the current workspace
     */
    private getWorkspaceAccount(): string {
        return this.workspaceService.getWorkspaceFolderIdentifier(undefined);
    }
}
