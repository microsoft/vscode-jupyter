// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationToken, Disposable, Uri } from 'vscode';
import { Cancellation, raceCancellationError } from '../../../platform/common/cancellation';
import {
    IJupyterConnection,
    IJupyterKernelSession,
    IKernelSessionFactory,
    KernelSessionCreationOptions,
    isLocalConnection,
    isRemoteConnection
} from '../../types';
import {
    IJupyterServerProvider,
    IJupyterSessionManager,
    IOldJupyterSessionManagerFactory,
    JupyterServerProviderHandle
} from '../types';
import { traceError, traceInfo } from '../../../platform/logging';
import { IWorkspaceService } from '../../../platform/common/application/types';
import { inject, injectable } from 'inversify';
import { noop } from '../../../platform/common/utils/misc';
import { SessionDisposedError } from '../../../platform/errors/sessionDisposedError';
import { RemoteJupyterServerConnectionError } from '../../../platform/errors/remoteJupyterServerConnectionError';
import { dispose } from '../../../platform/common/helpers';
import { JupyterSelfCertsError } from '../../../platform/errors/jupyterSelfCertsError';
import { JupyterSelfCertsExpiredError } from '../../../platform/errors/jupyterSelfCertsExpiredError';
import { LocalJupyterServerConnectionError } from '../../../platform/errors/localJupyterServerConnectionError';
import { BaseError } from '../../../platform/errors/types';
import { IAsyncDisposableRegistry, IDisposable } from '../../../platform/common/types';
import { JupyterConnection } from '../connection/jupyterConnection';
import { KernelProgressReporter } from '../../../platform/progress/kernelProgressReporter';
import { DataScience } from '../../../platform/common/utils/localize';
import { JupyterLabHelper } from './jupyterLabHelper';
import { IJupyterServerUri } from '../../../api';

@injectable()
export class OldJupyterKernelSessionFactory implements IKernelSessionFactory {
    private readonly hooks: ((
        data: {
            uri: Uri;
            serverId: JupyterServerProviderHandle;
            kernelSpecName: string;
            jupyterUri: IJupyterServerUri;
        },
        token: CancellationToken
    ) => Promise<IJupyterServerUri | undefined>)[] = [];
    constructor(
        @inject(IJupyterServerProvider)
        private readonly jupyterNotebookProvider: IJupyterServerProvider,
        @inject(IOldJupyterSessionManagerFactory)
        private readonly sessionManagerFactory: IOldJupyterSessionManagerFactory,
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection,
        @inject(IAsyncDisposableRegistry) private readonly asyncDisposables: IAsyncDisposableRegistry,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService
    ) {}
    addBeforeCreateHook(
        hook: (
            data: {
                uri: Uri;
                serverId: JupyterServerProviderHandle;
                kernelSpecName: string;
                jupyterUri: IJupyterServerUri;
            },
            token: CancellationToken
        ) => Promise<IJupyterServerUri | undefined>
    ): void {
        this.hooks.push(hook);
    }

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
            if (isRemoteConnection(options.kernelConnection)) {
                connection = await raceCancellationError(
                    options.token,
                    this.jupyterConnection.createConnectionInfo(
                        options.kernelConnection.serverProviderHandle,
                        async (conn) => {
                            if (
                                this.hooks.length &&
                                options.kernelConnection.kind === 'startUsingRemoteKernelSpec' &&
                                options.resource
                            ) {
                                // This is a very bad hook,
                                // We need hooks per provider, not per server (but this is temporary).
                                let hook = this.hooks.shift();
                                while (hook) {
                                    const result = await hook(
                                        {
                                            uri: options.resource,
                                            jupyterUri: conn,
                                            kernelSpecName: options.kernelConnection.kernelSpec.name,
                                            serverId: options.kernelConnection.serverProviderHandle
                                        },
                                        options.token
                                    );
                                    conn = result ?? conn;
                                    hook = this.hooks.shift();
                                }
                            }
                            return conn;
                        }
                    )
                );
            } else {
                connection = await this.jupyterNotebookProvider.getOrStartServer({
                    resource: options.resource,
                    token: options.token,
                    ui: options.ui
                });
            }

            Cancellation.throwIfCanceled(options.token);

            const sessionManager = this.sessionManagerFactory.create(connection);
            this.asyncDisposables.push(sessionManager);
            disposablesWhenThereAreFailures.push(new Disposable(() => sessionManager.dispose().catch(noop)));
            const jupyterLabHelper = JupyterLabHelper.create(connection.settings);
            disposables.push(new Disposable(() => jupyterLabHelper.dispose()));
            Cancellation.throwIfCanceled(options.token);
            // Disposing session manager will dispose all sessions that were started by that session manager.
            // Hence Session managers should be disposed only if the corresponding session is shutdown.
            const session = await this.createSession(options, jupyterLabHelper, sessionManager);
            session.onDidShutdown(() => sessionManager.dispose());
            return session;
        } catch (ex) {
            dispose(disposablesWhenThereAreFailures);

            if (isRemoteConnection(options.kernelConnection)) {
                // Check for the self signed certs error specifically
                if (!connection) {
                    throw ex;
                } else if (JupyterSelfCertsError.isSelfCertsError(ex)) {
                    throw new JupyterSelfCertsError(connection.baseUrl);
                } else if (JupyterSelfCertsExpiredError.isSelfCertsExpiredError(ex)) {
                    throw new JupyterSelfCertsExpiredError(connection.baseUrl);
                } else {
                    throw new RemoteJupyterServerConnectionError(
                        connection.baseUrl,
                        options.kernelConnection.serverProviderHandle,
                        ex
                    );
                }
            } else {
                if (ex instanceof BaseError) {
                    throw ex;
                } else {
                    throw new LocalJupyterServerConnectionError(ex);
                }
            }
        } finally {
            dispose(disposables);
        }
    }
    public async createSession(
        options: KernelSessionCreationOptions,
        jupyterLabHelper: JupyterLabHelper,
        sessionManager: IJupyterSessionManager
    ): Promise<IJupyterKernelSession> {
        if (sessionManager.isDisposed) {
            throw new SessionDisposedError();
        }
        if (isRemoteConnection(options.kernelConnection)) {
            try {
                await Promise.all([jupyterLabHelper.getRunningKernels(), jupyterLabHelper.getKernelSpecs()]);
            } catch (ex) {
                traceError(
                    'Failed to fetch running kernels from remote server, connection may be outdated or remote server may be unreachable',
                    ex
                );
                throw new RemoteJupyterServerConnectionError(
                    options.kernelConnection.baseUrl,
                    options.kernelConnection.serverProviderHandle,
                    ex
                );
            }
        }

        Cancellation.throwIfCanceled(options.token);
        // Figure out the working directory we need for our new notebook. This is only necessary for local.
        const workingDirectory = isLocalConnection(options.kernelConnection)
            ? await this.workspaceService.computeWorkingDirectory(options.resource)
            : '';
        Cancellation.throwIfCanceled(options.token);
        // Start a session (or use the existing one if allowed)
        const session = await sessionManager.startNew(
            options.resource,
            options.kernelConnection,
            Uri.file(workingDirectory),
            options.ui,
            options.token,
            options.creator
        );
        if (options.token.isCancellationRequested) {
            // Even if this is a remote kernel, we should shut this down as it's not needed.
            session.shutdown().catch(noop);
        }
        Cancellation.throwIfCanceled(options.token);
        traceInfo(`Started session for kernel ${options.kernelConnection.kind}:${options.kernelConnection.id}`);
        return session;
    }
}
