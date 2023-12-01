// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-use-before-define */

import { inject, injectable } from 'inversify';
import { traceError } from '../../../platform/logging';
import { IJupyterServerProviderRegistry, IJupyterServerUriStorage, JupyterServerProviderHandle } from '../types';
import { JupyterConnection } from './jupyterConnection';
import { JVSC_EXTENSION_ID, TestingKernelPickerProviderId } from '../../../platform/common/constants';

export type SelectJupyterUriCommandSource =
    | 'nonUser'
    | 'toolbar'
    | 'commandPalette'
    | 'nativeNotebookStatusBar'
    | 'nativeNotebookToolbar'
    | 'errorHandler'
    | 'prompt';

/**
 * Provides the UI for picking a remote server. Multiplexes to one of two implementations based on the 'showOnlyOneTypeOfKernel' experiment.
 */
@injectable()
export class JupyterServerSelector {
    constructor(
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection,
        @inject(IJupyterServerProviderRegistry) readonly serverProviderRegistry: IJupyterServerProviderRegistry
    ) {}

    public async addJupyterServer(provider: JupyterServerProviderHandle): Promise<void> {
        // Double check this server can be connected to. Might need a password, might need a allowUnauthorized
        try {
            await this.jupyterConnection.validateRemoteUri(provider);
        } catch (err) {
            traceError(`Error in validating the Remote Uri ${provider.id}.${provider.handle}`, err);
            return;
        }

        if (provider.extensionId === JVSC_EXTENSION_ID && provider.id === TestingKernelPickerProviderId) {
            // However for the tests, we need to add to the Storage, as thats the only way
            // to get the kernel finders registered.
            // More debt to be removed (or we need a better way for the tests to work by making this explicit).
            await this.serverUriStorage.add(provider);
            return;
        }
        // No need to add the Uri for providers using the new API.
        if (
            ![JVSC_EXTENSION_ID].includes(provider.extensionId) &&
            !this.serverProviderRegistry.jupyterCollections.some((c) => c.extensionId === provider.extensionId)
        ) {
            await this.serverUriStorage.add(provider);
        }
    }
}
