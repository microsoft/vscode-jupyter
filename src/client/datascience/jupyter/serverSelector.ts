// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { ICommandManager } from '../../common/application/types';
import { DataScience } from '../../common/utils/localize';
import { noop } from '../../common/utils/misc';
import { captureTelemetry, sendTelemetryEvent } from '../../telemetry';
import { Settings, Telemetry } from '../constants';
import { IJupyterServerUriStorage } from '../types';
import { JupyterServerPicker } from './serverPicker';

type SelectedServer = {
    providerId?: string;
    uri?: string;
};
@injectable()
export class JupyterServerSelector {
    constructor(
        @inject(ICommandManager) private cmdManager: ICommandManager,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(JupyterServerPicker) private readonly jupyterServerPicker: JupyterServerPicker
    ) {}

    @captureTelemetry(Telemetry.SelectJupyterURI)
    public async selectJupyterURI(allowLocal: boolean): Promise<void> {
        const selection = await this.jupyterServerPicker.selectJupyterURI(allowLocal);
        switch (selection?.selection) {
            case 'local': {
                await this.setJupyterURIToLocal();
                break;
            }
            case 'remote': {
                await this.setJupyterURIToRemote(selection.uri);
                break;
            }
            default:
            //
        }
    }

    @captureTelemetry(Telemetry.SetJupyterURIToLocal)
    private async setJupyterURIToLocal(): Promise<void> {
        const previousValue = await this.serverUriStorage.getUri();
        await this.serverUriStorage.setUri(Settings.JupyterServerLocalLaunch);

        // Reload if there's a change
        if (previousValue !== Settings.JupyterServerLocalLaunch) {
            this.cmdManager
                .executeCommand('jupyter.reloadVSCode', DataScience.reloadAfterChangingJupyterServerConnection())
                .then(noop, noop);
        }
    }

    private async setJupyterURIToRemote(userURI: string): Promise<void> {
        const previousValue = await this.serverUriStorage.getUri();
        await this.serverUriStorage.setUri(userURI);

        // Indicate setting a jupyter URI to a remote setting. Check if an azure remote or not
        sendTelemetryEvent(Telemetry.SetJupyterURIToUserSpecified, undefined, {
            azure: userURI.toLowerCase().includes('azure')
        });

        // Reload if there's a change
        if (previousValue !== userURI) {
            this.cmdManager
                .executeCommand('jupyter.reloadVSCode', DataScience.reloadAfterChangingJupyterServerConnection())
                .then(noop, noop);
        }
    }
}
