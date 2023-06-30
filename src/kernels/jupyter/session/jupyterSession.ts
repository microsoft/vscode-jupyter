// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ContentsManager,
    Kernel,
    KernelMessage,
    KernelSpecManager,
    Session,
    SessionManager
} from '@jupyterlab/services';
import type { Slot } from '@lumino/signaling';
import uuid from 'uuid/v4';
import { Observable } from 'rxjs/Observable';
import { ReplaySubject } from 'rxjs/ReplaySubject';
import { raceCancellationError } from '../../../platform/common/cancellation';
import { BaseError, WrappedError } from '../../../platform/errors/types';
import { traceVerbose, traceError, traceWarning, traceInfo, traceInfoIfCI } from '../../../platform/logging';
import { Resource, IOutputChannel, IDisplayOptions, ReadWrite, IDisposable } from '../../../platform/common/types';
import { createDeferred, raceTimeout, waitForCondition } from '../../../platform/common/utils/async';
import { DataScience } from '../../../platform/common/utils/localize';
import { JupyterInvalidKernelError } from '../../errors/jupyterInvalidKernelError';
import { SessionDisposedError } from '../../../platform/errors/sessionDisposedError';
import { sendTelemetryEvent, Telemetry } from '../../../telemetry';
import { suppressShutdownErrors } from '../../common/shutdownHelper';
import { getNameOfKernelConnection } from '../../helpers';
import {
    KernelConnectionMetadata,
    isLocalConnection,
    IJupyterConnection,
    ISessionWithSocket,
    KernelActionSource,
    IJupyterKernelSession,
    IBaseKernelSession,
    KernelSocketInformation
} from '../../types';
import { DisplayOptions } from '../../displayOptions';
import { IBackupFile, IJupyterBackingFileCreator, IJupyterKernelService, IJupyterRequestCreator } from '../types';
import {
    CancellationToken,
    CancellationTokenSource,
    CancellationError,
    Disposable,
    Event,
    EventEmitter,
    Uri
} from 'vscode';
import { generateBackingIPyNbFileName } from './backingFileCreator.base';
import { noop, swallowExceptions } from '../../../platform/common/utils/misc';
import * as path from '../../../platform/vscode-path/resources';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { getResourceType } from '../../../platform/common/utils';
import { KernelProgressReporter } from '../../../platform/progress/kernelProgressReporter';
import { KernelConnectionWrapper } from '../../common/kernelConnectionWrapper';
import { JupyterWaitForIdleError } from '../../errors/jupyterWaitForIdleError';

/**
 * Exception raised when starting a Jupyter Session fails.
 *
 * Cause:
 * Jupyter [session](https://jupyterlab.readthedocs.io/en/stable/api/modules/services.session.html) was not created for some reason
 * by the [SessionManager](https://jupyterlab.readthedocs.io/en/stable/api/classes/services.sessionmanager-1.html)
 *
 * Handled by:
 * User should be shown this in the executing cell (if there is one), otherwise a notification will pop up. User is asked to look in the output
 * tab for more information (hopefully the reason the SessionManager failed).
 */
export class JupyterSessionStartError extends WrappedError {
    constructor(originalException: Error) {
        super(originalException.message, originalException);
        sendTelemetryEvent(Telemetry.StartSessionFailedJupyter, undefined, undefined, originalException);
    }
}

// function is
export class JupyterSession implements IJupyterKernelSession, IBaseKernelSession<'localJupyter' | 'remoteJupyter'> {
    public readonly kind: 'localJupyter' | 'remoteJupyter';
    /**
     * Keep a single instance of KernelConnectionWrapper.
     * This way when sessions change, we still have a single Kernel.IKernelConnection proxy (wrapper),
     * which will have all of the event handlers bound to it.
     * This allows consumers to add event handlers hand not worry about internals & can use the lower level Jupyter API.
     */
    private _wrappedKernel?: KernelConnectionWrapper;
    private _isDisposed?: boolean;
    private readonly _disposed = new EventEmitter<void>();
    private readonly didShutdown = new EventEmitter<void>();
    protected readonly disposables: IDisposable[] = [];
    public get id() {
        return this.session?.id;
    }
    public get disposed() {
        return this._isDisposed === true;
    }
    public get onDidDispose() {
        return this._disposed.event;
    }
    public get onDidShutdown() {
        return this.didShutdown.event;
    }
    protected get session(): ISessionWithSocket | undefined {
        return this._session;
    }
    public get kernelId(): string {
        return this.session?.kernel?.id || '';
    }
    public get kernel(): Kernel.IKernelConnection | undefined {
        if (this._wrappedKernel) {
            return this._wrappedKernel;
        }
        if (!this._session?.kernel) {
            return;
        }
        this._wrappedKernel = new KernelConnectionWrapper(this._session.kernel, this.disposables);
        return this._wrappedKernel;
    }

    public get kernelSocket(): Observable<KernelSocketInformation | undefined> {
        return this._kernelSocket;
    }
    public get onSessionStatusChanged(): Event<KernelMessage.Status> {
        return this.onStatusChangedEvent.event;
    }
    public get status(): KernelMessage.Status {
        return this.getServerStatus();
    }

    public get isConnected(): boolean {
        return this.connected;
    }

    protected onStatusChangedEvent = new EventEmitter<KernelMessage.Status>();
    protected statusHandler: Slot<ISessionWithSocket, KernelMessage.Status>;
    protected connected: boolean = false;
    protected restartSessionPromise?: { token: CancellationTokenSource; promise: Promise<ISessionWithSocket> };
    private _session: ISessionWithSocket | undefined;
    private _kernelSocket = new ReplaySubject<KernelSocketInformation | undefined>();
    private unhandledMessageHandler: Slot<ISessionWithSocket, KernelMessage.IMessage>;
    private previousAnyMessageHandler?: IDisposable;
    constructor(
        private readonly resource: Resource,
        private connInfo: IJupyterConnection,
        private readonly kernelConnectionMetadata: KernelConnectionMetadata,
        private specsManager: KernelSpecManager,
        private sessionManager: SessionManager,
        private contentsManager: ContentsManager,
        private readonly outputChannel: IOutputChannel,
        public readonly workingDirectory: Uri,
        private readonly idleTimeout: number,
        private readonly kernelService: IJupyterKernelService | undefined,
        private readonly backingFileCreator: IJupyterBackingFileCreator,
        private readonly requestCreator: IJupyterRequestCreator,
        private readonly sessionCreator: KernelActionSource
    ) {
        this.kind = connInfo.localLaunch ? 'localJupyter' : 'remoteJupyter';
        this.statusHandler = this.onStatusChanged.bind(this);
        this.unhandledMessageHandler = (_s, m) => {
            traceWarning(`Unhandled message found: ${m.header.msg_type}`);
        };
    }

    public async connect(options: { token: CancellationToken; ui: IDisplayOptions }): Promise<void> {
        // Start a new session
        this.setSession(await this.createNewKernelSession(options));

        // Listen for session status changes
        this.session?.statusChanged.connect(this.statusHandler); // NOSONAR

        // Made it this far, we're connected now
        this.connected = true;
    }
    public async dispose(): Promise<void> {
        await this.shutdownImplementation(false);
    }
    public async waitForIdle(timeout: number, token: CancellationToken): Promise<void> {
        if (this.session) {
            return this.waitForIdleOnSession(this.session, timeout, token);
        }
    }

    public async shutdown(): Promise<void> {
        await this.shutdownImplementation(true);
    }

    public async restart(): Promise<void> {
        if (this.session?.isRemoteSession && this.session.kernel) {
            await this.session.kernel.restart();
            this.setSession(this.session, true);
            traceInfo(`Restarted ${this.session?.kernel?.id}`);
            return;
        }

        // Save old state for shutdown
        const oldSession = this.session;
        const oldStatusHandler = this.statusHandler;

        // TODO? Why aren't we killing this old session here now?
        // We should, If we're restarting and it fails, how is it ok to
        // keep the old session (user could be restarting for a number of reasons).

        // Just switch to the other session. It should already be ready

        // Start the restart session now in case it wasn't started
        const newSession = await this.startRestartSession(false);
        this.setSession(newSession);

        if (newSession.kernel) {
            traceVerbose(`New Session after restarting ${newSession.kernel.id}`);

            // Rewire our status changed event.
            newSession.statusChanged.connect(this.statusHandler);
            newSession.kernel.connectionStatusChanged.connect(this.onKernelConnectionStatusHandler, this);
        }
        if (oldStatusHandler && oldSession) {
            oldSession.statusChanged.disconnect(oldStatusHandler);
            if (oldSession.kernel) {
                oldSession.kernel.connectionStatusChanged.disconnect(this.onKernelConnectionStatusHandler, this);
            }
        }
        traceInfo(`Shutdown old session ${oldSession?.kernel?.id}`);
        this.shutdownSession(oldSession, undefined, false).catch(noop);
    }
    protected async waitForIdleOnSession(
        session: ISessionWithSocket | undefined,
        timeout: number,
        token?: CancellationToken,
        isRestartSession?: boolean
    ): Promise<void> {
        if (session && session.kernel) {
            const progress = isRestartSession
                ? undefined
                : KernelProgressReporter.reportProgress(this.resource, DataScience.waitingForJupyterSessionToBeIdle);
            const disposables: IDisposable[] = [];
            if (progress) {
                disposables.push(progress);
            }
            try {
                traceVerbose(
                    `Waiting for ${timeout}ms idle on (kernel): ${session.kernel.id} -> ${session.kernel.status}`
                );

                // When our kernel connects and gets a status message it triggers the ready promise
                const kernelStatus = createDeferred<string>();
                if (token) {
                    token.onCancellationRequested(
                        () => kernelStatus.reject(new CancellationError()),
                        this,
                        disposables
                    );
                }
                const handler = (_session: Kernel.IKernelConnection, status: KernelMessage.Status) => {
                    traceVerbose(`Got status ${status} in waitForIdleOnSession`);
                    if (status == 'idle') {
                        kernelStatus.resolve(status);
                    }
                };
                session.kernel.statusChanged?.connect(handler);
                disposables.push(
                    new Disposable(() => swallowExceptions(() => session.kernel?.statusChanged?.disconnect(handler)))
                );
                if (session.kernel.status == 'idle') {
                    kernelStatus.resolve(session.kernel.status);
                }
                // Check for possibility that kernel has died.
                const sessionDisposed = createDeferred<string>();
                const sessionDisposedHandler = () => sessionDisposed.resolve('');
                session.disposed.connect(sessionDisposedHandler, sessionDisposed);
                disposables.push(
                    new Disposable(() =>
                        swallowExceptions(() => session.disposed.disconnect(sessionDisposedHandler, sessionDisposed))
                    )
                );
                sessionDisposed.promise.catch(noop);
                kernelStatus.promise.catch(noop);
                const result = await raceTimeout(timeout, '', kernelStatus.promise, sessionDisposed.promise);
                if (session.isDisposed) {
                    traceError('Session disposed while waiting for session to be idle.');
                    throw new JupyterInvalidKernelError(this.kernelConnectionMetadata);
                }

                traceVerbose(`Finished waiting for idle on (kernel): ${session.kernel.id} -> ${session.kernel.status}`);

                if (result == 'idle') {
                    return;
                }
                traceError(
                    `Shutting down after failing to wait for idle on (kernel): ${session.kernel.id} -> ${session.kernel.status}`
                );
                // Before we throw an exception, make sure to shutdown the session as it's not usable anymore
                this.shutdownSession(session, this.statusHandler, isRestartSession).catch(noop);
                throw new JupyterWaitForIdleError(this.kernelConnectionMetadata);
            } catch (ex) {
                traceInfoIfCI(`Error waiting for idle`, ex);
                throw ex;
            } finally {
                disposeAllDisposables(disposables);
            }
        } else {
            throw new JupyterInvalidKernelError(this.kernelConnectionMetadata);
        }
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
                newSession.kernelConnectionMetadata = this.kernelConnectionMetadata;
                newSession.kernelSocketInformation = {
                    socket: this.requestCreator.getWebsocket(this.kernelConnectionMetadata.id),
                    options: {
                        clientId: '',
                        id: this.kernelConnectionMetadata.id,
                        model: { ...this.kernelConnectionMetadata.kernelModel.model },
                        userName: ''
                    }
                };
                newSession.isRemoteSession = true;
                newSession.resource = this.resource;

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
                newSession.resource = this.resource;

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
    private setSession(session: ISessionWithSocket | undefined, forceUpdateKernelSocketInfo?: boolean) {
        // When we restart a remote session, the socket information is different, hence reset it.
        const socket = this.requestCreator.getWebsocket(this.kernelConnectionMetadata.id);
        if (session?.kernelSocketInformation?.socket && forceUpdateKernelSocketInfo && socket) {
            (session.kernelSocketInformation as ReadWrite<typeof session.kernelSocketInformation>).socket = socket;
        }
        const oldSession = this._session;
        this.previousAnyMessageHandler?.dispose();
        if (session) {
            traceInfo(`Started new session ${session?.kernel?.id}`);
        }
        if (oldSession) {
            if (this.unhandledMessageHandler) {
                oldSession.unhandledMessage.disconnect(this.unhandledMessageHandler);
            }
            if (this.statusHandler) {
                oldSession.statusChanged.disconnect(this.statusHandler);
                oldSession.kernel?.connectionStatusChanged.disconnect(this.onKernelConnectionStatusHandler, this);
            }
        }
        this._session = session;
        if (session) {
            if (session.kernel && this._wrappedKernel) {
                this._wrappedKernel.changeKernel(session.kernel);
            }

            // Listen for session status changes
            session.statusChanged.connect(this.statusHandler);
            session.kernel?.connectionStatusChanged.connect(this.onKernelConnectionStatusHandler, this);
            if (session.kernelSocketInformation.socket?.onAnyMessage) {
                // These messages are sent directly to the kernel bypassing the Jupyter lab npm libraries.
                // As a result, we don't get any notification that messages were sent (on the anymessage signal).
                // To ensure those signals can still be used to monitor such messages, send them via a callback so that we can emit these messages on the anymessage signal.
                this.previousAnyMessageHandler = session.kernelSocketInformation.socket?.onAnyMessage((msg) => {
                    try {
                        if (this._wrappedKernel) {
                            const jupyterLabSerialize =
                                require('@jupyterlab/services/lib/kernel/serialize') as typeof import('@jupyterlab/services/lib/kernel/serialize'); // NOSONAR
                            const message =
                                typeof msg.msg === 'string' || msg.msg instanceof ArrayBuffer
                                    ? jupyterLabSerialize.deserialize(msg.msg)
                                    : msg.msg;
                            this._wrappedKernel.anyMessage.emit({ direction: msg.direction, msg: message });
                        }
                    } catch (ex) {
                        traceWarning(`failed to deserialize message to broadcast anymessage signal`);
                    }
                });
            }
            if (session.unhandledMessage) {
                session.unhandledMessage.connect(this.unhandledMessageHandler);
            }
            // If we have a new session, then emit the new kernel connection information.
            if ((forceUpdateKernelSocketInfo || oldSession !== session) && session.kernel) {
                this._kernelSocket.next({
                    options: {
                        clientId: session.kernel.clientId,
                        id: session.kernel.id,
                        model: { ...session.kernel.model },
                        userName: session.kernel.username
                    },
                    socket: session.kernelSocketInformation.socket
                });
            }
        }
    }
    protected async createRestartSession(
        disableUI: boolean,
        session: ISessionWithSocket,
        cancelToken: CancellationToken
    ): Promise<ISessionWithSocket> {
        // We need all of the above to create a restart session
        if (!session || !this.contentsManager || !this.sessionManager) {
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
        const telemetryInfo = {
            failedWithoutBackingFile: false,
            failedWithBackingFile: false,
            localHost: this.connInfo.localLaunch
        };

        try {
            return await this.createSessionImpl({ ...options, createBakingFile: false });
        } catch (ex) {
            traceWarning(`Failed to create a session without a backing file, trying again with a backing file`, ex);
            try {
                telemetryInfo.failedWithoutBackingFile = true;
                return await this.createSessionImpl({
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

    private async createSessionImpl(options: {
        token: CancellationToken;
        ui: IDisplayOptions;
        createBakingFile: boolean;
    }): Promise<ISessionWithSocket> {
        const remoteSessionOptions = getRemoteSessionOptions(this.connInfo, this.resource);
        let backingFile: IBackupFile | undefined;
        let sessionPath = remoteSessionOptions?.path;

        if (!sessionPath && options.createBakingFile) {
            // Create our backing file for the notebook
            backingFile = await this.backingFileCreator.createBackingFile(
                this.resource,
                this.workingDirectory,
                this.kernelConnectionMetadata,
                this.connInfo,
                this.contentsManager
            );
            sessionPath = backingFile?.filePath;
        }

        // Make sure the kernel has ipykernel installed if on a local machine.
        if (
            this.kernelConnectionMetadata?.interpreter &&
            isLocalConnection(this.kernelConnectionMetadata) &&
            this.kernelService
        ) {
            // Make sure the kernel actually exists and is up to date.
            try {
                await this.kernelService.ensureKernelIsUsable(
                    this.resource,
                    this.kernelConnectionMetadata,
                    options.ui,
                    options.token,
                    this.sessionCreator === '3rdPartyExtension'
                );
            } catch (ex) {
                // If we failed to create the kernel, we need to clean up the file.
                if (this.connInfo && backingFile) {
                    this.contentsManager.delete(backingFile.filePath).catch(noop);
                }
                throw ex;
            }
        }

        // If kernelName is empty this can cause problems for servers that don't
        // understand that empty kernel name means the default kernel.
        // See https://github.com/microsoft/vscode-jupyter/issues/5290
        const kernelName =
            getNameOfKernelConnection(this.kernelConnectionMetadata) ?? this.specsManager?.specs?.default ?? '';

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
        const work = () =>
            this.sessionManager!.startNew(sessionOptions, {
                kernelConnectionOptions: {
                    handleComms: true // This has to be true for ipywidgets to work
                }
            })
                .then(async (session) => {
                    if (session.kernel) {
                        this.logRemoteOutput(
                            DataScience.createdNewKernel(this.connInfo.baseUrl, session?.kernel?.id || '')
                        );
                        const sessionWithSocket = session as ISessionWithSocket;

                        // Add on the kernel metadata & sock information
                        sessionWithSocket.resource = this.resource;
                        sessionWithSocket.kernelConnectionMetadata = this.kernelConnectionMetadata;
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
                        if (!isLocalConnection(this.kernelConnectionMetadata)) {
                            sessionWithSocket.isRemoteSession = true;
                        }
                        return sessionWithSocket;
                    }
                    throw new JupyterSessionStartError(new Error(`No kernel created`));
                })
                .catch((ex) => Promise.reject(new JupyterSessionStartError(ex)))
                .finally(async () => {
                    if (this.connInfo && backingFile) {
                        this.contentsManager.delete(backingFile.filePath).catch(noop);
                    }
                });
        return raceCancellationError(options.token, work());
    }

    private logRemoteOutput(output: string) {
        if (!isLocalConnection(this.kernelConnectionMetadata)) {
            this.outputChannel.appendLine(output);
        }
    }

    protected async shutdownSession(
        session: ISessionWithSocket | undefined,
        statusHandler: Slot<ISessionWithSocket, KernelMessage.Status> | undefined,
        isRequestToShutDownRestartSession: boolean | undefined,
        shutdownEvenIfRemote?: boolean
    ): Promise<void> {
        if (session && session.kernel) {
            const kernelIdForLogging = `${session.kernel.id}, ${session.kernelConnectionMetadata?.id}`;
            traceVerbose(`shutdownSession ${kernelIdForLogging} - start`);
            try {
                if (statusHandler) {
                    session.statusChanged.disconnect(statusHandler);
                }
                if (!this.canShutdownSession(session, isRequestToShutDownRestartSession, shutdownEvenIfRemote)) {
                    traceVerbose(`Session cannot be shutdown ${session.kernelConnectionMetadata?.id}`);
                    session.dispose();
                    return;
                }
                try {
                    traceVerbose(`Session can be shutdown ${session.kernelConnectionMetadata?.id}`);
                    suppressShutdownErrors(session.kernel);
                    // Shutdown may fail if the process has been killed
                    if (!session.isDisposed) {
                        await raceTimeout(1000, session.shutdown());
                    }
                } catch {
                    noop();
                }
                // If session.shutdown didn't work, just dispose
                if (session && !session.isDisposed) {
                    session.dispose();
                }
            } catch (e) {
                // Ignore, just trace.
                traceWarning(e);
            }
            traceVerbose(`shutdownSession ${kernelIdForLogging} - shutdown complete`);
        }
    }
    private async shutdownImplementation(shutdownEvenIfRemote?: boolean) {
        this._isDisposed = true;
        if (this.session) {
            try {
                traceVerbose(`Shutdown session - current session, called from ${new Error('').stack}`);
                await this.shutdownSession(this.session, this.statusHandler, false, shutdownEvenIfRemote);
                traceVerbose('Shutdown session - get restart session');
                if (this.restartSessionPromise) {
                    this.restartSessionPromise.token.cancel();
                    const restartSession = await this.restartSessionPromise.promise;
                    this.restartSessionPromise.token.dispose();
                    traceVerbose('Shutdown session - shutdown restart session');
                    await this.shutdownSession(restartSession, undefined, true);
                }
            } catch {
                noop();
            }
            this.setSession(undefined);
            this.restartSessionPromise = undefined;
            this.onStatusChangedEvent.fire('dead');
            this._disposed.fire();
            this.didShutdown.fire();
            this.didShutdown.dispose();
            this._disposed.dispose();
            this.onStatusChangedEvent.dispose();
            this.previousAnyMessageHandler?.dispose();
        }
        disposeAllDisposables(this.disposables);
        traceVerbose('Shutdown session -- complete');
    }
    private canShutdownSession(
        session: ISessionWithSocket,
        isRequestToShutDownRestartSession: boolean | undefined,
        shutdownEvenIfRemote?: boolean
    ): boolean {
        // We can never shut down existing (live) kernels.
        if (session.kernelConnectionMetadata?.kind === 'connectToLiveRemoteKernel' && !shutdownEvenIfRemote) {
            return false;
        }
        // We can always shutdown restart sessions.
        if (isRequestToShutDownRestartSession) {
            return true;
        }
        // If this Interactive Window, then always shutdown sessions (even with remote Jupyter).
        if (session.resource && getResourceType(session.resource) === 'interactive') {
            return true;
        }
        // If we're in notebooks and using Remote Jupyter connections, then never shutdown the sessions.
        if (
            session.resource &&
            getResourceType(session.resource) === 'notebook' &&
            session.isRemoteSession === true &&
            !shutdownEvenIfRemote
        ) {
            return false;
        }

        return true;
    }
    private getServerStatus(): KernelMessage.Status {
        if (this.disposed) {
            return 'dead';
        }
        if (this.session?.kernel) {
            return this.session.kernel.status;
        }
        traceInfoIfCI(
            `Kernel status not started because real session is ${
                this.session ? 'defined' : 'undefined'
            } & real kernel is ${this.session?.kernel ? 'defined' : 'undefined'}`
        );
        return 'unknown';
    }

    private onKernelConnectionStatusHandler(_: unknown, kernelConnection: Kernel.ConnectionStatus) {
        traceInfoIfCI(`Server Kernel Status = ${kernelConnection}`);
        if (kernelConnection === 'disconnected') {
            const status = this.getServerStatus();
            this.onStatusChangedEvent.fire(status);
        }
    }
    private onStatusChanged(_s: Session.ISessionConnection) {
        const status = this.getServerStatus();
        traceInfoIfCI(`Server Status = ${status}`);
        this.onStatusChangedEvent.fire(status);
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
