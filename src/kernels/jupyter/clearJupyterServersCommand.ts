// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { ICommandManager } from '../../platform/common/application/types';
import { Commands } from '../../platform/common/constants';
import { IDisposable, IDisposableRegistry } from '../../platform/common/types';
import { IJupyterServerUriStorage, IJupyterUriProviderRegistration } from './types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { noop } from '../../platform/common/utils/misc';

/**
 * Registers commands to allow the user to set the remote server URI.
 */
@injectable()
export class ClearJupyterServersCommand implements IExtensionSyncActivationService {
    constructor(
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(IJupyterUriProviderRegistration) private readonly registrations: IJupyterUriProviderRegistration,
        @inject(IDisposableRegistry) private readonly disposables: IDisposable[]
    ) {}
    public activate() {
        this.disposables.push(
            this.commandManager.registerCommand(
                Commands.ClearSavedJupyterUris,
                async () => {
                    await this.serverUriStorage.clear().catch(noop);
                    await Promise.all(
                        this.registrations.providers
                            .filter((p) => p.id.startsWith('_builtin'))
                            .map(async (provider) => {
                                if (provider.getHandles && provider.removeHandle) {
                                    const handles = await provider.getHandles().catch(() => []);
                                    for (const handle of handles) {
                                        await provider.removeHandle(handle).catch(noop);
                                    }
                                }
                            })
                    ).catch(noop);
                    await this.commandManager
                        .executeCommand('dataScience.ClearUserProviderJupyterServerCache')
                        .then(noop, noop);
                },
                this
            )
        );
    }
}
