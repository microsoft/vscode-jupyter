// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, optional } from 'inversify';
import { noop } from '../../../platform/common/utils/misc';
import { RemoteJupyterServerUriProviderError } from '../../errors/remoteJupyterServerUriProviderError';
import { BaseError } from '../../../platform/errors/types';
import { createRemoteConnectionInfo, handleExpiredCertsError, handleSelfCertsError } from '../jupyterUtils';
import {
    IJupyterRequestAgentCreator,
    IJupyterRequestCreator,
    IJupyterSessionManager,
    IOldJupyterSessionManagerFactory,
    IJupyterUriProviderRegistration,
    JupyterServerProviderHandle
} from '../types';
import { IJupyterServerUri } from '../../../api.unstable';
import { JupyterSelfCertsError } from '../../../platform/errors/jupyterSelfCertsError';
import { Telemetry, sendTelemetryEvent } from '../../../telemetry';
import { JupyterSelfCertsExpiredError } from '../../../platform/errors/jupyterSelfCertsExpiredError';
import { IDataScienceErrorHandler } from '../../errors/types';
import { IApplicationShell } from '../../../platform/common/application/types';
import { IConfigurationService } from '../../../platform/common/types';
import { RemoteJupyterServerConnectionError } from '../../../platform/errors/remoteJupyterServerConnectionError';
import { IJupyterConnection } from '../../types';
import type { ServerConnection } from '@jupyterlab/services';

/**
 * Creates IJupyterConnection objects for URIs and 3rd party handles/ids.
 */
@injectable()
export class JupyterConnection {
    private _jupyterlab?: typeof import('@jupyterlab/services');
    private get jupyterlab(): typeof import('@jupyterlab/services') {
        if (!this._jupyterlab) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            this._jupyterlab = require('@jupyterlab/services');
        }
        return this._jupyterlab!;
    }

    constructor(
        @inject(IJupyterUriProviderRegistration)
        private readonly jupyterPickerRegistration: IJupyterUriProviderRegistration,
        @inject(IOldJupyterSessionManagerFactory)
        private readonly jupyterSessionManagerFactory: IOldJupyterSessionManagerFactory,
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IDataScienceErrorHandler)
        private readonly errorHandler: IDataScienceErrorHandler,
        @inject(IJupyterRequestAgentCreator)
        @optional()
        private readonly requestAgentCreator: IJupyterRequestAgentCreator | undefined,
        @inject(IJupyterRequestCreator)
        private readonly requestCreator: IJupyterRequestCreator
    ) {}

    public async createConnectionInfo(serverId: JupyterServerProviderHandle) {
        const serverUri = await this.getJupyterServerUri(serverId);
        return createRemoteConnectionInfo(serverId, serverUri);
    }

    public async validateRemoteUri(
        provider: JupyterServerProviderHandle,
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
                await this.errorHandler.handleError(
                    new RemoteJupyterServerConnectionError(serverUri.baseUrl, provider, err)
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

    private async getJupyterServerUri(provider: JupyterServerProviderHandle) {
        try {
            return await this.jupyterPickerRegistration.getJupyterServerUri(provider);
        } catch (ex) {
            if (ex instanceof BaseError) {
                throw ex;
            }
            throw new RemoteJupyterServerUriProviderError(provider, ex);
        }
    }

    public async getServerConnectSettings(connInfo: IJupyterConnection): Promise<ServerConnection.ISettings> {
        let serverSettings: Partial<ServerConnection.ISettings> = {
            baseUrl: connInfo.baseUrl,
            appUrl: '',
            // A web socket is required to allow token authentication
            wsUrl: connInfo.baseUrl.replace('http', 'ws')
        };

        // Agent is allowed to be set on this object, but ts doesn't like it on RequestInit, so any
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let requestInit: any = this.requestCreator.getRequestInit();

        const isTokenEmpty = connInfo.token === '' || connInfo.token === 'null';
        if (!isTokenEmpty || connInfo.getAuthHeader) {
            serverSettings = { ...serverSettings, token: connInfo.token, appendToken: true };
        }

        const allowUnauthorized = this.configService.getSettings(undefined).allowUnauthorizedRemoteConnection;
        // If this is an https connection and we want to allow unauthorized connections set that option on our agent
        // we don't need to save the agent as the previous behaviour is just to create a temporary default agent when not specified
        if (connInfo.baseUrl.startsWith('https') && allowUnauthorized && this.requestAgentCreator) {
            const requestAgent = this.requestAgentCreator.createHttpRequestAgent();
            requestInit = { ...requestInit, agent: requestAgent };
        }

        // This replaces the WebSocket constructor in jupyter lab services with our own implementation
        // See _createSocket here:
        // https://github.com/jupyterlab/jupyterlab/blob/cfc8ebda95e882b4ed2eefd54863bb8cdb0ab763/packages/services/src/kernel/default.ts
        serverSettings = {
            ...serverSettings,
            init: requestInit,
            WebSocket: this.requestCreator.getWebsocketCtor(
                undefined,
                allowUnauthorized,
                connInfo.getAuthHeader,
                connInfo.getWebsocketProtocols?.bind(connInfo)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ) as any,
            fetch: this.requestCreator.getFetchMethod(),
            Request: this.requestCreator.getRequestCtor(undefined, allowUnauthorized, connInfo.getAuthHeader),
            Headers: this.requestCreator.getHeadersCtor()
        };

        return this.jupyterlab.ServerConnection.makeSettings(serverSettings);
    }
}
