// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Disposable, Uri } from 'vscode';
import { Cancellation } from '../../../platform/common/cancellation';
import {
    IJupyterConnection,
    IJupyterKernelSession,
    IKernelSessionFactory,
    KernelSessionCreationOptions,
    isLocalConnection,
    isRemoteConnection
} from '../../types';
import { IJupyterKernelService, IJupyterRequestCreator, IJupyterServerProvider } from '../types';
import { traceError, traceInfo } from '../../../platform/logging';
import { IWorkspaceService } from '../../../platform/common/application/types';
import { inject, injectable, optional } from 'inversify';
import { noop } from '../../../platform/common/utils/misc';
import { RemoteJupyterServerConnectionError } from '../../../platform/errors/remoteJupyterServerConnectionError';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { JupyterSelfCertsError } from '../../../platform/errors/jupyterSelfCertsError';
import { JupyterSelfCertsExpiredError } from '../../../platform/errors/jupyterSelfCertsExpiredError';
import { LocalJupyterServerConnectionError } from '../../../platform/errors/localJupyterServerConnectionError';
import { BaseError } from '../../../platform/errors/types';
import { sendTelemetryEvent, Telemetry } from '../../../telemetry';
import { IAsyncDisposableRegistry, IConfigurationService, IDisposable } from '../../../platform/common/types';
import { JupyterConnection } from '../connection/jupyterConnection';
import { KernelProgressReporter } from '../../../platform/progress/kernelProgressReporter';
import { DataScience } from '../../../platform/common/utils/localize';
import { JupyterSession } from './jupyterSession';
import { JupyterLabHelper } from './jupyterLabHelper';

/* eslint-disable @typescript-eslint/no-explicit-any */
const LocalHosts = ['localhost', '127.0.0.1', '::1'];

@injectable()
export class JupyterKernelSessionFactory implements IKernelSessionFactory {
    constructor(
        @inject(IJupyterServerProvider)
        private readonly jupyterNotebookProvider: IJupyterServerProvider,
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection,
        @inject(IAsyncDisposableRegistry) private readonly asyncDisposables: IAsyncDisposableRegistry,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IConfigurationService) private configService: IConfigurationService,
        @inject(IJupyterKernelService) @optional() private readonly kernelService: IJupyterKernelService | undefined,
        @inject(IJupyterRequestCreator)
        private readonly requestCreator: IJupyterRequestCreator
    ) {}
    public async create(options: KernelSessionCreationOptions): Promise<IJupyterKernelSession> {
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

        let connection: undefined | IJupyterConnection;

        // Check to see if we support ipykernel or not
        const disposablesWhenThereAreFailures: IDisposable[] = [];
        try {
            connection = isRemoteConnection(options.kernelConnection)
                ? await this.jupyterConnection.createRemoveConnectionInfo(options.kernelConnection.serverHandle)
                : await this.jupyterNotebookProvider.getOrStartServer({
                      resource: options.resource,
                      token: options.token,
                      ui: options.ui
                  });

            if (!connection.localLaunch && LocalHosts.includes(connection.hostName.toLowerCase())) {
                sendTelemetryEvent(Telemetry.ConnectRemoteJupyterViaLocalHost);
            }

            Cancellation.throwIfCanceled(options.token);

            const labHelper = new JupyterLabHelper(connection);
            this.asyncDisposables.push(labHelper);
            disposablesWhenThereAreFailures.push(new Disposable(() => labHelper.dispose().catch(noop)));

            if (isRemoteConnection(options.kernelConnection)) {
                try {
                    await Promise.all([labHelper.getRunningKernels(), labHelper.getKernelSpecs()]);
                } catch (ex) {
                    traceError(
                        'Failed to fetch running kernels from remote server, connection may be outdated or remote server may be unreachable',
                        ex
                    );
                    throw new RemoteJupyterServerConnectionError(
                        options.kernelConnection.baseUrl,
                        options.kernelConnection.serverHandle,
                        ex
                    );
                }
            }

            Cancellation.throwIfCanceled(options.token);
            // Disposing session manager will dispose all sessions that were started by that session manager.
            // Hence Session managers should be disposed only if the corresponding session is shutdown.
            const session = await this.createSession(options, connection);
            session.onDidShutdown(() => labHelper.dispose());
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
                        options.kernelConnection.serverHandle,
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
        } finally {
            disposeAllDisposables(disposables);
        }
    }
    private async createSession(
        options: KernelSessionCreationOptions,
        connection: IJupyterConnection
    ): Promise<IJupyterKernelSession> {
        Cancellation.throwIfCanceled(options.token);
        // Figure out the working directory we need for our new notebook. This is only necessary for local.
        const workingDirectory = isLocalConnection(options.kernelConnection)
            ? await this.workspaceService.computeWorkingDirectory(options.resource)
            : '';
        Cancellation.throwIfCanceled(options.token);
        // Start a session (or use the existing one if allowed)
        const session = new JupyterSession(
            options.resource,
            connection,
            options.kernelConnection,
            Uri.file(workingDirectory),
            this.configService.getSettings(options.resource).jupyterLaunchTimeout,
            this.kernelService,
            this.configService.getSettings(options.resource).jupyterInterruptTimeout,
            this.requestCreator,
            options.creator
        );
        try {
            await session.connect({ token: options.token, ui: options.ui });
        } finally {
            if (!session.isConnected) {
                await session.dispose();
            }
        }

        if (options.token.isCancellationRequested) {
            // Even if this is a remote kernel, we should shut this down as it's not needed.
            session.shutdown().catch(noop);
        }
        Cancellation.throwIfCanceled(options.token);
        traceInfo(`Started session for kernel ${options.kernelConnection.kind}:${options.kernelConnection.id}`);
        return session;
    }
}
