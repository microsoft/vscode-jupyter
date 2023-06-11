// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Cancellation, raceCancellationError } from '../../../platform/common/cancellation';
import uuid from 'uuid/v4';
import {
    IJupyterConnection,
    IJupyterKernelSession,
    IKernelSessionFactory,
    ISessionWithSocket,
    KernelActionSource,
    KernelConnectionMetadata,
    KernelSessionCreationOptions,
    LiveRemoteKernelConnectionMetadata,
    isLocalConnection,
    isRemoteConnection
} from '../../types';
import * as urlPath from '../../../platform/vscode-path/resources';
import * as path from '../../../platform/vscode-path/resources';
import { IJupyterKernelService, IJupyterRequestCreator, IJupyterServerProvider } from '../types';
import { traceError, traceInfo, traceVerbose } from '../../../platform/logging';
import { inject, injectable, optional } from 'inversify';
import { noop } from '../../../platform/common/utils/misc';
import { RemoteJupyterServerConnectionError } from '../../../platform/errors/remoteJupyterServerConnectionError';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { JupyterSelfCertsError } from '../../../platform/errors/jupyterSelfCertsError';
import { JupyterSelfCertsExpiredError } from '../../../platform/errors/jupyterSelfCertsExpiredError';
import { LocalJupyterServerConnectionError } from '../../../platform/errors/localJupyterServerConnectionError';
import { BaseError } from '../../../platform/errors/types';
import { sendTelemetryEvent, Telemetry } from '../../../telemetry';
import { IConfigurationService, IDisplayOptions, IDisposable, Resource } from '../../../platform/common/types';
import { JupyterConnection } from '../connection/jupyterConnection';
import { KernelProgressReporter } from '../../../platform/progress/kernelProgressReporter';
import { DataScience } from '../../../platform/common/utils/localize';
import { JupyterSession, getRemoteSessionOptions, waitForIdleOnSession } from './jupyterSession';
import { CancellationError, CancellationToken } from 'vscode';
import { KernelManager, KernelSpecManager, Session, SessionManager } from '@jupyterlab/services';
import { waitForCondition } from '../../../platform/common/utils/async';
import { getNameOfKernelConnection, jvscIdentifier } from '../../helpers';
import { JupyterSessionStartError } from '../../common/baseJupyterSession';
import { JupyterInvalidKernelError } from '../../errors/jupyterInvalidKernelError';

@injectable()
export class JupyterKernelSessionFactory implements IKernelSessionFactory {
    constructor(
        @inject(IJupyterServerProvider)
        private readonly jupyterNotebookProvider: IJupyterServerProvider,
        @inject(JupyterConnection) private readonly jupyterConnection: JupyterConnection,
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
        const disposablesIfAnyErrors: IDisposable[] = [];
        const idleTimeout = this.configService.getSettings(options.resource).jupyterLaunchTimeout;
        try {
            connection = isRemoteConnection(options.kernelConnection)
                ? await this.jupyterConnection.createRemoteConnectionInfo(options.kernelConnection.serverHandle)
                : await this.jupyterNotebookProvider.getOrStartServer({
                      resource: options.resource,
                      token: options.token,
                      ui: options.ui
                  });

            await this.validateLocalKernelDependencies(options);
            const jlab = require('@jupyterlab/services') as typeof import('@jupyterlab/services');
            const serverSettings = connection.serverSettings;
            const kernelManager = new jlab.KernelManager({ serverSettings });
            const kernelSpecManager = new jlab.KernelSpecManager({ serverSettings });
            const sessionManager = new jlab.SessionManager({
                serverSettings,
                kernelManager
            });
            disposablesIfAnyErrors.push(kernelManager, sessionManager);
            disposables.push(kernelSpecManager);

            const jupyterSession = await this.connectToOrCreateSession({
                ...options,
                sessionManager,
                kernelManager,
                kernelSpecManager,
                connection,
                idleTimeout
            });
            // Start a session (or use the existing one if allowed)
            const session = new JupyterSession(
                jupyterSession,
                options.resource,
                connection,
                options.kernelConnection,
                this.requestCreator,
                sessionManager,
                kernelManager
            );

            if (options.token.isCancellationRequested) {
                // Even if this is a remote kernel, we should shut this down as it's not needed.
                session.shutdown().catch(noop);
            }
            Cancellation.throwIfCanceled(options.token);
            traceInfo(`Started session for kernel ${options.kernelConnection.kind}:${options.kernelConnection.id}`);
            return session;
        } catch (ex) {
            disposeAllDisposables(disposablesIfAnyErrors);
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
    }) {
        if (options.token.isCancellationRequested) {
            throw new CancellationError();
        }
        let session: ISessionWithSocket;
        try {
            // Don't immediately assume this kernel is valid. Try creating a session with it first.
            if (
                options.kernelConnection &&
                options.kernelConnection.kind === 'connectToLiveRemoteKernel' &&
                options.kernelConnection.kernelModel.id &&
                options.kernelConnection.kernelModel.model
            ) {
                // Remote case.
                session = await this.connectToExistingSession({
                    ...options,
                    kernelConnection: options.kernelConnection
                });

                await waitForIdleOnSession(
                    session,
                    options.idleTimeout,
                    options.resource,
                    options.kernelConnection,
                    options.token,
                    false
                ).catch(noop);
            } else {
                traceVerbose(`createNewKernelSession ${options.kernelConnection?.id}`);
                session = await this.createNewSession(options);
            }
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
        if (options.token.isCancellationRequested) {
            throw new CancellationError();
        }

        return session;
    }
    private async connectToExistingSession(options: {
        resource: Resource;
        connection: IJupyterConnection;
        creator: KernelActionSource;
        kernelConnection: LiveRemoteKernelConnectionMetadata;
        token: CancellationToken;
        idleTimeout: number;
        // ui: IDisplayOptions;
        sessionManager: SessionManager;
        kernelSpecManager: KernelSpecManager;
        // kernelManager: KernelManager;
    }): Promise<ISessionWithSocket> {
        if (!options.kernelConnection.kernelModel.model) {
            throw new Error(`Kernel model not defined when connecting to an existing session`);
        }

        // Remote case.
        const session = options.sessionManager.connectTo({
            ...options.kernelConnection.kernelModel,
            model: options.kernelConnection.kernelModel.model
        }) as ISessionWithSocket;
        session.kernelSocketInformation = {
            socket: this.requestCreator.getWebsocket(options.kernelConnection.id),
            options: {
                clientId: '',
                id: options.kernelConnection.id,
                model: { ...options.kernelConnection.kernelModel.model },
                userName: ''
            }
        };

        // newSession.kernel?.connectionStatus
        await waitForCondition(
            async () => session.kernel?.connectionStatus === 'connected' || options.token.isCancellationRequested,
            options.idleTimeout,
            100
        );

        return session;
    }
    private async createNewSession(options: {
        resource: Resource;
        connection: IJupyterConnection;
        creator: KernelActionSource;
        kernelConnection: KernelConnectionMetadata;
        token: CancellationToken;
        idleTimeout: number;
        // ui: IDisplayOptions;
        sessionManager: SessionManager;
        kernelSpecManager: KernelSpecManager;
        // kernelManager: KernelManager;
    }): Promise<ISessionWithSocket> {
        traceVerbose(`createNewKernelSession ${options.kernelConnection.id}`);
        const remoteSessionOptions = getRemoteSessionOptions(options.connection, options.resource);
        let sessionPath = remoteSessionOptions?.path;
        // If kernelName is empty this can cause problems for servers that don't
        // understand that empty kernel name means the default kernel.
        // See https://github.com/microsoft/vscode-jupyter/issues/5290
        const kernelName = getNameOfKernelConnection(
            options.kernelConnection,
            options.kernelSpecManager.specs?.default || ''
        );

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
        const work = () =>
            options.sessionManager
                .startNew(sessionOptions, {
                    kernelConnectionOptions: {
                        handleComms: true // This has to be true for ipywidgets to work
                    }
                })
                .then(async (session) => {
                    if (session.kernel) {
                        const sessionWithSocket = session as ISessionWithSocket;

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
                    }
                    throw new JupyterSessionStartError(new Error(`No kernel created`));
                })
                .catch((ex) => Promise.reject(new JupyterSessionStartError(ex)));
        return raceCancellationError(options.token, work());
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
