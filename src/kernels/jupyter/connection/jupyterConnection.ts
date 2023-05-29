// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { noop } from '../../../platform/common/utils/misc';
import { RemoteJupyterServerUriProviderError } from '../../errors/remoteJupyterServerUriProviderError';
import { BaseError } from '../../../platform/errors/types';
import { createRemoteConnectionInfo } from '../jupyterUtils';
import {
    IJupyterServerUri,
    IJupyterServerUriStorage,
    IJupyterSessionManager,
    IJupyterSessionManagerFactory,
    IJupyterUriProviderRegistration,
    JupyterServerProviderHandle
} from '../types';

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

    public async createConnectionInfo(serverHandle: JupyterServerProviderHandle) {
        const server = await this.serverUriStorage.get(serverHandle);
        if (!server) {
            throw new Error('Server Not found');
        }
        const serverUri = await this.getJupyterServerUri(serverHandle);
        return createRemoteConnectionInfo(serverHandle, serverUri);
    }

    public async validateRemoteUri(
        serverHandle: JupyterServerProviderHandle,
        serverUri?: IJupyterServerUri
    ): Promise<void> {
        let sessionManager: IJupyterSessionManager | undefined = undefined;
        serverUri = serverUri || (await this.getJupyterServerUri(serverHandle));
        const connection = createRemoteConnectionInfo(serverHandle, serverUri);
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

    private async getJupyterServerUri(serverHandle: JupyterServerProviderHandle) {
        try {
            return await this.jupyterPickerRegistration.getJupyterServerUri(serverHandle);
        } catch (ex) {
            if (ex instanceof BaseError) {
                throw ex;
            }
            throw new RemoteJupyterServerUriProviderError(serverHandle, ex);
        }
    }
}
