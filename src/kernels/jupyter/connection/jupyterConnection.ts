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
import { IJupyterServerUriStorage, IJupyterSessionManagerFactory, IJupyterUriProviderRegistration } from '../types';
import { IAsyncDisposable } from '../../../platform/common/types';

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
        const uri = 'uri' in options ? options.uri : (await this.serverUriStorage.getMRU(options.serverId))?.uri;
        if (!uri) {
            throw new Error('Server Not found');
        }
        return this.createConnectionInfoFromUri(uri);
    }
    public async validateJupyterServer(uri: string): Promise<void> {
        const connection = await this.createConnectionInfoFromUri(uri);
        const disposable: IAsyncDisposable[] = [];
        try {
            // Attempt to list the running kernels. It will return empty if there are none, but will
            // throw if can't connect.
            const sessionManager = await this.jupyterSessionManagerFactory.create(connection, false);
            disposable.push(sessionManager);
            await Promise.all([sessionManager.getRunningKernels(), sessionManager.getKernelSpecs()]);
            // We should throw an exception if any of that fails.
        } finally {
            connection.dispose();
            await Promise.all(disposable.map((d) => d.dispose().catch(noop)));
        }
    }

    private async createConnectionInfoFromUri(uri: string) {
        const server = await this.getJupyterServerUri(uri);
        return createRemoteConnectionInfo(uri, server);
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
