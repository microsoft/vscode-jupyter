// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CancellationError, CancellationToken, Disposable, Uri } from 'vscode';
import { Cancellation, raceCancellationError } from '../../../platform/common/cancellation';
import uuid from 'uuid/v4';
import * as urlPath from '../../../platform/vscode-path/resources';
import * as path from '../../../platform/vscode-path/resources';
import {
    IJupyterConnection,
    IJupyterKernelSession,
    IKernelSessionFactory,
    INewSessionWithSocket,
    KernelActionSource,
    KernelConnectionMetadata,
    KernelSessionCreationOptions,
    isLocalConnection,
    isRemoteConnection
} from '../../types';
import {
    IBackupFile,
    IJupyterBackingFileCreator,
    IJupyterKernelService,
    IJupyterRequestCreator,
    IJupyterServerProvider
} from '../types';
import { traceError, traceInfo, traceVerbose, traceWarning } from '../../../platform/logging';
import { IWorkspaceService } from '../../../platform/common/application/types';
import { inject, injectable, optional } from 'inversify';
import { noop, swallowExceptions } from '../../../platform/common/utils/misc';
import { SessionDisposedError } from '../../../platform/errors/sessionDisposedError';
import { RemoteJupyterServerConnectionError } from '../../../platform/errors/remoteJupyterServerConnectionError';
import { dispose } from '../../../platform/common/helpers';
import { JupyterSelfCertsError } from '../../../platform/errors/jupyterSelfCertsError';
import { JupyterSelfCertsExpiredError } from '../../../platform/errors/jupyterSelfCertsExpiredError';
import { LocalJupyterServerConnectionError } from '../../../platform/errors/localJupyterServerConnectionError';
import { BaseError } from '../../../platform/errors/types';
import { sendTelemetryEvent, Telemetry } from '../../../telemetry';
import {
    IAsyncDisposableRegistry,
    IConfigurationService,
    IDisplayOptions,
    IDisposable,
    Resource
} from '../../../platform/common/types';
import { JupyterConnection } from '../connection/jupyterConnection';
import { KernelProgressReporter } from '../../../platform/progress/kernelProgressReporter';
import { DataScience } from '../../../platform/common/utils/localize';
import type { KernelSpecManager, SessionManager, KernelManager, ContentsManager, Session } from '@jupyterlab/services';
import { JupyterSessionStartError } from '../../common/baseJupyterSession';
import { waitForIdleOnSession } from '../../common/helpers';
import { JupyterInvalidKernelError } from '../../errors/jupyterInvalidKernelError';
import { getNameOfKernelConnection, jvscIdentifier } from '../../helpers';
import { waitForCondition } from '../../../platform/common/utils/async';
import { JupyterLabHelper } from './jupyterLabHelper';
import { JupyterSessionWrapper, getRemoteSessionOptions } from './jupyterSession';

/* eslint-disable @typescript-eslint/no-explicit-any */
export const LocalHosts = ['localhost', '127.0.0.1', '::1'];

@injectable()
export class JupyterKernelSessionFactory implements IKernelSessionFactory {
    constructor(
        @inject(IJupyterServerProvider)
        private readonly jupyterNotebookProvider: IJupyterServerProvider,
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection,
        @inject(IAsyncDisposableRegistry) private readonly asyncDisposables: IAsyncDisposableRegistry,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IJupyterRequestCreator)
        private readonly requestCreator: IJupyterRequestCreator,
        @inject(IJupyterBackingFileCreator) private readonly backingFileCreator: IJupyterBackingFileCreator,
        @inject(IJupyterKernelService) @optional() private readonly kernelService: IJupyterKernelService | undefined,
        @inject(IConfigurationService) private configService: IConfigurationService
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
        const disposablesIfAnyErrors: IDisposable[] = [];
        const idleTimeout = this.configService.getSettings(options.resource).jupyterLaunchTimeout;
        try {
            connection = isRemoteConnection(options.kernelConnection)
                ? await raceCancellationError(
                      options.token,
                      this.jupyterConnection.createConnectionInfo(options.kernelConnection.serverProviderHandle)
                  )
                : await this.jupyterNotebookProvider.getOrStartServer({
                      resource: options.resource,
                      token: options.token,
                      ui: options.ui
                  });
            if (!connection.localLaunch && LocalHosts.includes(connection.hostName.toLowerCase())) {
                sendTelemetryEvent(Telemetry.ConnectRemoteJupyterViaLocalHost);
            }

            await raceCancellationError(options.token, this.validateLocalKernelDependencies(options));

            const sessionManager = JupyterLabHelper.create(connection.settings);
            this.asyncDisposables.push(sessionManager);
            disposablesIfAnyErrors.push(new Disposable(() => sessionManager.dispose().catch(noop)));

            await raceCancellationError(options.token, this.validateRemoteServer(options, sessionManager));

            // Figure out the working directory we need for our new notebook. This is only necessary for local.
            const workingDirectory = isLocalConnection(options.kernelConnection)
                ? await raceCancellationError(
                      options.token,
                      this.workspaceService.computeWorkingDirectory(options.resource)
                  )
                : '';

            // Disposing session manager will dispose all sessions that were started by that session manager.
            // Hence Session managers should be disposed only if the corresponding session is shutdown.
            const session = await this.connectToOrCreateSession({
                ...options,
                contentsManager: sessionManager.contentsManager,
                sessionManager: sessionManager.sessionManager,
                kernelManager: sessionManager.kernelManager,
                kernelSpecManager: sessionManager.kernelSpecManager,
                idleTimeout,
                connection
            });
            if (options.token.isCancellationRequested) {
                // Even if this is a remote kernel, we should shut this down as it's not needed.
                await session.shutdown().catch(noop);
                swallowExceptions(() => session.dispose());
            }
            Cancellation.throwIfCanceled(options.token);
            traceInfo(`Started session for kernel ${options.kernelConnection.kind}:${options.kernelConnection.id}`);

            const wrapperSession = new JupyterSessionWrapper(
                session,
                options.resource,
                options.kernelConnection,
                Uri.file(workingDirectory),
                connection,
                this.kernelService,
                options.creator
            );
            const disposed = session.disposed;
            const onDidDisposeSession = () => {
                sessionManager.dispose().catch(noop);
                disposed.disconnect(onDidDisposeSession);
            };
            this.asyncDisposables.push({
                dispose: () => wrapperSession.shutdown().finally(() => wrapperSession.dispose())
            });
            session.disposed.connect(onDidDisposeSession);
            const disposable = wrapperSession.onDidDispose(onDidDisposeSession);
            this.asyncDisposables.push(disposable);
            return wrapperSession;
        } catch (ex) {
            dispose(disposablesIfAnyErrors);

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
                        options.kernelConnection.serverProviderHandle,
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
            dispose(disposables);
        }
    }
    private async validateRemoteServer(
        options: KernelSessionCreationOptions,
        sessionManager: JupyterLabHelper
    ): Promise<void> {
        if (sessionManager.isDisposed) {
            throw new SessionDisposedError();
        }
        if (isLocalConnection(options.kernelConnection)) {
            return;
        }
        try {
            await Promise.all([sessionManager.getRunningKernels(), sessionManager.getKernelSpecs()]);
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
    private async validateLocalKernelDependencies(options: {
        resource: Resource;
        creator: KernelActionSource;
        kernelConnection: KernelConnectionMetadata;
        token: CancellationToken;
        ui: IDisplayOptions;
    }) {
        if (options.token.isCancellationRequested) {
            throw new CancellationError();
        }
        // Make sure the kernel has ipykernel installed if on a local machine.
        if (
            options.kernelConnection?.interpreter &&
            isLocalConnection(options.kernelConnection) &&
            this.kernelService
        ) {
            // Make sure the kernel actually exists and is up to date.
            await this.kernelService.ensureKernelIsUsable(
                options.resource,
                options.kernelConnection,
                options.ui,
                options.token,
                options.creator === '3rdPartyExtension'
            );
        }
    }
    private async connectToOrCreateSession(options: {
        resource: Resource;
        creator: KernelActionSource;
        kernelConnection: KernelConnectionMetadata;
        connection: IJupyterConnection;
        token: CancellationToken;
        idleTimeout: number;
        ui: IDisplayOptions;
        kernelSpecManager: KernelSpecManager;
        sessionManager: SessionManager;
        kernelManager: KernelManager;
        contentsManager: ContentsManager;
    }) {
        if (options.token.isCancellationRequested) {
            throw new CancellationError();
        }
        let session: INewSessionWithSocket;
        try {
            // Don't immediately assume this kernel is valid. Try creating a session with it first.
            if (
                options.kernelConnection &&
                options.kernelConnection.kind === 'connectToLiveRemoteKernel' &&
                options.kernelConnection.kernelModel.id &&
                options.kernelConnection.kernelModel.model
            ) {
                if (!options.kernelConnection.kernelModel.model) {
                    throw new Error(`Kernel model not defined when connecting to an existing session`);
                }
                session = options.sessionManager.connectTo({
                    ...options.kernelConnection.kernelModel,
                    model: options.kernelConnection.kernelModel.model
                }) as INewSessionWithSocket;

                // Add on the kernel metadata & sock information
                const requestCreator = this.requestCreator;
                session.kernelSocketInformation = {
                    get socket() {
                        // When we restart kernels, a new websocket is created and we need to get the new one.
                        // & the id in the dictionary is the kernel.id.
                        return requestCreator.getWebsocket(options.kernelConnection.id);
                    },
                    options: {
                        clientId: '',
                        id: options.kernelConnection.id,
                        model: { ...options.kernelConnection.kernelModel.model },
                        userName: ''
                    }
                };

                await raceCancellationError(
                    options.token,
                    waitForCondition(
                        async () =>
                            session.kernel?.connectionStatus === 'connected' || options.token.isCancellationRequested,
                        options.idleTimeout,
                        100
                    )
                );
            } else {
                traceVerbose(`createNewKernelSession ${options.kernelConnection?.id}`);
                session = await this.createNewSession(options);

                await waitForIdleOnSession(
                    options.kernelConnection,
                    options.resource,
                    session,
                    options.idleTimeout,
                    options.token
                ).catch(noop);
            }
            if (options.token.isCancellationRequested) {
                throw new CancellationError();
            }

            return session;
        } catch (exc) {
            // Don't log errors if UI is disabled (e.g. auto starting a kernel)
            // Else we just pollute the logs with lots of noise.
            const loggerFn = options.ui.disableUI ? traceVerbose : traceError;
            // Don't swallow known exceptions.
            if (exc instanceof BaseError) {
                loggerFn('Failed to change kernel, re-throwing', exc);
                throw exc;
            } else {
                loggerFn('Failed to change kernel', exc);
                // Throw a new exception indicating we cannot change.
                throw new JupyterInvalidKernelError(options.kernelConnection);
            }
        }
    }
    private async createNewSession(options: {
        resource: Resource;
        connection: IJupyterConnection;
        creator: KernelActionSource;
        kernelConnection: KernelConnectionMetadata;
        token: CancellationToken;
        idleTimeout: number;
        sessionManager: SessionManager;
        kernelSpecManager?: KernelSpecManager;
        contentsManager: ContentsManager;
        ui: IDisplayOptions;
    }): Promise<INewSessionWithSocket> {
        const telemetryInfo = {
            failedWithoutBackingFile: false,
            failedWithBackingFile: false,
            localHost: options.connection.localLaunch
        };

        try {
            return await this.createNewSessionImpl({ ...options, createBakingFile: false });
        } catch (ex) {
            traceWarning(`Failed to create a session without a backing file, trying again with a backing file`, ex);
            try {
                telemetryInfo.failedWithoutBackingFile = true;
                return await this.createNewSessionImpl({
                    ...options,
                    createBakingFile: true
                });
            } catch (ex) {
                telemetryInfo.failedWithBackingFile = true;
                throw ex;
            }
        } finally {
            sendTelemetryEvent(Telemetry.StartedRemoteJupyterSessionWithBackingFile, undefined, telemetryInfo);
        }
    }
    private async createNewSessionImpl(options: {
        resource: Resource;
        connection: IJupyterConnection;
        creator: KernelActionSource;
        kernelConnection: KernelConnectionMetadata;
        token: CancellationToken;
        idleTimeout: number;
        sessionManager: SessionManager;
        kernelSpecManager?: KernelSpecManager;
        contentsManager: ContentsManager;
        ui: IDisplayOptions;
        createBakingFile: boolean;
    }): Promise<INewSessionWithSocket> {
        const remoteSessionOptions = getRemoteSessionOptions(options.connection, options.resource);
        let backingFile: IBackupFile | undefined;
        let sessionPath = remoteSessionOptions?.path;

        if (!sessionPath && options.createBakingFile) {
            // Create our backing file for the notebook
            backingFile = await this.backingFileCreator.createBackingFile(
                options.resource,
                Uri.file(''),
                options.kernelConnection,
                options.connection,
                options.contentsManager
            );
            sessionPath = backingFile?.filePath;
        }

        // If kernelName is empty this can cause problems for servers that don't
        // understand that empty kernel name means the default kernel.
        // See https://github.com/microsoft/vscode-jupyter/issues/5290
        const kernelName =
            getNameOfKernelConnection(options.kernelConnection) ?? options.kernelSpecManager?.specs?.default ?? '';

        // NOTE: If the path is a constant value such as `remoteFilePath` then Jupyter will alway re-use the same kernel sessions.
        // I.e. if we select Remote Kernel A for Notebook a.ipynb, then a session S1 will be created.
        // Next, if we attempt to create a new session for select Remote Kernel A once again for Notebook a.ipynb,
        // the jupyter server will see that a session already exists for the same kernel, hence will re-use the same session S1.
        // In such cases, the `name` of the session is not required, jupyter lab too does not set this.
        // If its empty Jupyter will default to the relative path of the notebook.

        let sessionName: string;
        if (remoteSessionOptions?.name) {
            sessionName = remoteSessionOptions.name;
        } else {
            // Ensure the session name is user friendly, so we can determine what it maps to.
            // This way users managing the sessions on remote servers know which session maps to a particular file on the local machine.
            const fileExtension = options.resource ? path.extname(options.resource) : '';
            sessionName = `${
                options.resource ? path.basename(options.resource, fileExtension) : ''
            }-${uuid()}${fileExtension}`;
        }

        // Create our session options using this temporary notebook and our connection info
        const sessionOptions: Session.ISessionOptions = {
            path: sessionPath || generateBackingIPyNbFileName(options.resource), // Name has to be unique, else Jupyter will re-use the same session.
            kernel: {
                name: kernelName
            },
            name: sessionName, // Name has to be unique, else Jupyter will re-use the same session.
            type: (options.resource?.path || '').toLowerCase().endsWith('.ipynb') ? 'notebook' : 'console'
        };

        const requestCreator = this.requestCreator;
        try {
            const session = await raceCancellationError(
                options.token,
                options.sessionManager.startNew(sessionOptions, {
                    kernelConnectionOptions: {
                        handleComms: true // This has to be true for ipywidgets to work
                    }
                })
            );
            if (!session.kernel) {
                throw new JupyterSessionStartError(new Error(`No kernel created`));
            }
            traceInfo(DataScience.createdNewKernel(options.connection.baseUrl, session?.kernel?.id || ''));
            const sessionWithSocket = session as INewSessionWithSocket;

            // Add on the kernel metadata & sock information
            sessionWithSocket.kernelSocketInformation = {
                get socket() {
                    // When we restart kernels, a new websocket is created and we need to get the new one.
                    // & the id in the dictionary is the kernel.id.
                    return requestCreator.getWebsocket(session.kernel!.id);
                },
                options: {
                    clientId: session.kernel.clientId,
                    id: session.kernel.id,
                    model: { ...session.kernel.model },
                    userName: session.kernel.username
                }
            };
            return sessionWithSocket;
        } catch (ex) {
            if (ex instanceof JupyterSessionStartError) {
                throw ex;
            }
            throw new JupyterSessionStartError(ex);
        } finally {
            if (backingFile) {
                options.contentsManager.delete(backingFile.filePath).catch(noop);
            }
        }
    }
}

function getRemoteIPynbSuffix(): string {
    return `${jvscIdentifier}${uuid()}`;
}

function generateBackingIPyNbFileName(resource: Resource) {
    // Generate a more descriptive name
    const suffix = `${getRemoteIPynbSuffix()}${uuid()}.ipynb`;
    return resource
        ? `${urlPath.basename(resource, '.ipynb')}${suffix}`
        : `${DataScience.defaultNotebookName}${suffix}`;
}
