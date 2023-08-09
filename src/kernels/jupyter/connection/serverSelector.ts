// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-use-before-define */

import { inject, injectable } from 'inversify';
import { IApplicationShell, IWorkspaceService } from '../../../platform/common/application/types';
import { traceError, traceWarning } from '../../../platform/logging';
import { DataScience } from '../../../platform/common/utils/localize';
import { sendTelemetryEvent } from '../../../telemetry';
import { Telemetry } from '../../../telemetry';
import { IJupyterServerUriStorage, JupyterServerProviderHandle } from '../types';
import { IConfigurationService, IDisposableRegistry } from '../../../platform/common/types';
import { handleExpiredCertsError, handleSelfCertsError } from '../jupyterUtils';
import { JupyterConnection } from './jupyterConnection';
import { JupyterSelfCertsError } from '../../../platform/errors/jupyterSelfCertsError';
import { JupyterSelfCertsExpiredError } from '../../../platform/errors/jupyterSelfCertsExpiredError';
import { JupyterInvalidPasswordError } from '../../errors/jupyterInvalidPassword';
import { IJupyterServerUri } from '../../../api';

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
    provider: JupyterServerProviderHandle,
    serverUri: IJupyterServerUri
): Promise<string | undefined> {
    // Double check this server can be connected to. Might need a password, might need a allowUnauthorized
    try {
        await jupyterConnection.validateRemoteUri(provider, serverUri);
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
                isWebExtension
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
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection,
        @inject(IWorkspaceService) readonly workspaceService: IWorkspaceService,
        @inject(IDisposableRegistry) readonly disposableRegistry: IDisposableRegistry
    ) {}

    public async addJupyterServer(provider: JupyterServerProviderHandle): Promise<void> {
        // Double check this server can be connected to. Might need a password, might need a allowUnauthorized
        try {
            await this.jupyterConnection.validateRemoteUri(provider);
        } catch (err) {
            traceError(`Error in validating the Remote Uri ${provider.id}.${provider.handle}`, err);
            return;
        }

        await this.serverUriStorage.add(provider);
    }
}
