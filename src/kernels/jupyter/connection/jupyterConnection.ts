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
    IJupyterUriProviderRegistration,
    JupyterServerProviderHandle
} from '../types';
import { IJupyterServerUri } from '../../../api';
import { JupyterSelfCertsError } from '../../../platform/errors/jupyterSelfCertsError';
import { JupyterSelfCertsExpiredError } from '../../../platform/errors/jupyterSelfCertsExpiredError';
import { IDataScienceErrorHandler } from '../../errors/types';
import { IApplicationShell } from '../../../platform/common/application/types';
import { IConfigurationService } from '../../../platform/common/types';
import { RemoteJupyterServerConnectionError } from '../../../platform/errors/remoteJupyterServerConnectionError';
import { Uri } from 'vscode';
import { JupyterLabHelper } from '../session/jupyterLabHelper';
import { traceError } from '../../../platform/logging';

/**
 * Creates IJupyterConnection objects for URIs and 3rd party handles/ids.
 */
@injectable()
export class JupyterConnection {
    constructor(
        @inject(IJupyterUriProviderRegistration)
        private readonly jupyterPickerRegistration: IJupyterUriProviderRegistration,
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

    public async createConnectionInfo(
        serverId: JupyterServerProviderHandle,
        updateConnection?: (conn: IJupyterServerUri) => Promise<IJupyterServerUri>
    ) {
        let serverUri = await this.getJupyterServerUri(serverId);
        if (updateConnection && serverId.extensionId.split('.')[0].toLowerCase() === 'SynapseVSCode'.toLowerCase()) {
            serverUri = await updateConnection(serverUri).catch((ex) => {
                traceError(`Failed to update connection`, ex);
                return serverUri;
            });
        }
        return createJupyterConnectionInfo(
            serverId,
            serverUri,
            this.requestCreator,
            this.requestAgentCreator,
            this.configService,
            false,
            Uri.file('')
        );
    }

    public async validateRemoteUri(
        provider: JupyterServerProviderHandle,
        serverUri?: IJupyterServerUri,
        doNotDisplayUnActionableMessages?: boolean
    ): Promise<void> {
        let sessionManager: JupyterLabHelper | undefined = undefined;
        serverUri = serverUri || (await this.getJupyterServerUri(provider));
        const connection = createJupyterConnectionInfo(
            provider,
            serverUri,
            this.requestCreator,
            this.requestAgentCreator,
            this.configService,
            false,
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
                const handled = await handleSelfCertsError(this.applicationShell, this.configService, err.message);
                if (!handled) {
                    throw err;
                }
            } else if (JupyterSelfCertsExpiredError.isSelfCertsExpiredError(err)) {
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
}
