// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { noop } from '../../../platform/common/utils/misc';
import { RemoteJupyterServerUriProviderError } from '../../errors/remoteJupyterServerUriProviderError';
import { BaseError } from '../../../platform/errors/types';
import { createRemoteConnectionInfo, handleExpiredCertsError, handleSelfCertsError } from '../jupyterUtils';
import {
    IJupyterServerUri,
    IJupyterServerUriStorage,
    IJupyterSessionManager,
    IJupyterSessionManagerFactory,
    IJupyterUriProviderRegistration,
    JupyterServerProviderHandle
} from '../types';
import { IDataScienceErrorHandler } from '../../errors/types';
import { IApplicationShell } from '../../../platform/common/application/types';
import { IConfigurationService } from '../../../platform/common/types';
import { Telemetry, sendTelemetryEvent } from '../../../telemetry';
import { JupyterSelfCertsExpiredError } from '../../../platform/errors/jupyterSelfCertsExpiredError';
import { JupyterInvalidPasswordError } from '../../errors/jupyterInvalidPassword';
import { RemoteJupyterServerConnectionError } from '../../../platform/errors/remoteJupyterServerConnectionError';
import { traceError } from '../../../platform/logging';
import { JupyterSelfCertsError } from '../../../platform/errors/jupyterSelfCertsError';

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
        @inject(IDataScienceErrorHandler)
        private readonly errorHandler: IDataScienceErrorHandler,
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IConfigurationService) private readonly configService: IConfigurationService
    ) {}

    public async createConnectionInfo(serverHandle: JupyterServerProviderHandle) {
        const server = await this.serverUriStorage.get(serverHandle);
        if (!server) {
            throw new Error('Server Not found');
        }
        const serverUri = await this.getJupyterServerUri(serverHandle);
        return createRemoteConnectionInfo(serverHandle, serverUri);
    }

    public async validateJupyterServer(
        serverHandle: JupyterServerProviderHandle,
        serverUri?: IJupyterServerUri,
        doNotDisplayUnActionableMessages?: boolean
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
            } else if (err && err instanceof JupyterInvalidPasswordError) {
                throw err;
            } else if (serverUri && !doNotDisplayUnActionableMessages) {
                await this.errorHandler.handleError(
                    new RemoteJupyterServerConnectionError(serverUri.baseUrl, serverHandle, err)
                );
                // Can't set the URI in this case.
                throw err;
            } else {
                traceError(
                    `Uri verification error ${serverHandle.extensionId}, id=${serverHandle.id}, handle=${serverHandle.handle}`,
                    err
                );
                throw err;
            }
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
