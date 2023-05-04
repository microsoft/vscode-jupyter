// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable, optional } from 'inversify';
import {
    IJupyterConnection,
    IKernelConnectionSession,
    IKernelConnectionSessionCreator,
    isLocalConnection,
    isRemoteConnection,
    KernelConnectionSessionCreationOptions,
    RemoteKernelConnectionMetadata
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
import { IAsyncDisposableRegistry, IDisposable } from '../../../platform/common/types';
import { KernelProgressReporter } from '../../../platform/progress/kernelProgressReporter';
import { DataScience } from '../../../platform/common/utils/localize';
import { Disposable } from 'vscode';
import { noop } from '../../../platform/common/utils/misc';

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
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection,
        @inject(IAsyncDisposableRegistry) private readonly asyncDisposables: IAsyncDisposableRegistry
    ) {}

    public async create(options: KernelConnectionSessionCreationOptions): Promise<IKernelConnectionSession> {
        const kernelConnection = options.kernelConnection;
        const isLocal = isLocalConnection(kernelConnection);

        if (this.rawKernelSessionCreator?.isSupported && isLocal) {
            return this.createRawKernelSession(this.rawKernelSessionCreator, options);
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

        const promise = isRemoteConnection(options.kernelConnection)
            ? this.createRemoteKernelSession({ ...options, kernelConnection: options.kernelConnection })
            : this.createLocalJupyterKernelSession(options);

        return promise.finally(() => disposeAllDisposables(disposables));
    }
    private createRawKernelSession(
        factory: IRawKernelConnectionSessionCreator,
        options: KernelConnectionSessionCreationOptions
    ): Promise<IKernelConnectionSession> {
        return factory.create(options.resource, options.kernelConnection, options.ui, options.token);
    }
    private async createRemoteKernelSession(
        options: Omit<KernelConnectionSessionCreationOptions, 'kernelConnection'> & {
            kernelConnection: RemoteKernelConnectionMetadata;
        }
    ): Promise<IKernelConnectionSession> {
        let connection: undefined | IJupyterConnection;

        // Check to see if we support ipykernel or not
        const disposablesWhenThereAreFailures: IDisposable[] = [];
        try {
            connection = await this.jupyterConnection.createConnectionInfo({
                serverId: options.kernelConnection.serverId
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
                throw new RemoteJupyterServerConnectionError(connection.baseUrl, options.kernelConnection.serverId, ex);
            }
        }
    }
    private async createLocalJupyterKernelSession(options: KernelConnectionSessionCreationOptions) {
        await this.jupyterNotebookProvider.connect({
            resource: options.resource,
            token: options.token,
            ui: options.ui
        });
        Cancellation.throwIfCanceled(options.token);
        return this.jupyterNotebookProvider.createNotebook(options);
    }
}
