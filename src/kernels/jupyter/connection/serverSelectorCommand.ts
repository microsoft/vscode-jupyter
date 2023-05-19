// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Uri } from 'vscode';
import { ICommandManager } from '../../../platform/common/application/types';
import { Commands } from '../../../platform/common/constants';
import { IDisposable } from '../../../platform/common/types';
import { traceInfo } from '../../../platform/logging';
import { JupyterServerSelector } from './serverSelector';
import { IJupyterServerUriStorage } from '../types';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';

/**
 * Registers commands to allow the user to set the remote server URI.
 */
@injectable()
export class JupyterServerSelectorCommand implements IExtensionSyncActivationService {
    private readonly disposables: IDisposable[] = [];
    constructor(
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(JupyterServerSelector) private readonly serverSelector: JupyterServerSelector,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage
    ) {}
    public activate() {
        this.disposables.push(
            this.commandManager.registerCommand(Commands.SelectJupyterURI, this.selectJupyterUri, this)
        );
        this.disposables.push(
            this.commandManager.registerCommand(Commands.ClearSavedJupyterUris, this.clearJupyterUris, this)
        );
    }
    public dispose() {
        this.disposables.forEach((d) => d.dispose());
    }

    private async selectJupyterUri(source: Uri): Promise<void> {
        if (source instanceof Uri) {
            traceInfo(`Setting Jupyter Server URI to remote: ${source}`);

            // Set the uri directly
            await this.serverSelector.addJupyterServer(source.toString(true));
        }
    }

    private async clearJupyterUris(): Promise<void> {
        return this.serverUriStorage.clear();
    }
}
