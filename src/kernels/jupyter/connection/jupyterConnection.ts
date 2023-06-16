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
    generateUriFromRemoteProvider,
    handleExpiredCertsError,
    handleSelfCertsError
} from '../jupyterUtils';
import {
    IJupyterServerUriStorage,
    IJupyterSessionManager,
    IJupyterSessionManagerFactory,
    IJupyterUriProviderRegistration
} from '../types';
import { IJupyterServerUri, JupyterServerUriHandle } from '../../../api';
import { JupyterSelfCertsError } from '../../../platform/errors/jupyterSelfCertsError';
import { Telemetry, sendTelemetryEvent } from '../../../telemetry';
import { JupyterSelfCertsExpiredError } from '../../../platform/errors/jupyterSelfCertsExpiredError';
import { IDataScienceErrorHandler } from '../../errors/types';
import { IApplicationShell } from '../../../platform/common/application/types';
import { Experiments, IConfigurationService, IExperimentService } from '../../../platform/common/types';
import { RemoteJupyterServerConnectionError } from '../../../platform/errors/remoteJupyterServerConnectionError';

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
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IDataScienceErrorHandler)
        private readonly errorHandler: IDataScienceErrorHandler,
        @inject(IExperimentService)
        private readonly experiments: IExperimentService
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
        serverUri?: IJupyterServerUri,
        doNotDisplayUnActionableMessages?: boolean
    ): Promise<void> {
        if (this.experiments.inExperiment(Experiments.PasswordManager)) {
            return this.validateRemoteUriNew(provider, serverUri, doNotDisplayUnActionableMessages);
        } else {
            return this.validateRemoteUriOld(provider, serverUri);
        }
    }
    private async validateRemoteUriOld(
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
    public async validateRemoteUriNew(
        provider: { id: string; handle: JupyterServerUriHandle },
        serverUri?: IJupyterServerUri,
        doNotDisplayUnActionableMessages?: boolean
    ): Promise<void> {
        let sessionManager: IJupyterSessionManager | undefined = undefined;
        serverUri = serverUri || (await this.getJupyterServerUri(provider));
        const connection = await createRemoteConnectionInfo(provider, serverUri);
        try {
            // Attempt to list the running kernels. It will return empty if there are none, but will
            // throw if can't connect.
            sessionManager = await this.jupyterSessionManagerFactory.create(connection);
            await Promise.all([sessionManager.getRunningKernels(), sessionManager.getKernelSpecs()]);
            // We should throw an exception if any of that fails.
        } catch (err) {
            if (JupyterSelfCertsError.isSelfCertsError(err)) {
                sendTelemetryEvent(Telemetry.ConnectRemoteSelfCertFailedJupyter);
                const handled = await handleSelfCertsError(this.applicationShell, this.configService, err.message);
                if (!handled) {
                    throw err;
                }
            } else if (JupyterSelfCertsExpiredError.isSelfCertsExpiredError(err)) {
                sendTelemetryEvent(Telemetry.ConnectRemoteSelfCertFailedJupyter);
                const handled = await handleExpiredCertsError(this.applicationShell, this.configService, err.message);
                if (!handled) {
                    throw err;
                }
            } else if (serverUri && !doNotDisplayUnActionableMessages) {
                const serverId = await computeServerId(generateUriFromRemoteProvider(provider.id, provider.handle));
                await this.errorHandler.handleError(
                    new RemoteJupyterServerConnectionError(serverUri.baseUrl, serverId, err)
                );
                // Can't set the URI in this case.
                throw err;
            } else {
                throw err;
            }
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
