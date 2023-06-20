// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, optional } from 'inversify';
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
    IJupyterPasswordConnect,
    IJupyterRequestAgentCreator,
    IJupyterRequestCreator,
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
import {
    Experiments,
    IConfigurationService,
    IExperimentService,
    IPersistentState,
    IPersistentStateFactory
} from '../../../platform/common/types';
import { RemoteJupyterServerConnectionError } from '../../../platform/errors/remoteJupyterServerConnectionError';
import { Common, DataScience } from '../../../platform/common/utils/localize';
import { IJupyterConnection } from '../../types';
import { JupyterInvalidPasswordError } from '../../errors/jupyterInvalidPassword';
import type { ServerConnection } from '@jupyterlab/services';

// Key for our insecure connection global state
const GlobalStateUserAllowsInsecureConnections = 'DataScienceAllowInsecureConnections';

/**
 * Creates IJupyterConnection objects for URIs and 3rd party handles/ids.
 */
@injectable()
export class JupyterConnection {
    private static secureServers = new Map<string, Promise<boolean>>();
    private readonly userAllowsInsecureConnections: IPersistentState<boolean>;
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
        @inject(IJupyterSessionManagerFactory)
        private readonly jupyterSessionManagerFactory: IJupyterSessionManagerFactory,
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IDataScienceErrorHandler)
        private readonly errorHandler: IDataScienceErrorHandler,
        @inject(IExperimentService)
        private readonly experiments: IExperimentService,
        @inject(IPersistentStateFactory)
        private readonly stateFactory: IPersistentStateFactory,
        @inject(IJupyterPasswordConnect)
        private jupyterPasswordConnect: IJupyterPasswordConnect,
        @inject(IJupyterRequestAgentCreator)
        @optional()
        private readonly requestAgentCreator: IJupyterRequestAgentCreator | undefined,
        @inject(IJupyterRequestCreator)
        private readonly requestCreator: IJupyterRequestCreator
    ) {
        this.userAllowsInsecureConnections = this.stateFactory.createGlobalPersistentState<boolean>(
            GlobalStateUserAllowsInsecureConnections,
            false
        );
    }

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
            sessionManager = await this.jupyterSessionManagerFactory.create(connection);
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

    public async getServerConnectSettings(connInfo: IJupyterConnection): Promise<ServerConnection.ISettings> {
        if (this.experiments.inExperiment(Experiments.PasswordManager)) {
            return this.getServerConnectSettingsNew(connInfo);
        } else {
            return this.getServerConnectSettingsOld(connInfo);
        }
    }
    private async getServerConnectSettingsNew(connInfo: IJupyterConnection): Promise<ServerConnection.ISettings> {
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
    private async getServerConnectSettingsOld(
        connInfo: IJupyterConnection
        // failOnPassword: boolean
    ): Promise<ServerConnection.ISettings> {
        let serverSettings: Partial<ServerConnection.ISettings> = {
            baseUrl: connInfo.baseUrl,
            appUrl: '',
            // A web socket is required to allow token authentication
            wsUrl: connInfo.baseUrl.replace('http', 'ws')
        };

        // Before we connect, see if we are trying to make an insecure connection, if we are, warn the user
        await this.secureConnectionCheck(connInfo);

        // Agent is allowed to be set on this object, but ts doesn't like it on RequestInit, so any
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let requestInit: any = this.requestCreator.getRequestInit();
        let cookieString;

        // If no token is specified prompt for a password
        const isTokenEmpty = connInfo.token === '' || connInfo.token === 'null';
        if (isTokenEmpty && !connInfo.getAuthHeader) {
            // if (failOnPassword) {
            //     throw new Error('Password request not allowed.');
            // }
            serverSettings = { ...serverSettings, token: '' };
            const pwSettings = await this.jupyterPasswordConnect.getPasswordConnectionInfo({
                url: connInfo.baseUrl,
                isTokenEmpty
            });
            if (pwSettings && pwSettings.requestHeaders) {
                requestInit = { ...requestInit, headers: pwSettings.requestHeaders };
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                cookieString = (pwSettings.requestHeaders as any).Cookie || '';

                // Password may have overwritten the base url and token as well
                if (pwSettings.remappedBaseUrl) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (serverSettings as any).baseUrl = pwSettings.remappedBaseUrl;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (serverSettings as any).wsUrl = pwSettings.remappedBaseUrl.replace('http', 'ws');
                }
                if (pwSettings.remappedToken) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (serverSettings as any).token = pwSettings.remappedToken;
                }
            } else if (pwSettings) {
                serverSettings = { ...serverSettings, token: '' };
            } else {
                throw new JupyterInvalidPasswordError();
            }
        } else {
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
                cookieString,
                allowUnauthorized,
                connInfo.getAuthHeader,
                connInfo.getWebsocketProtocols?.bind(connInfo)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ) as any,
            fetch: this.requestCreator.getFetchMethod(),
            Request: this.requestCreator.getRequestCtor(cookieString, allowUnauthorized, connInfo.getAuthHeader),
            Headers: this.requestCreator.getHeadersCtor()
        };

        return this.jupyterlab.ServerConnection.makeSettings(serverSettings);
    }

    // If connecting on HTTP without a token prompt the user that this connection may not be secure
    private async insecureServerWarningPrompt(): Promise<boolean> {
        const insecureMessage = DataScience.insecureSessionMessage;
        const insecureLabels = [Common.bannerLabelYes, Common.bannerLabelNo, Common.doNotShowAgain];
        const response = await this.applicationShell.showWarningMessage(insecureMessage, ...insecureLabels);

        switch (response) {
            case Common.bannerLabelYes:
                // On yes just proceed as normal
                return true;

            case Common.doNotShowAgain:
                // For don't ask again turn on the global true
                await this.userAllowsInsecureConnections.updateValue(true);
                return true;

            case Common.bannerLabelNo:
            default:
                // No or for no choice return back false to block
                return false;
        }
    }

    // Check if our server connection is considered secure. If it is not, ask the user if they want to connect
    // If not, throw to bail out on the process
    private async secureConnectionCheck(connInfo: IJupyterConnection): Promise<void> {
        // If they have turned on global server trust then everything is secure
        if (this.userAllowsInsecureConnections.value) {
            return;
        }

        // If they are local launch, https, or have a token, then they are secure
        const isEmptyToken = connInfo.token === '' || connInfo.token === 'null';
        if (connInfo.localLaunch || connInfo.baseUrl.startsWith('https') || !isEmptyToken) {
            return;
        }

        // At this point prompt the user, cache the promise so we don't ask multiple times for the same server
        let serverSecurePromise = JupyterConnection.secureServers.get(connInfo.baseUrl);

        if (serverSecurePromise === undefined) {
            if (!connInfo.providerId.startsWith('_builtin') || connInfo.localLaunch) {
                // If a Jupyter URI provider is providing this URI, then we trust it.
                serverSecurePromise = Promise.resolve(true);
                JupyterConnection.secureServers.set(connInfo.baseUrl, serverSecurePromise);
            } else {
                serverSecurePromise = this.insecureServerWarningPrompt();
                JupyterConnection.secureServers.set(connInfo.baseUrl, serverSecurePromise);
            }
        }

        // If our server is not secure, throw here to bail out on the process
        if (!(await serverSecurePromise)) {
            throw new Error(DataScience.insecureSessionDenied);
        }
    }
}
