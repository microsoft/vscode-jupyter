// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { ICommandManager } from '../../../platform/common/application/types';
import { Commands } from '../../../platform/common/constants';
import { IDisposable, IDisposableRegistry } from '../../../platform/common/types';
import { IJupyterServerUriStorage, IJupyterUriProviderRegistration } from '../types';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { isBuiltInJupyterServerProvider } from '../helpers';

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
                    await this.serverUriStorage.clear();
                    const builtInProviders = (await this.registrations.getProviders()).filter((p) =>
                        isBuiltInJupyterServerProvider(p.id)
                    );

                    await Promise.all(
                        builtInProviders.map(async (provider) => {
                            if (provider.getHandles && provider.removeHandle) {
                                const handles = await provider.getHandles();
                                for (const handle of handles) {
                                    await provider.removeHandle(handle);
                                }
                            }
                        })
                    );
                },
                this
            )
        );
    }
}
