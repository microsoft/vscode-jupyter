// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, optional } from 'inversify';
import {
    IJupyterConnection,
    IKernelSession,
    IKernelSessionFactory,
    isLocalConnection,
    isRemoteConnection,
    KernelSessionCreationOptions
} from '../types';
import { Cancellation } from '../../platform/common/cancellation';
import { IRawKernelSessionFactory } from '../raw/types';
import { IJupyterServerProvider, IJupyterSessionManagerFactory } from '../jupyter/types';
import { JupyterKernelConnectionSessionCreator } from '../jupyter/session/jupyterKernelSessionFactory';
import { JupyterConnection } from '../jupyter/connection/jupyterConnection';
import { Telemetry, sendTelemetryEvent } from '../../telemetry';
import { JupyterSelfCertsError } from '../../platform/errors/jupyterSelfCertsError';
import { JupyterSelfCertsExpiredError } from '../../platform/errors/jupyterSelfCertsExpiredError';
import { RemoteJupyterServerConnectionError } from '../../platform/errors/remoteJupyterServerConnectionError';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { IAsyncDisposableRegistry, IDisposable } from '../../platform/common/types';
import { KernelProgressReporter } from '../../platform/progress/kernelProgressReporter';
import { DataScience } from '../../platform/common/utils/localize';
import { Disposable } from 'vscode';
import { noop } from '../../platform/common/utils/misc';
import { LocalJupyterServerConnectionError } from '../../platform/errors/localJupyterServerConnectionError';
import { BaseError } from '../../platform/errors/types';

/* eslint-disable @typescript-eslint/no-explicit-any */
const LocalHosts = ['localhost', '127.0.0.1', '::1'];

/**
 * Generic class for connecting to a server. Probably could be renamed as it doesn't provide notebooks, but rather connections.
 */
@injectable()
export class KernelSessionFactory implements IKernelSessionFactory {
    constructor(
        @inject(IRawKernelSessionFactory)
        @optional()
        private readonly rawKernelSessionCreator: IRawKernelSessionFactory | undefined,
        @inject(IJupyterServerProvider)
        private readonly jupyterNotebookProvider: IJupyterServerProvider,
        @inject(IJupyterSessionManagerFactory) private readonly sessionManagerFactory: IJupyterSessionManagerFactory,
        @inject(JupyterKernelConnectionSessionCreator)
        private readonly jupyterSessionCreator: JupyterKernelConnectionSessionCreator,
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection,
        @inject(IAsyncDisposableRegistry) private readonly asyncDisposables: IAsyncDisposableRegistry
    ) {}

    public async create(options: KernelSessionCreationOptions): Promise<IKernelSession> {
        const kernelConnection = options.kernelConnection;
        const isLocal = isLocalConnection(kernelConnection);

        if (this.rawKernelSessionCreator?.isSupported && isLocal) {
            return this.rawKernelSessionCreator.create(options);
        }

        const disposables: IDisposable[] = [];
        let progressReporter: IDisposable | undefined;
        const createProgressReporter = () => {
            if (options.ui.disableUI || progressReporter) {
                return;
            }
            // Status depends upon if we're about to connect to existing server or not.
            progressReporter = KernelProgressReporter.createProgressReporter(
                options.resource,
                isRemoteConnection(options.kernelConnection)
                    ? DataScience.connectingToJupyter
                    : DataScience.startingJupyter
            );
            disposables.push(progressReporter);
        };
        if (options.ui.disableUI) {
            options.ui.onDidChangeDisableUI(createProgressReporter, this, disposables);
        }
        createProgressReporter();

        return this.createJupyterKernelSession(options).finally(() => disposeAllDisposables(disposables));
    }
    private async createJupyterKernelSession(options: KernelSessionCreationOptions): Promise<IKernelSession> {
        let connection: undefined | IJupyterConnection;

        // Check to see if we support ipykernel or not
        const disposablesWhenThereAreFailures: IDisposable[] = [];
        try {
            connection = isRemoteConnection(options.kernelConnection)
                ? await this.jupyterConnection.createConnectionInfo({
                      serverId: options.kernelConnection.serverId
                  })
                : await this.jupyterNotebookProvider.getOrCreateServer({
                      resource: options.resource,
                      token: options.token,
                      ui: options.ui
                  });

            if (!connection.localLaunch && LocalHosts.includes(connection.hostName.toLowerCase())) {
                sendTelemetryEvent(Telemetry.ConnectRemoteJupyterViaLocalHost);
            }

            Cancellation.throwIfCanceled(options.token);

            const sessionManager = await this.sessionManagerFactory.create(connection);
            this.asyncDisposables.push(sessionManager);
            disposablesWhenThereAreFailures.push(new Disposable(() => sessionManager.dispose().catch(noop)));

            Cancellation.throwIfCanceled(options.token);
            // Disposing session manager will dispose all sessions that were started by that session manager.
            // Hence Session managers should be disposed only if the corresponding session is shutdown.
            const session = await this.jupyterSessionCreator.create({
                creator: options.creator,
                kernelConnection: options.kernelConnection,
                resource: options.resource,
                sessionManager,
                token: options.token,
                ui: options.ui
            });
            session.onDidShutdown(() => sessionManager.dispose());
            return session;
        } catch (ex) {
            disposeAllDisposables(disposablesWhenThereAreFailures);

            if (isRemoteConnection(options.kernelConnection)) {
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
            } else {
                sendTelemetryEvent(Telemetry.ConnectFailedJupyter, undefined, undefined, ex);
                if (ex instanceof BaseError) {
                    throw ex;
                } else {
                    throw new LocalJupyterServerConnectionError(ex);
                }
            }
        }
    }
}
