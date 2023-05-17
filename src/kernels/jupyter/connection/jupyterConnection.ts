// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IExtensionSyncActivationService } from '../../../platform/activation/types';
import { IDisposableRegistry } from '../../../platform/common/types';
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
    IJupyterServerUri,
    IJupyterServerUriStorage,
    IJupyterSessionManager,
    IJupyterSessionManagerFactory,
    IJupyterUriProviderRegistration
} from '../types';

/**
 * Creates IJupyterConnection objects for URIs and 3rd party handles/ids.
 */
@injectable()
export class JupyterConnection implements IExtensionSyncActivationService {
    private uriToJupyterServerUri = new Map<string, IJupyterServerUri>();
    private pendingTimeouts: (NodeJS.Timeout | number)[] = [];
    constructor(
        @inject(IJupyterUriProviderRegistration)
        private readonly jupyterPickerRegistration: IJupyterUriProviderRegistration,
        @inject(IJupyterSessionManagerFactory)
        private readonly jupyterSessionManagerFactory: IJupyterSessionManagerFactory,
        @inject(IDisposableRegistry)
        private readonly disposables: IDisposableRegistry,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage
    ) {
        disposables.push(this);
    }
    public activate() {
        this.serverUriStorage.onDidChangeUri(
            () =>
                // When server URI changes, clear our pending URI timeouts
                this.clearTimeouts(),
            this,
            this.disposables
        );
    }
    public dispose() {
        this.clearTimeouts();
    }
    private clearTimeouts() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.pendingTimeouts.forEach((t) => clearTimeout(t as any));
        this.pendingTimeouts = [];
    }

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
        const savedList = await this.serverUriStorage.getSavedUriList();
        return savedList.find((item) => item.serverId === serverId)?.uri;
    }
    private async createConnectionInfoFromUri(uri: string) {
        // Prepare our map of server URIs
        await this.updateServerUri(uri);

        const idAndHandle = extractJupyterServerHandleAndId(uri);
        const server = this.uriToJupyterServerUri.get(uri);
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

    private async updateServerUri(uri: string): Promise<void> {
        const idAndHandle = extractJupyterServerHandleAndId(uri);
        if (idAndHandle) {
            try {
                const serverUri = await this.jupyterPickerRegistration.getJupyterServerUri(
                    idAndHandle.id,
                    idAndHandle.handle
                );
                this.uriToJupyterServerUri.set(uri, serverUri);
                // See if there's an expiration date
                if (serverUri.expiration) {
                    const timeoutInMS = serverUri.expiration.getTime() - Date.now();
                    // Week seems long enough (in case the expiration is ridiculous)
                    if (timeoutInMS > 0 && timeoutInMS < 604800000) {
                        this.pendingTimeouts.push(setTimeout(() => this.updateServerUri(uri).catch(noop), timeoutInMS));
                    }
                }
            } catch (ex) {
                if (ex instanceof BaseError) {
                    throw ex;
                }
                const serverId = await computeServerId(
                    generateUriFromRemoteProvider(idAndHandle.id, idAndHandle.handle)
                );
                throw new RemoteJupyterServerUriProviderError(idAndHandle.id, idAndHandle.handle, ex, serverId);
            }
        }
    }
}
