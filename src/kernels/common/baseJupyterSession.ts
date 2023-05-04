// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Kernel, KernelMessage, Session } from '@jupyterlab/services';
import type { JSONObject } from '@lumino/coreutils';
import type { Slot } from '@lumino/signaling';
import { Observable } from 'rxjs/Observable';
import { ReplaySubject } from 'rxjs/ReplaySubject';
import {
    CancellationError,
    CancellationToken,
    CancellationTokenSource,
    Disposable,
    Event,
    EventEmitter,
    Uri
} from 'vscode';
import { WrappedError } from '../../platform/errors/types';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { traceInfo, traceVerbose, traceError, traceWarning, traceInfoIfCI } from '../../platform/logging';
import { IDisposable, Resource } from '../../platform/common/types';
import { createDeferred, sleep, waitForPromise } from '../../platform/common/utils/async';
import * as localize from '../../platform/common/utils/localize';
import { noop, swallowExceptions } from '../../platform/common/utils/misc';
import { sendTelemetryEvent, Telemetry } from '../../telemetry';
import { JupyterInvalidKernelError } from '../errors/jupyterInvalidKernelError';
import { JupyterWaitForIdleError } from '../errors/jupyterWaitForIdleError';
import { KernelInterruptTimeoutError } from '../errors/kernelInterruptTimeoutError';
import { SessionDisposedError } from '../../platform/errors/sessionDisposedError';
import {
    IJupyterKernelConnectionSession,
    ISessionWithSocket,
    KernelConnectionMetadata,
    KernelSocketInformation,
    IBaseKernelConnectionSession
} from '../types';
import { ChainingExecuteRequester } from './chainingExecuteRequester';
import { getResourceType } from '../../platform/common/utils';
import { KernelProgressReporter } from '../../platform/progress/kernelProgressReporter';
import { isTestExecution } from '../../platform/common/constants';
import { KernelConnectionWrapper } from './kernelConnectionWrapper';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function suppressShutdownErrors(realKernel: any) {
    // When running under a test, mark all futures as done so we
    // don't hit this problem:
    // https://github.com/jupyterlab/jupyterlab/issues/4252
    /* eslint-disable @typescript-eslint/no-explicit-any */
    if (isTestExecution()) {
        const defaultKernel = realKernel as any; // NOSONAR
        if (defaultKernel && defaultKernel._futures) {
            const futures = defaultKernel._futures as Map<any, any>; // NOSONAR
            if (futures.forEach) {
                // Requires for unit tests when things are mocked.
                futures.forEach((f) => {
                    if (f._status !== undefined) {
                        f._status |= 4;
                    }
                });
            }
        }
        if (defaultKernel && defaultKernel._reconnectLimit) {
            defaultKernel._reconnectLimit = 0;
        }
    }
}

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

/**
 * Common code for a Jupyterlabs IKernelConnection. Raw and Jupyter both inherit from this.
 */
export abstract class BaseJupyterSession implements IBaseKernelConnectionSession {
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
    private chainingExecute = new ChainingExecuteRequester();
    private previousAnyMessageHandler?: IDisposable;

    constructor(
        protected resource: Resource,
        protected readonly kernelConnectionMetadata: KernelConnectionMetadata,
        public workingDirectory: Uri,
        private readonly interruptTimeout: number
    ) {
        this.statusHandler = this.onStatusChanged.bind(this);
        this.unhandledMessageHandler = (_s, m) => {
            traceWarning(`Unhandled message found: ${m.header.msg_type}`);
        };
    }
    public isServerSession(): this is IJupyterKernelConnectionSession {
        return false;
    }
    public async dispose(): Promise<void> {
        await this.shutdownImplementation(false);
    }
    // Abstracts for each Session type to implement
    public abstract waitForIdle(timeout: number, token: CancellationToken): Promise<void>;

    public async shutdown(): Promise<void> {
        await this.shutdownImplementation(true);
    }
    public async interrupt(): Promise<void> {
        if (this.session && this.session.kernel) {
            traceInfo(`Interrupting kernel: ${this.session.kernel.name}`);

            await Promise.race([
                this.session.kernel.interrupt(),
                sleep(this.interruptTimeout).then(() => {
                    throw new KernelInterruptTimeoutError(this.kernelConnectionMetadata);
                })
            ]);
        }
    }
    public async requestKernelInfo(): Promise<KernelMessage.IInfoReplyMsg | undefined> {
        if (!this.session) {
            throw new Error('Cannot request KernelInfo, Session not initialized.');
        }
        if (this.session.kernel?.info) {
            const content = await this.session.kernel.info;
            const infoMsg: KernelMessage.IInfoReplyMsg = {
                content,
                channel: 'shell',
                metadata: {},
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                parent_header: {} as any,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                header: {} as any
            };
            return Promise.resolve(infoMsg);
        }
        return this.session.kernel?.requestKernelInfo();
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

    public requestExecute(
        content: KernelMessage.IExecuteRequestMsg['content'],
        disposeOnDone?: boolean,
        metadata?: JSONObject
    ): Kernel.IShellFuture<KernelMessage.IExecuteRequestMsg, KernelMessage.IExecuteReplyMsg> {
        if (!this.session?.kernel) {
            throw new SessionDisposedError();
        }
        // Make sure to chain the executes
        return this.chainingExecute.requestExecute(this.session.kernel, content, disposeOnDone, metadata);
    }

    public requestDebug(
        content: KernelMessage.IDebugRequestMsg['content'],
        disposeOnDone?: boolean
    ): Kernel.IControlFuture<KernelMessage.IDebugRequestMsg, KernelMessage.IDebugReplyMsg> {
        if (!this.session?.kernel) {
            throw new SessionDisposedError();
        }
        return this.session.kernel.requestDebug(content, disposeOnDone);
    }

    public requestInspect(
        content: KernelMessage.IInspectRequestMsg['content']
    ): Promise<KernelMessage.IInspectReplyMsg> {
        if (!this.session?.kernel) {
            throw new SessionDisposedError();
        }
        return this.session.kernel.requestInspect(content);
    }

    public requestComplete(
        content: KernelMessage.ICompleteRequestMsg['content']
    ): Promise<KernelMessage.ICompleteReplyMsg> {
        if (!this.session?.kernel) {
            throw new SessionDisposedError();
        }
        return this.session.kernel.requestComplete(content);
    }

    public sendInputReply(content: KernelMessage.IInputReply) {
        if (this.session && this.session.kernel) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.session.kernel.sendInputReply(content);
        }
    }

    public registerCommTarget(
        targetName: string,
        callback: (comm: Kernel.IComm, msg: KernelMessage.ICommOpenMsg) => void | PromiseLike<void>
    ) {
        if (this.session && this.session.kernel) {
            this.session.kernel.registerCommTarget(targetName, callback);
        } else {
            throw new SessionDisposedError();
        }
    }

    public registerMessageHook(
        msgId: string,
        hook: (msg: KernelMessage.IIOPubMessage) => boolean | PromiseLike<boolean>
    ): void {
        if (this.session?.kernel) {
            return this.session.kernel.registerMessageHook(msgId, hook);
        } else {
            throw new SessionDisposedError();
        }
    }
    public removeMessageHook(
        msgId: string,
        hook: (msg: KernelMessage.IIOPubMessage) => boolean | PromiseLike<boolean>
    ): void {
        if (this.session?.kernel) {
            return this.session.kernel.removeMessageHook(msgId, hook);
        } else {
            throw new SessionDisposedError();
        }
    }

    // Sub classes need to implement their own restarting specific code
    protected abstract startRestartSession(disableUI: boolean): Promise<ISessionWithSocket>;

    protected async waitForIdleOnSession(
        session: ISessionWithSocket | undefined,
        timeout: number,
        token?: CancellationToken,
        isRestartSession?: boolean
    ): Promise<void> {
        if (session && session.kernel) {
            const progress = isRestartSession
                ? undefined
                : KernelProgressReporter.reportProgress(
                      this.resource,
                      localize.DataScience.waitingForJupyterSessionToBeIdle
                  );
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
                const sessionDisposed = createDeferred<unknown>();
                session.disposed.connect(sessionDisposed.resolve, sessionDisposed);
                disposables.push(
                    new Disposable(() =>
                        swallowExceptions(() => session.disposed.disconnect(sessionDisposed.resolve, sessionDisposed))
                    )
                );
                const sleepPromise = sleep(timeout);
                sessionDisposed.promise.catch(noop);
                sleepPromise.catch(noop);
                kernelStatus.promise.catch(noop);
                const result = await Promise.race([kernelStatus.promise, sleepPromise, sessionDisposed.promise]);
                if (session.isDisposed) {
                    traceError('Session disposed while waiting for session to be idle.');
                    throw new JupyterInvalidKernelError(this.kernelConnectionMetadata);
                }

                traceVerbose(`Finished waiting for idle on (kernel): ${session.kernel.id} -> ${session.kernel.status}`);

                if (typeof result === 'string' && result.toString() == 'idle') {
                    return;
                }
                traceError(
                    `Shutting down after failing to wait for idle on (kernel): ${session.kernel.id} -> ${session.kernel.status}`
                );
                // If we throw an exception, make sure to shutdown the session as it's not usable anymore
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

    // Changes the current session.
    protected setSession(session: ISessionWithSocket | undefined, forceUpdateKernelSocketInfo: boolean = false) {
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
                        await waitForPromise(session.shutdown(), 1000);
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
