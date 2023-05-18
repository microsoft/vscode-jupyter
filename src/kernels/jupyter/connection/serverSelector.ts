// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-use-before-define */

import { inject, injectable } from 'inversify';
import { IApplicationShell, IWorkspaceService } from '../../../platform/common/application/types';
import { traceWarning } from '../../../platform/logging';
import { DataScience } from '../../../platform/common/utils/localize';
import { sendTelemetryEvent } from '../../../telemetry';
import { Telemetry } from '../../../telemetry';
import { IJupyterServerUriStorage } from '../types';
import { IDataScienceErrorHandler } from '../../errors/types';
import { IConfigurationService, IDisposableRegistry } from '../../../platform/common/types';
import { handleExpiredCertsError, handleSelfCertsError, computeServerId } from '../jupyterUtils';
import { JupyterConnection } from './jupyterConnection';
import { JupyterSelfCertsError } from '../../../platform/errors/jupyterSelfCertsError';
import { RemoteJupyterServerConnectionError } from '../../../platform/errors/remoteJupyterServerConnectionError';
import { JupyterSelfCertsExpiredError } from '../../../platform/errors/jupyterSelfCertsExpiredError';
import { JupyterInvalidPasswordError } from '../../errors/jupyterInvalidPassword';

export type SelectJupyterUriCommandSource =
    | 'nonUser'
    | 'toolbar'
    | 'commandPalette'
    | 'nativeNotebookStatusBar'
    | 'nativeNotebookToolbar'
    | 'errorHandler'
    | 'prompt';

export async function validateSelectJupyterURI(
    jupyterConnection: JupyterConnection,
    applicationShell: IApplicationShell,
    configService: IConfigurationService,
    isWebExtension: boolean,
    inputText: string
): Promise<string | undefined> {
    inputText = inputText.trim();
    try {
        new URL(inputText);
    } catch {
        return DataScience.jupyterSelectURIInvalidURI;
    }

    // Double check http
    if (!inputText.toLowerCase().startsWith('http')) {
        return DataScience.validationErrorMessageForRemoteUrlProtocolNeedsToBeHttpOrHttps;
    }
    // Double check this server can be connected to. Might need a password, might need a allowUnauthorized
    try {
        await jupyterConnection.validateJupyterServer(inputText);
    } catch (err) {
        traceWarning('Uri verification error', err);
        if (JupyterSelfCertsError.isSelfCertsError(err)) {
            sendTelemetryEvent(Telemetry.ConnectRemoteSelfCertFailedJupyter);
            const handled = await handleSelfCertsError(applicationShell, configService, err.message);
            if (!handled) {
                return DataScience.jupyterSelfCertFailErrorMessageOnly;
            }
        } else if (JupyterSelfCertsExpiredError.isSelfCertsExpiredError(err)) {
            sendTelemetryEvent(Telemetry.ConnectRemoteSelfCertFailedJupyter);
            const handled = await handleExpiredCertsError(applicationShell, configService, err.message);
            if (!handled) {
                return DataScience.jupyterSelfCertExpiredErrorMessageOnly;
            }
        } else if (err && err instanceof JupyterInvalidPasswordError) {
            return DataScience.passwordFailure;
        } else {
            // Return the general connection error to show in the validation box
            // Replace any Urls in the error message with markdown link.
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const errorMessage = (err.message || err.toString()).replace(urlRegex, (url: string) => `[${url}](${url})`);
            return (
                isWebExtension || true
                    ? DataScience.remoteJupyterConnectionFailedWithoutServerWithErrorWeb
                    : DataScience.remoteJupyterConnectionFailedWithoutServerWithError
            )(errorMessage);
        }
    }
}

/**
 * Provides the UI for picking a remote server. Multiplexes to one of two implementations based on the 'showOnlyOneTypeOfKernel' experiment.
 */
@injectable()
export class JupyterServerSelector {
    constructor(
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage,
        @inject(IDataScienceErrorHandler)
        private readonly errorHandler: IDataScienceErrorHandler,
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IConfigurationService) private readonly configService: IConfigurationService,
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection,
        @inject(IWorkspaceService) readonly workspaceService: IWorkspaceService,
        @inject(IDisposableRegistry) readonly disposableRegistry: IDisposableRegistry
    ) {}

    public async addJupyterServer(userURI: string): Promise<void> {
        // Double check this server can be connected to. Might need a password, might need a allowUnauthorized
        try {
            await this.jupyterConnection.validateJupyterServer(userURI);
        } catch (err) {
            if (JupyterSelfCertsError.isSelfCertsError(err)) {
                sendTelemetryEvent(Telemetry.ConnectRemoteSelfCertFailedJupyter);
                const handled = await handleSelfCertsError(this.applicationShell, this.configService, err.message);
                if (!handled) {
                    return;
                }
            } else if (JupyterSelfCertsExpiredError.isSelfCertsExpiredError(err)) {
                sendTelemetryEvent(Telemetry.ConnectRemoteSelfCertFailedJupyter);
                const handled = await handleExpiredCertsError(this.applicationShell, this.configService, err.message);
                if (!handled) {
                    return;
                }
            } else {
                const serverId = await computeServerId(userURI);
                await this.errorHandler.handleError(new RemoteJupyterServerConnectionError(userURI, serverId, err));
                // Can't set the URI in this case.
                return;
            }
        }

        const connection = await this.jupyterConnection.createConnectionInfo({ uri: userURI });
        await this.serverUriStorage.addMRU(userURI, connection.displayName);

        // Indicate setting a jupyter URI to a remote setting. Check if an azure remote or not
        sendTelemetryEvent(Telemetry.SetJupyterURIToUserSpecified, undefined, {
            azure: userURI.toLowerCase().includes('azure')
        });
    }
}
