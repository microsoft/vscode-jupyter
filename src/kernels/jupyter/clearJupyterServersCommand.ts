// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { ICommandManager } from '../../platform/common/application/types';
import { Commands } from '../../platform/common/constants';
import { IDisposable, IDisposableRegistry } from '../../platform/common/types';
import { IJupyterServerUriStorage } from './types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';

/**
 * Registers commands to allow the user to set the remote server URI.
 */
@injectable()
export class ClearJupyterServersCommand implements IExtensionSyncActivationService {
    constructor(
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(IDisposableRegistry) private readonly disposables: IDisposable[]
    ) {}
    public activate() {
        this.disposables.push(
            this.commandManager.registerCommand(
                Commands.ClearSavedJupyterUris,
                () => this.serverUriStorage.clear(),
                this
            )
        );
    }
}
