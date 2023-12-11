// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-use-before-define */

import { inject, injectable } from 'inversify';
import { traceError } from '../platform/logging';
import {
    IJupyterServerProviderRegistry,
    IJupyterServerUriStorage,
    JupyterServerProviderHandle
} from '../kernels/jupyter/types';
import { JupyterConnection } from '../kernels/jupyter/connection/jupyterConnection';
import { CodespaceExtensionId } from '../platform/common/constants';

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
export class CodespacesJupyterServerSelector {
    constructor(
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection,
        @inject(IJupyterServerProviderRegistry) readonly serverProviderRegistry: IJupyterServerProviderRegistry
    ) {}

    public async addJupyterServer(provider: JupyterServerProviderHandle): Promise<void> {
        if (provider.extensionId.toLowerCase() != CodespaceExtensionId.toLowerCase()) {
            throw new Error('Deprecated API');
        }
        // Double check this server can be connected to. Might need a password, might need a allowUnauthorized
        try {
            await this.jupyterConnection.validateRemoteUri(provider);
        } catch (err) {
            traceError(`Error in validating the Remote Uri ${provider.id}.${provider.handle}`, err);
            return;
        }

        // No need to add the Uri for providers using the new API.
        // Only codespaces uses the old API.
        if (!this.serverProviderRegistry.jupyterCollections.some((c) => c.extensionId === provider.extensionId)) {
            await this.serverUriStorage.add(provider);
        }
    }
}
