// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, optional } from 'inversify';
import { noop } from '../../../platform/common/utils/misc';
import { RemoteJupyterServerUriProviderError } from '../../errors/remoteJupyterServerUriProviderError';
import { BaseError } from '../../../platform/errors/types';
import { handleExpiredCertsError, handleSelfCertsError } from '../jupyterUtils';
import {
    IJupyterRequestAgentCreator,
    IJupyterRequestCreator,
    IJupyterServerUriStorage,
    IJupyterUriProviderRegistration,
    JupyterServerProviderHandle
} from '../types';
import { IJupyterServerUri } from '../../../api';
import { IDataScienceErrorHandler } from '../../errors/types';
import { IApplicationShell } from '../../../platform/common/application/types';
import { IConfigurationService, IDisposable } from '../../../platform/common/types';
import { CancellationToken, Uri } from 'vscode';
import { IJupyterConnection } from '../../types';
import { JVSC_EXTENSION_ID, Telemetry } from '../../../platform/common/constants';
import { getJupyterConnectionDisplayName } from '../helpers';
import { ServerConnection } from '@jupyterlab/services';
import { JupyterLabHelper } from '../session/jupyterLabHelper';
import { JupyterSelfCertsError } from '../../../platform/errors/jupyterSelfCertsError';
import { sendTelemetryEvent } from '../../../telemetry';
import { JupyterSelfCertsExpiredError } from '../../../platform/errors/jupyterSelfCertsExpiredError';
import { RemoteJupyterServerConnectionError } from '../../../platform/errors/remoteJupyterServerConnectionError';
import { raceCancellation } from '../../../platform/common/cancellation';
import { traceError } from '../../../platform/logging';

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
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(IDataScienceErrorHandler)
        private readonly errorHandler: IDataScienceErrorHandler,
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(IJupyterRequestCreator) private readonly requestCreator: IJupyterRequestCreator,
        @inject(IJupyterRequestAgentCreator)
        @optional()
        private readonly requestAgentCreator: IJupyterRequestAgentCreator | undefined
    ) {}

    public async createRemoteConnectionInfo(serverHandle: JupyterServerProviderHandle, token?: CancellationToken) {
        const server = await this.serverUriStorage.get(serverHandle);
        if (!server) {
            throw new Error('Server Not found');
        }
        const serverUri = await this.getJupyterServerUri(serverHandle);
        const partialConnection = createRemoteConnectionInfo(serverHandle, serverUri);
        const connection = { ...partialConnection, serverSettings: this.toServerConnectionSettings(partialConnection) };
        const labHelper = new JupyterLabHelper(connection);
        try {
            await raceCancellation(token, Promise.all([labHelper.getRunningKernels(), labHelper.getKernelSpecs()]));
        } catch (ex) {
            if (token?.isCancellationRequested) {
                traceError(
                    'Failed to fetch running kernels from remote server, connection may be outdated or remote server may be unreachable',
                    ex
                );
            }
            throw ex;
        } finally {
            labHelper.dispose().catch(noop);
        }
        return connection;
    }

    public async createLocalConnectionInfo({
        baseUrl,
        token,
        disposable,
        rootDirectory
    }: {
        baseUrl: string;
        token: string;
        rootDirectory: Uri;
        disposable: IDisposable;
    }) {
        const partialConnection: Omit<IJupyterConnection, 'serverSettings'> = {
            localLaunch: true,
            serverHandle: {
                extensionId: JVSC_EXTENSION_ID,
                id: '_builtin.jupyterServerLauncher',
                handle: 'local'
            },
            baseUrl,
            token,
            hostName: new URL(baseUrl).hostname,
            rootDirectory,
            displayName: getJupyterConnectionDisplayName(token, baseUrl),
            dispose: () => disposable.dispose()
        };
        return {
            ...partialConnection,
            serverSettings: this.toServerConnectionSettings(partialConnection)
        };
    }

    private toServerConnectionSettings(
        connection: Omit<IJupyterConnection, 'serverSettings'>
    ): ServerConnection.ISettings {
        let serverSettings: Partial<ServerConnection.ISettings> = {
            baseUrl: connection.baseUrl,
            appUrl: '',
            // A web socket is required to allow token authentication
            wsUrl: connection.baseUrl.replace('http', 'ws')
        };

        // Agent is allowed to be set on this object, but ts doesn't like it on RequestInit, so any
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let requestInit: any = this.requestCreator.getRequestInit();

        // If no token is specified prompt for a password
        const isTokenEmpty = connection.token === '' || connection.token === 'null';
        if (!isTokenEmpty || connection.getAuthHeader) {
            serverSettings = { ...serverSettings, token: connection.token, appendToken: true };
        }

        const allowUnauthorized = this.configService.getSettings(undefined).allowUnauthorizedRemoteConnection;
        // If this is an https connection and we want to allow unauthorized connections set that option on our agent
        // we don't need to save the agent as the previous behaviour is just to create a temporary default agent when not specified
        if (connection.baseUrl.startsWith('https') && allowUnauthorized && this.requestAgentCreator) {
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
                allowUnauthorized,
                connection.getAuthHeader,
                connection.getWebsocketProtocols?.bind(connection)
            ),
            fetch: this.requestCreator.getFetchMethod(),
            Request: this.requestCreator.getRequestCtor(allowUnauthorized, connection.getAuthHeader),
            Headers: this.requestCreator.getHeadersCtor()
        };

        return this.jupyterlab.ServerConnection.makeSettings(serverSettings);
    }

    public async validateJupyterServer(
        serverHandle: JupyterServerProviderHandle,
        serverUri?: IJupyterServerUri,
        doNotDisplayUnActionableMessages?: boolean
    ): Promise<void> {
        let sessionManager: JupyterLabHelper | undefined = undefined;
        serverUri = serverUri || (await this.getJupyterServerUri(serverHandle));
        const partialConnection = createRemoteConnectionInfo(serverHandle, serverUri);
        const connection = { ...partialConnection, serverSettings: this.toServerConnectionSettings(partialConnection) };
        try {
            // Attempt to list the running kernels. It will return empty if there are none, but will
            // throw if can't connect.
            sessionManager = new JupyterLabHelper(connection);
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
                    new RemoteJupyterServerConnectionError(serverUri.baseUrl, serverHandle, err)
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

function createRemoteConnectionInfo(
    serverHandle: JupyterServerProviderHandle,
    serverUri: IJupyterServerUri
): Omit<IJupyterConnection, 'serverSettings'> {
    const baseUrl = serverUri.baseUrl;
    const token = serverUri.token;
    const hostName = new URL(serverUri.baseUrl).hostname;
    const webSocketProtocols = (serverUri?.webSocketProtocols || []).length ? serverUri?.webSocketProtocols || [] : [];
    const authHeader =
        serverUri.authorizationHeader && Object.keys(serverUri?.authorizationHeader ?? {}).length > 0
            ? serverUri.authorizationHeader
            : undefined;
    return {
        baseUrl,
        serverHandle,
        token,
        hostName,
        localLaunch: false,
        displayName:
            serverUri && serverUri.displayName
                ? serverUri.displayName
                : getJupyterConnectionDisplayName(token, baseUrl),
        dispose: noop,
        rootDirectory: Uri.file(''),
        // Temporarily support workingDirectory as a fallback for old extensions using that (to be removed in the next release).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mappedRemoteNotebookDir: serverUri?.mappedRemoteNotebookDir || (serverUri as any)?.workingDirectory,
        // For remote jupyter servers that are managed by us, we can provide the auth header.
        // Its crucial this is set to undefined, else password retrieval will not be attempted.
        getAuthHeader: authHeader ? () => authHeader : undefined,
        getWebsocketProtocols: webSocketProtocols ? () => webSocketProtocols : () => []
    };
}
