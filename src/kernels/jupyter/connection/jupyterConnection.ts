// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { noop } from '../../../platform/common/utils/misc';
import { RemoteJupyterServerUriProviderError } from '../../errors/remoteJupyterServerUriProviderError';
import { BaseError } from '../../../platform/errors/types';
import {
    computeServerId,
    createRemoteConnectionInfo,
    extractJupyterServerHandleAndId,
    generateUriFromRemoteProvider
} from '../jupyterUtils';
import {
    IJupyterServerUriStorage,
    IJupyterSessionManager,
    IJupyterSessionManagerFactory,
    IJupyterUriProviderRegistration
} from '../types';
import { IJupyterServerUri, JupyterServerUriHandle } from '../../../api';

/**
 * Creates IJupyterConnection objects for URIs and 3rd party handles/ids.
 */
@injectable()
export class JupyterConnection {
    constructor(
        @inject(IJupyterUriProviderRegistration)
        private readonly jupyterPickerRegistration: IJupyterUriProviderRegistration,
        @inject(IJupyterSessionManagerFactory)
        private readonly jupyterSessionManagerFactory: IJupyterSessionManagerFactory,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage
    ) {}

    public async createConnectionInfo(serverId: string) {
        const server = await this.serverUriStorage.get(serverId);
        if (!server) {
            throw new Error('Server Not found');
        }
        const provider = extractJupyterServerHandleAndId(server.uri);
        const serverUri = await this.getJupyterServerUri(provider);
        return createRemoteConnectionInfo(provider, serverUri);
    }

    public async validateRemoteUri(
        provider: { id: string; handle: JupyterServerUriHandle },
        serverUri?: IJupyterServerUri
    ): Promise<void> {
        let sessionManager: IJupyterSessionManager | undefined = undefined;
        serverUri = serverUri || (await this.getJupyterServerUri(provider));
        const connection = await createRemoteConnectionInfo(provider, serverUri);
        try {
            // Attempt to list the running kernels. It will return empty if there are none, but will
            // throw if can't connect.
            sessionManager = await this.jupyterSessionManagerFactory.create(connection, false);
            await Promise.all([sessionManager.getRunningKernels(), sessionManager.getKernelSpecs()]);
            // We should throw an exception if any of that fails.
        } finally {
            connection.dispose();
            if (sessionManager) {
                sessionManager.dispose().catch(noop);
            }
        }
    }

    private async getJupyterServerUri(provider: { id: string; handle: JupyterServerUriHandle }) {
        try {
            return await this.jupyterPickerRegistration.getJupyterServerUri(provider.id, provider.handle);
        } catch (ex) {
            if (ex instanceof BaseError) {
                throw ex;
            }
            const serverId = await computeServerId(generateUriFromRemoteProvider(provider.id, provider.handle));
            throw new RemoteJupyterServerUriProviderError(provider.id, provider.handle, ex, serverId);
        }
    }
}
