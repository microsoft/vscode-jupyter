// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, optional } from 'inversify';
import {
    GetServerOptions,
    IJupyterConnection,
    IKernelConnectionSession,
    IKernelConnectionSessionCreator,
    isLocalConnection,
    isRemoteConnection,
    KernelConnectionSessionCreationOptions
} from '../../types';
import { Cancellation } from '../../../platform/common/cancellation';
import { IRawKernelConnectionSessionCreator } from '../../raw/types';
import { IJupyterNotebookProvider, IJupyterSessionManagerFactory } from '../types';
import { JupyterKernelConnectionSessionCreator } from './jupyterKernelConnectionSessionCreator';
import { JupyterConnection } from '../connection/jupyterConnection';
import { Telemetry, sendTelemetryEvent } from '../../../telemetry';
import { JupyterSelfCertsError } from '../../../platform/errors/jupyterSelfCertsError';
import { JupyterSelfCertsExpiredError } from '../../../platform/errors/jupyterSelfCertsExpiredError';
import { RemoteJupyterServerConnectionError } from '../../../platform/errors/remoteJupyterServerConnectionError';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IDisposable } from '../../../platform/common/types';
import { KernelProgressReporter } from '../../../platform/progress/kernelProgressReporter';
import { DataScience } from '../../../platform/common/utils/localize';

/* eslint-disable @typescript-eslint/no-explicit-any */
const LocalHosts = ['localhost', '127.0.0.1', '::1'];

/**
 * Generic class for connecting to a server. Probably could be renamed as it doesn't provide notebooks, but rather connections.
 */
@injectable()
export class KernelConnectionSessionCreator implements IKernelConnectionSessionCreator {
    constructor(
        @inject(IRawKernelConnectionSessionCreator)
        @optional()
        private readonly rawKernelSessionCreator: IRawKernelConnectionSessionCreator | undefined,
        @inject(IJupyterNotebookProvider)
        private readonly jupyterNotebookProvider: IJupyterNotebookProvider,
        @inject(IJupyterSessionManagerFactory) private readonly sessionManagerFactory: IJupyterSessionManagerFactory,
        @inject(JupyterKernelConnectionSessionCreator)
        private readonly jupyterSessionCreator: JupyterKernelConnectionSessionCreator,
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection
    ) {}

    public async create(options: KernelConnectionSessionCreationOptions): Promise<IKernelConnectionSession> {
        const kernelConnection = options.kernelConnection;
        const isLocal = isLocalConnection(kernelConnection);

        if (this.rawKernelSessionCreator?.isSupported && isLocal) {
            return this.rawKernelSessionCreator.create(
                options.resource,
                options.kernelConnection,
                options.ui,
                options.token
            );
        }
        if (isRemoteConnection(options.kernelConnection)) {
            let connection: undefined | IJupyterConnection;

            const disposables: IDisposable[] = [];
            let progressReporter: IDisposable | undefined;
            const createProgressReporter = async () => {
                if (options.ui.disableUI || progressReporter) {
                    return;
                }
                // Status depends upon if we're about to connect to existing server or not.
                progressReporter = KernelProgressReporter.createProgressReporter(
                    options.resource,
                    DataScience.connectingToJupyter
                );
                disposables.push(progressReporter);
            };
            if (options.ui.disableUI) {
                options.ui.onDidChangeDisableUI(createProgressReporter, this, disposables);
            }
            // Check to see if we support ipykernel or not
            try {
                await createProgressReporter();
                connection = await this.jupyterConnection.createConnectionInfo({
                    serverId: options.kernelConnection.serverId
                });
                if (!connection.localLaunch && LocalHosts.includes(connection.hostName.toLowerCase())) {
                    sendTelemetryEvent(Telemetry.ConnectRemoteJupyterViaLocalHost);
                }

                Cancellation.throwIfCanceled(options.token);
                const sessionManager = await this.sessionManagerFactory.create(connection);
                Cancellation.throwIfCanceled(options.token);
                return await this.jupyterSessionCreator.create({
                    creator: options.creator,
                    kernelConnection: options.kernelConnection,
                    resource: options.resource,
                    sessionManager,
                    token: options.token,
                    ui: options.ui
                });
            } catch (ex) {
                disposeAllDisposables(disposables);
                sendTelemetryEvent(Telemetry.ConnectRemoteFailedJupyter, undefined, undefined, ex);

                // Check for the self signed certs error specifically
                if (!connection) {
                    throw ex;
                } else if (JupyterSelfCertsError.isSelfCertsError(ex)) {
                    sendTelemetryEvent(Telemetry.ConnectRemoteSelfCertFailedJupyter);
                    throw new JupyterSelfCertsError(connection.baseUrl);
                } else if (JupyterSelfCertsExpiredError.isSelfCertsExpiredError(ex)) {
                    sendTelemetryEvent(Telemetry.ConnectRemoteExpiredCertFailedJupyter);
                    throw new JupyterSelfCertsExpiredError(connection.baseUrl);
                } else {
                    throw new RemoteJupyterServerConnectionError(
                        connection.baseUrl,
                        options.kernelConnection.serverId,
                        ex
                    );
                }
            } finally {
                disposeAllDisposables(disposables);
            }
        } else {
            const serverOptions: GetServerOptions = {
                resource: options.resource,
                token: options.token,
                ui: options.ui
            };

            await this.jupyterNotebookProvider.connect(serverOptions);
            Cancellation.throwIfCanceled(options.token);
            return this.jupyterNotebookProvider.createNotebook(options);
        }
    }
}
