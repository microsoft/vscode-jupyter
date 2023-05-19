// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { noop } from '../../../platform/common/utils/misc';
import { RemoteJupyterServerUriProviderError } from '../../errors/remoteJupyterServerUriProviderError';
import { BaseError } from '../../../platform/errors/types';
import { IJupyterConnection } from '../../types';
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

    public async createConnectionInfo(options: { serverId: string } | { uri: string }) {
        const uri = 'uri' in options ? options.uri : await this.getUriFromServerId(options.serverId);
        if (!uri) {
            throw new Error('Server Not found');
        }
        return this.createConnectionInfoFromUri(uri);
    }
    public async validateRemoteUri(uri: string): Promise<void> {
        return this.validateRemoteConnection(await this.createConnectionInfoFromUri(uri));
    }

    private async getUriFromServerId(serverId: string) {
        // Since there's one server per session, don't use a resource to figure out these settings
        const savedList = await this.serverUriStorage.getAll();
        return savedList.find((item) => item.serverId === serverId)?.uri;
    }
    private async createConnectionInfoFromUri(uri: string) {
        const server = await this.getJupyterServerUri(uri);
        const idAndHandle = extractJupyterServerHandleAndId(uri);
        return createRemoteConnectionInfo(uri, server, idAndHandle?.id);
    }

    private async validateRemoteConnection(connection: IJupyterConnection): Promise<void> {
        let sessionManager: IJupyterSessionManager | undefined = undefined;
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

    private async getJupyterServerUri(uri: string) {
        const idAndHandle = extractJupyterServerHandleAndId(uri);
        if (!idAndHandle) {
            return;
        }
        try {
            return await this.jupyterPickerRegistration.getJupyterServerUri(idAndHandle.id, idAndHandle.handle);
        } catch (ex) {
            if (ex instanceof BaseError) {
                throw ex;
            }
            const serverId = await computeServerId(generateUriFromRemoteProvider(idAndHandle.id, idAndHandle.handle));
            throw new RemoteJupyterServerUriProviderError(idAndHandle.id, idAndHandle.handle, ex, serverId);
        }
    }
}
