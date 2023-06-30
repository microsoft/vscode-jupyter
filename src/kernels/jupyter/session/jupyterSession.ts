// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Kernel, KernelMessage, Session } from '@jupyterlab/services';
import type { Slot } from '@lumino/signaling';
import { Observable } from 'rxjs/Observable';
import { ReplaySubject } from 'rxjs/ReplaySubject';
import { WrappedError } from '../../../platform/errors/types';
import { traceVerbose, traceError, traceWarning, traceInfo, traceInfoIfCI } from '../../../platform/logging';
import { Resource, ReadWrite, IDisposable } from '../../../platform/common/types';
import { createDeferred, raceTimeout } from '../../../platform/common/utils/async';
import { DataScience } from '../../../platform/common/utils/localize';
import { JupyterInvalidKernelError } from '../../errors/jupyterInvalidKernelError';
import { sendTelemetryEvent, Telemetry } from '../../../telemetry';
import { suppressShutdownErrors } from '../../common/shutdownHelper';
import {
    KernelConnectionMetadata,
    IJupyterConnection,
    ISessionWithSocket,
    IJupyterKernelSession,
    IBaseKernelSession,
    KernelSocketInformation,
    isRemoteConnection
} from '../../types';
import { IJupyterRequestCreator } from '../types';
import {
    CancellationToken,
    CancellationTokenSource,
    CancellationError,
    Disposable,
    Event,
    EventEmitter,
    Uri
} from 'vscode';
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
    private readonly disposables: IDisposable[] = [];
    public get disposed() {
        return this._isDisposed === true;
    }
    public get onDidDispose() {
        return this._disposed.event;
    }
    public get onDidShutdown() {
        return this.didShutdown.event;
    }
    public get kernelId(): string {
        return this.session?.kernel?.id || '';
    }
    public get kernel(): Kernel.IKernelConnection | undefined {
        if (this._wrappedKernel) {
            return this._wrappedKernel;
        }
        if (!this.session?.kernel) {
            return;
        }
        this._wrappedKernel = new KernelConnectionWrapper(this.session.kernel, this.disposables);
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

    private onStatusChangedEvent = new EventEmitter<KernelMessage.Status>();
    private statusHandler: Slot<ISessionWithSocket, KernelMessage.Status>;
    private connected: boolean = false;
    private restartSessionPromise?: { token: CancellationTokenSource; promise: Promise<ISessionWithSocket> };
    private _kernelSocket = new ReplaySubject<KernelSocketInformation | undefined>();
    private unhandledMessageHandler: Slot<ISessionWithSocket, KernelMessage.IMessage>;
    private previousAnyMessageHandler?: IDisposable;
    constructor(
        private readonly session: ISessionWithSocket,
        private readonly resource: Resource,
        private readonly kernelConnectionMetadata: KernelConnectionMetadata,
        public readonly workingDirectory: Uri,
        private readonly requestCreator: IJupyterRequestCreator,
        connection: IJupyterConnection
    ) {
        this.kind = connection.localLaunch ? 'localJupyter' : 'remoteJupyter';
        this.statusHandler = this.onStatusChanged.bind(this);
        this.unhandledMessageHandler = (_s, m) => {
            traceWarning(`Unhandled message found: ${m.header.msg_type}`);
        };
        this.session.statusChanged.connect(this.statusHandler); // NOSONAR
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
        await this.session.kernel?.restart();
        this.setSession(this.session, true);
        traceInfo(`Restarted ${this.session?.kernel?.id}`);
    }
    private async waitForIdleOnSession(
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

    private setSession(session: ISessionWithSocket | undefined, forceUpdateKernelSocketInfo?: boolean) {
        // When we restart a remote session, the socket information is different, hence reset it.
        const socket = this.requestCreator.getWebsocket(this.kernelConnectionMetadata.id);
        if (session?.kernelSocketInformation?.socket && forceUpdateKernelSocketInfo && socket) {
            (session.kernelSocketInformation as ReadWrite<typeof session.kernelSocketInformation>).socket = socket;
        }
        const oldSession = this.session;
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

    private async shutdownSession(
        session: ISessionWithSocket | undefined,
        statusHandler: Slot<ISessionWithSocket, KernelMessage.Status> | undefined,
        isRequestToShutDownRestartSession: boolean | undefined,
        shutdownEvenIfRemote?: boolean
    ): Promise<void> {
        if (session && session.kernel) {
            const kernelIdForLogging = `${session.kernel.id}, ${this.kernelConnectionMetadata.id}`;
            traceVerbose(`shutdownSession ${kernelIdForLogging} - start`);
            try {
                if (statusHandler) {
                    session.statusChanged.disconnect(statusHandler);
                }
                if (!this.canShutdownSession(isRequestToShutDownRestartSession, shutdownEvenIfRemote)) {
                    traceVerbose(`Session cannot be shutdown ${this.kernelConnectionMetadata.id}`);
                    session.dispose();
                    return;
                }
                try {
                    traceVerbose(`Session can be shutdown ${this.kernelConnectionMetadata.id}`);
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
        isRequestToShutDownRestartSession: boolean | undefined,
        shutdownEvenIfRemote?: boolean
    ): boolean {
        // We can never shut down existing (live) kernels.
        if (this.kernelConnectionMetadata.kind === 'connectToLiveRemoteKernel' && !shutdownEvenIfRemote) {
            return false;
        }
        // We can always shutdown restart sessions.
        if (isRequestToShutDownRestartSession) {
            return true;
        }
        // If this Interactive Window, then always shutdown sessions (even with remote Jupyter).
        if (this.resource && getResourceType(this.resource) === 'interactive') {
            return true;
        }
        // If we're in notebooks and using Remote Jupyter connections, then never shutdown the sessions.
        if (
            this.resource &&
            getResourceType(this.resource) === 'notebook' &&
            isRemoteConnection(this.kernelConnectionMetadata) &&
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

export async function waitForIdleOnSession(
    session: ISessionWithSocket,
    timeout: number,
    resource: Resource,
    kernelConnectionMetadata: KernelConnectionMetadata,
    token?: CancellationToken,
    isRestartSession?: boolean
): Promise<void> {
    if (session && session.kernel) {
        const progress = isRestartSession
            ? undefined
            : KernelProgressReporter.reportProgress(resource, DataScience.waitingForJupyterSessionToBeIdle);
        const disposables: IDisposable[] = [];
        if (progress) {
            disposables.push(progress);
        }
        try {
            traceVerbose(`Waiting for ${timeout}ms idle on (kernel): ${session.kernel.id} -> ${session.kernel.status}`);

            // When our kernel connects and gets a status message it triggers the ready promise
            const kernelStatus = createDeferred<string>();
            if (token) {
                disposables.push(token.onCancellationRequested(() => kernelStatus.reject(new CancellationError())));
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
                throw new JupyterInvalidKernelError(kernelConnectionMetadata);
            }

            traceVerbose(`Finished waiting for idle on (kernel): ${session.kernel.id} -> ${session.kernel.status}`);

            if (result == 'idle') {
                return;
            }
            traceError(
                `Shutting down after failing to wait for idle on (kernel): ${session.kernel.id} -> ${session.kernel.status}`
            );
            throw new JupyterWaitForIdleError(kernelConnectionMetadata);
        } catch (ex) {
            traceInfoIfCI(`Error waiting for idle`, ex);
            throw ex;
        } finally {
            disposeAllDisposables(disposables);
        }
    } else {
        throw new JupyterInvalidKernelError(kernelConnectionMetadata);
    }
}
