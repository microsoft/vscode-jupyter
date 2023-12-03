// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, optional } from 'inversify';
import { noop } from '../../../platform/common/utils/misc';
import { RemoteJupyterServerUriProviderError } from '../../errors/remoteJupyterServerUriProviderError';
import { BaseError } from '../../../platform/errors/types';
import { createJupyterConnectionInfo, handleExpiredCertsError, handleSelfCertsError } from '../jupyterUtils';
import {
    IJupyterRequestAgentCreator,
    IJupyterRequestCreator,
    IJupyterServerProviderRegistry,
    JupyterServerProviderHandle
} from '../types';
import { IJupyterServerUri, JupyterServer } from '../../../api';
import { JupyterSelfCertsError } from '../../../platform/errors/jupyterSelfCertsError';
import { JupyterSelfCertsExpiredError } from '../../../platform/errors/jupyterSelfCertsExpiredError';
import { IDataScienceErrorHandler } from '../../errors/types';
import { IConfigurationService, ReadWrite } from '../../../platform/common/types';
import { RemoteJupyterServerConnectionError } from '../../../platform/errors/remoteJupyterServerConnectionError';
import { CancellationTokenSource, Uri } from 'vscode';
import { JupyterLabHelper } from '../session/jupyterLabHelper';

/**
 * Creates IJupyterConnection objects for URIs and 3rd party handles/ids.
 */
@injectable()
export class JupyterConnection {
    constructor(
        @inject(IJupyterServerProviderRegistry)
        private readonly jupyterPickerRegistration: IJupyterServerProviderRegistry,
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
        const server = await this.getJupyterServerUri(serverId);
        if (!server) {
            throw new Error(
                `Unable to get resolved server information for ${serverId.extensionId}:${serverId.id}:${serverId.handle}`
            );
        }
        const serverUri: IJupyterServerUri = {
            baseUrl: server.connectionInformation!.baseUrl.toString(true),
            displayName: server.label,
            token: server.connectionInformation!.token || '',
            authorizationHeader: server.connectionInformation!.headers || {},
            fetch: server.connectionInformation!.fetch,
            mappedRemoteNotebookDir: undefined,
            WebSocket: server.connectionInformation!.WebSocket,
            webSocketProtocols: server.connectionInformation?.webSocketProtocols
        };

        return createJupyterConnectionInfo(
            serverId,
            serverUri,
            this.requestCreator,
            this.requestAgentCreator,
            this.configService,
            Uri.file('')
        );
    }

    public async validateRemoteUri(
        provider: JupyterServerProviderHandle,
        serverUri?: IJupyterServerUri,
        doNotDisplayUnActionableMessages?: boolean
    ): Promise<void> {
        let sessionManager: JupyterLabHelper | undefined = undefined;
        if (!serverUri) {
            const server = await this.getJupyterServerUri(provider);
            if (server) {
                serverUri = {
                    baseUrl: server.connectionInformation!.baseUrl.toString(true),
                    displayName: server.label,
                    token: server.connectionInformation!.token || '',
                    authorizationHeader: server.connectionInformation!.headers || {},
                    fetch: server.connectionInformation!.fetch,
                    mappedRemoteNotebookDir: undefined,
                    WebSocket: server.connectionInformation!.WebSocket,
                    webSocketProtocols: server.connectionInformation?.webSocketProtocols
                };
            } else {
                throw new Error(
                    `Unable to get resolved server information for ${provider.extensionId}:${provider.id}:${provider.handle}`
                );
            }
        }
        const connection = createJupyterConnectionInfo(
            provider,
            serverUri,
            this.requestCreator,
            this.requestAgentCreator,
            this.configService,
            Uri.file('')
        );
        try {
            // Attempt to list the running kernels. It will return empty if there are none, but will
            // throw if can't connect.
            sessionManager = JupyterLabHelper.create(connection.settings);
            await Promise.all([sessionManager.getRunningKernels(), sessionManager.getKernelSpecs()]);
            // We should throw an exception if any of that fails.
        } catch (err) {
            if (JupyterSelfCertsError.isSelfCertsError(err)) {
                const handled = await handleSelfCertsError(this.configService, err.message);
                if (!handled) {
                    throw err;
                }
            } else if (JupyterSelfCertsExpiredError.isSelfCertsExpiredError(err)) {
                const handled = await handleExpiredCertsError(this.configService, err.message);
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
        const token = new CancellationTokenSource();
        try {
            const collection =
                this.jupyterPickerRegistration.jupyterCollections.find(
                    (c) => c.extensionId === provider.extensionId && c.id === provider.id
                ) ||
                (await this.jupyterPickerRegistration.activateThirdPartyExtensionAndFindCollection(
                    provider.extensionId,
                    provider.id
                ));
            if (!collection) {
                return;
            }
            const servers = await Promise.resolve(collection.serverProvider.provideJupyterServers(token.token));
            const server = servers?.find((c) => c.id === provider.handle);
            if (!server) {
                return;
            }
            if (server.connectionInformation) {
                return server;
            }
            const resolvedServer = await Promise.resolve(
                collection.serverProvider.resolveJupyterServer(server, token.token)
            );
            if (!resolvedServer?.connectionInformation) {
                return;
            }
            const serverInfo: ReadWrite<JupyterServer> = Object.assign({}, server);
            serverInfo.connectionInformation = resolvedServer.connectionInformation;
            return serverInfo;
        } catch (ex) {
            if (ex instanceof BaseError) {
                throw ex;
            }
            throw new RemoteJupyterServerUriProviderError(provider, ex);
        } finally {
            token.dispose();
        }
    }
}
