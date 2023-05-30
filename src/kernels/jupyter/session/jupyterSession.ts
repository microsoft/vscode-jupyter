// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as urlPath from '../../../platform/vscode-path/resources';
import type { Session, SessionManager } from '@jupyterlab/services';
import uuid from 'uuid/v4';
import { CancellationToken, CancellationTokenSource } from 'vscode-jsonrpc';
import { Cancellation } from '../../../platform/common/cancellation';
import { BaseError } from '../../../platform/errors/types';
import { traceVerbose, traceError, traceWarning, traceInfo } from '../../../platform/logging';
import { Resource, IDisplayOptions, ReadWrite } from '../../../platform/common/types';
import { waitForCondition } from '../../../platform/common/utils/async';
import { DataScience } from '../../../platform/common/utils/localize';
import { JupyterInvalidKernelError } from '../../errors/jupyterInvalidKernelError';
import { SessionDisposedError } from '../../../platform/errors/sessionDisposedError';
import { capturePerfTelemetry, Telemetry } from '../../../telemetry';
import { BaseJupyterSession, JupyterSessionStartError } from '../../common/baseJupyterSession';
import { getNameOfKernelConnection, jvscIdentifier } from '../../helpers';
import {
    KernelConnectionMetadata,
    isLocalConnection,
    IJupyterConnection,
    ISessionWithSocket,
    KernelActionSource,
    IJupyterKernelSession,
    isRemoteConnection
} from '../../types';
import { DisplayOptions } from '../../displayOptions';
import { IJupyterKernelService, IJupyterRequestCreator } from '../types';
import { CancellationError, Uri } from 'vscode';
import { noop } from '../../../platform/common/utils/misc';
import * as path from '../../../platform/vscode-path/resources';

// function is
export class JupyterSession
    extends BaseJupyterSession<'localJupyter' | 'remoteJupyter'>
    implements IJupyterKernelSession
{
    private readonly nameOfDefaultKernelSpec: string | undefined;
    private readonly sessionManager: SessionManager;
    constructor(
        resource: Resource,
        private connection: IJupyterConnection,
        kernelConnectionMetadata: KernelConnectionMetadata,
        override readonly workingDirectory: Uri,
        private readonly idleTimeout: number,
        private readonly kernelService: IJupyterKernelService | undefined,
        interruptTimeout: number,
        private readonly requestCreator: IJupyterRequestCreator,
        private readonly sessionCreator: KernelActionSource
    ) {
        super(
            connection.localLaunch ? 'localJupyter' : 'remoteJupyter',
            resource,
            kernelConnectionMetadata,
            workingDirectory,
            interruptTimeout
        );

        const jlab = require('@jupyterlab/services') as typeof import('@jupyterlab/services');
        const serverSettings = connection.serverSettings;
        const specsManager = new jlab.KernelSpecManager({ serverSettings });
        this.nameOfDefaultKernelSpec = specsManager.specs?.default;
        specsManager.dispose();
        const kernelManager = new jlab.KernelManager({ serverSettings });
        this.disposables.push(kernelManager);
        this.sessionManager = new jlab.SessionManager({
            serverSettings,
            kernelManager
        });
        this.disposables.push(this.sessionManager);
    }

    @capturePerfTelemetry(Telemetry.WaitForIdleJupyter)
    public waitForIdle(timeout: number, token: CancellationToken): Promise<void> {
        // Wait for idle on this session
        return this.waitForIdleOnSession(this.session, timeout, token);
    }
    public async connect(options: { token: CancellationToken; ui: IDisplayOptions }): Promise<void> {
        // Start a new session
        this.setSession(await this.createNewKernelSession(options));

        // Listen for session status changes
        this.session?.statusChanged.connect(this.statusHandler); // NOSONAR

        // Made it this far, we're connected now
        this.connected = true;
    }

    private async createNewKernelSession(options: {
        token: CancellationToken;
        ui: IDisplayOptions;
    }): Promise<ISessionWithSocket> {
        let newSession: ISessionWithSocket | undefined;
        try {
            // Don't immediately assume this kernel is valid. Try creating a session with it first.
            if (
                this.kernelConnectionMetadata &&
                this.kernelConnectionMetadata.kind === 'connectToLiveRemoteKernel' &&
                this.kernelConnectionMetadata.kernelModel.id &&
                this.kernelConnectionMetadata.kernelModel.model
            ) {
                // Remote case.
                newSession = this.sessionManager.connectTo({
                    ...this.kernelConnectionMetadata.kernelModel,
                    model: this.kernelConnectionMetadata.kernelModel.model
                }) as ISessionWithSocket;
                newSession.kernelSocketInformation = {
                    socket: this.requestCreator.getWebsocket(this.kernelConnectionMetadata.id),
                    options: {
                        clientId: '',
                        id: this.kernelConnectionMetadata.id,
                        model: { ...this.kernelConnectionMetadata.kernelModel.model },
                        userName: ''
                    }
                };

                // newSession.kernel?.connectionStatus
                await waitForCondition(
                    async () =>
                        newSession?.kernel?.connectionStatus === 'connected' || options.token.isCancellationRequested,
                    this.idleTimeout,
                    100
                );
                if (options.token.isCancellationRequested) {
                    throw new CancellationError();
                }
            } else {
                traceVerbose(`createNewKernelSession ${this.kernelConnectionMetadata?.id}`);
                newSession = await this.createSession(options);

                // Make sure it is idle before we return
                await this.waitForIdleOnSession(newSession, this.idleTimeout, options.token);
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
                throw new JupyterInvalidKernelError(this.kernelConnectionMetadata);
            }
        }

        return newSession;
    }
    protected override setSession(session: ISessionWithSocket | undefined, forceUpdateKernelSocketInfo?: boolean) {
        // When we restart a remote session, the socket information is different, hence reset it.
        const socket = this.requestCreator.getWebsocket(this.kernelConnectionMetadata.id);
        if (session?.kernelSocketInformation?.socket && forceUpdateKernelSocketInfo && socket) {
            (session.kernelSocketInformation as ReadWrite<typeof session.kernelSocketInformation>).socket = socket;
        }
        return super.setSession(session, forceUpdateKernelSocketInfo);
    }
    protected async createRestartSession(
        disableUI: boolean,
        session: ISessionWithSocket,
        cancelToken: CancellationToken
    ): Promise<ISessionWithSocket> {
        // We need all of the above to create a restart session
        if (!session || !this.sessionManager) {
            throw new SessionDisposedError();
        }
        let result: ISessionWithSocket | undefined;
        let tryCount = 0;
        const ui = new DisplayOptions(disableUI);
        try {
            traceVerbose(
                `JupyterSession.createNewKernelSession ${tryCount}, id is ${this.kernelConnectionMetadata?.id}`
            );
            result = await this.createSession({ token: cancelToken, ui });
            await this.waitForIdleOnSession(result, this.idleTimeout, cancelToken);
            return result;
        } catch (exc) {
            traceWarning(`Error waiting for restart session: ${exc}`);
            if (result) {
                this.shutdownSession(result, undefined, true).catch(noop);
            }
            result = undefined;
            throw exc;
        } finally {
            ui.dispose();
        }
    }

    protected startRestartSession(disableUI: boolean) {
        if (!this.session) {
            throw new Error('Session disposed or not initialized');
        }
        const token = new CancellationTokenSource();
        const promise = this.createRestartSession(disableUI, this.session, token.token);
        this.restartSessionPromise = { token, promise };
        promise
            .finally(() => {
                token.dispose();
                if (this.restartSessionPromise?.promise === promise) {
                    this.restartSessionPromise = undefined;
                }
            })
            .catch(noop);
        return promise;
    }

    private async createSession(options: {
        token: CancellationToken;
        ui: IDisplayOptions;
    }): Promise<ISessionWithSocket> {
        const remoteSessionOptions = getRemoteSessionOptions(this.connection, this.resource);
        let sessionPath = remoteSessionOptions?.path;

        // Make sure the kernel has ipykernel installed if on a local machine.
        if (
            this.kernelConnectionMetadata?.interpreter &&
            isLocalConnection(this.kernelConnectionMetadata) &&
            this.kernelService
        ) {
            // Make sure the kernel actually exists and is up to date.
            await this.kernelService.ensureKernelIsUsable(
                this.resource,
                this.kernelConnectionMetadata,
                options.ui,
                options.token,
                this.sessionCreator === '3rdPartyExtension'
            );
        }

        // If kernelName is empty this can cause problems for servers that don't
        // understand that empty kernel name means the default kernel.
        // See https://github.com/microsoft/vscode-jupyter/issues/5290
        const kernelName = getNameOfKernelConnection(this.kernelConnectionMetadata, this.nameOfDefaultKernelSpec || '');

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
            const fileExtension = this.resource ? path.extname(this.resource) : '';
            sessionName = `${
                this.resource ? path.basename(this.resource, fileExtension) : ''
            }-${uuid()}${fileExtension}`;
        }

        // Create our session options using this temporary notebook and our connection info
        const sessionOptions: Session.ISessionOptions = {
            path: sessionPath || generateBackingIPyNbFileName(this.resource), // Name has to be unique, else Jupyter will re-use the same session.
            kernel: {
                name: kernelName
            },
            name: sessionName, // Name has to be unique, else Jupyter will re-use the same session.
            type: (this.resource?.path || '').toLowerCase().endsWith('.ipynb') ? 'notebook' : 'console'
        };

        const requestCreator = this.requestCreator;

        return Cancellation.race(
            () =>
                this.sessionManager!.startNew(sessionOptions, {
                    kernelConnectionOptions: {
                        handleComms: true // This has to be true for ipywidgets to work
                    }
                })
                    .then(async (session) => {
                        if (!session.kernel) {
                            throw new JupyterSessionStartError(new Error(`No kernel created`));
                        }
                        if (isRemoteConnection(this.kernelConnectionMetadata)) {
                            traceInfo(DataScience.createdNewKernel(this.connection.baseUrl, session.kernel.id));
                        }
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
                    })
                    .catch((ex) => Promise.reject(new JupyterSessionStartError(ex))),
            options.token
        );
    }
}

export function getRemoteSessionOptions(
    remoteConnection: IJupyterConnection,
    resource?: Uri
): Pick<Session.ISessionOptions, 'path' | 'name'> | undefined | void {
    if (!resource || resource.scheme === 'untitled' || !remoteConnection.mappedRemoteNotebookDir) {
        return;
    }
    // Get Uris of both, local and remote files.
    // Convert Uris to strings to Uri again, as its possible the Uris are not always compatible.
    // E.g. one could be dealing with custom file system providers.
    const filePath = Uri.file(resource.path);
    const mappedLocalPath = Uri.file(remoteConnection.mappedRemoteNotebookDir);
    if (!path.isEqualOrParent(filePath, mappedLocalPath)) {
        return;
    }
    const sessionPath = path.relativePath(mappedLocalPath, filePath);
    // If we have mapped the local dir to the remote dir, then we need to use the name of the file.
    const sessionName = path.basename(resource);
    if (sessionName && sessionPath) {
        return {
            path: sessionPath,
            name: sessionName
        };
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
