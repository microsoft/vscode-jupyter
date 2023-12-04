// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Commands, JVSC_EXTENSION_ID } from '../../platform/common/constants';
import { IDisposable, IDisposableRegistry } from '../../platform/common/types';
import { IJupyterServerProviderRegistry, IJupyterServerUriStorage } from './types';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { noop } from '../../platform/common/utils/misc';
import { CancellationTokenSource, commands } from 'vscode';

/**
 * Registers commands to allow the user to set the remote server URI.
 */
@injectable()
export class ClearJupyterServersCommand implements IExtensionSyncActivationService {
    constructor(
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(IJupyterServerProviderRegistry) private readonly registrations: IJupyterServerProviderRegistry,
        @inject(IDisposableRegistry) private readonly disposables: IDisposable[]
    ) {}
    public activate() {
        this.disposables.push(
            commands.registerCommand(
                Commands.ClearSavedJupyterUris,
                async () => {
                    await this.serverUriStorage.clear().catch(noop);
                    await Promise.all(
                        this.registrations.jupyterCollections
                            .filter((p) => p.id.startsWith('_builtin') || p.extensionId === JVSC_EXTENSION_ID)
                            .map(async (provider) => {
                                if (!provider.serverProvider || !provider.serverProvider.removeJupyterServer) {
                                    return;
                                }
                                const token = new CancellationTokenSource();
                                const servers = await Promise.resolve(
                                    provider.serverProvider.provideJupyterServers(token.token)
                                );
                                await Promise.all(
                                    (servers || []).map((server) =>
                                        provider.serverProvider!.removeJupyterServer!(server).catch(noop)
                                    )
                                );
                            })
                    ).catch(noop);
                    await commands.executeCommand('dataScience.ClearUserProviderJupyterServerCache').then(noop, noop);
                },
                this
            )
        );
    }
}
