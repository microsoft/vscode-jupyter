// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import type { Kernel, KernelMessage, Session } from '@jupyterlab/services';
import type { JSONObject } from '@lumino/coreutils';
import type { Slot } from '@lumino/signaling';
import { Observable } from 'rxjs/Observable';
import { ReplaySubject } from 'rxjs/ReplaySubject';
import { Event, EventEmitter } from 'vscode';
import { WrappedError } from '../common/errors/types';
import { disposeAllDisposables } from '../common/helpers';
import { traceInfo, traceInfoIfCI, traceWarning } from '../common/logger';
import { IDisposable, Resource } from '../common/types';
import { createDeferred, sleep, waitForPromise } from '../common/utils/async';
import * as localize from '../common/utils/localize';
import { noop } from '../common/utils/misc';
import { sendTelemetryEvent } from '../telemetry';
import { getResourceType } from './common';
import { Telemetry } from './constants';
import { JupyterInvalidKernelError } from './errors/jupyterInvalidKernelError';
import { JupyterWaitForIdleError } from './errors/jupyterWaitForIdleError';
import { KernelConnectionMetadata } from './jupyter/kernels/types';
import { suppressShutdownErrors } from './raw-kernel/rawKernel';
import { IJupyterSession, ISessionWithSocket, KernelSocketInformation } from './types';
import { KernelInterruptTimeoutError } from './errors/kernelInterruptTimeoutError';
import { SessionDisposedError } from './errors/sessionDisposedError';

/**
 * Exception raised when starting a Jupyter Session fails.
 *
 * @export
 * @class JupyterSessionStartError
 * @extends {Error}
 */
export class JupyterSessionStartError extends WrappedError {
    constructor(originalException: Error) {
        super(originalException.message, originalException);
        sendTelemetryEvent(Telemetry.StartSessionFailedJupyter, undefined, undefined, originalException, true);
    }
}

export abstract class BaseJupyterSession implements IJupyterSession {
    private _isDisposed?: boolean;
    private readonly _disposed = new EventEmitter<void>();
    protected readonly disposables: IDisposable[] = [];
    public get disposed() {
        return this._isDisposed === true;
    }
    public get onDidDispose() {
        return this._disposed.event;
    }
    protected get session(): ISessionWithSocket | undefined {
        return this._session;
    }
    public get kernelSocket(): Observable<KernelSocketInformation | undefined> {
        return this._kernelSocket;
    }
    public get onSessionStatusChanged(): Event<KernelMessage.Status> {
        return this.onStatusChangedEvent.event;
    }
    public get onIOPubMessage(): Event<KernelMessage.IIOPubMessage> {
        if (!this.ioPubEventEmitter) {
            this.ioPubEventEmitter = new EventEmitter<KernelMessage.IIOPubMessage>();
        }
        return this.ioPubEventEmitter.event;
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
    protected restartSessionPromise: Promise<ISessionWithSocket> | undefined;
    private _session: ISessionWithSocket | undefined;
    private _kernelSocket = new ReplaySubject<KernelSocketInformation | undefined>();
    private ioPubEventEmitter = new EventEmitter<KernelMessage.IIOPubMessage>();
    private ioPubHandler: Slot<ISessionWithSocket, KernelMessage.IIOPubMessage>;
    private unhandledMessageHandler: Slot<ISessionWithSocket, KernelMessage.IMessage>;

    constructor(
        protected resource: Resource,
        protected readonly kernelConnectionMetadata: KernelConnectionMetadata,
        private restartSessionUsed: (id: Kernel.IKernelConnection) => void,
        public workingDirectory: string,
        private readonly interruptTimeout: number
    ) {
        this.statusHandler = this.onStatusChanged.bind(this);
        this.ioPubHandler = (_s, m) => this.ioPubEventEmitter.fire(m);
        this.unhandledMessageHandler = (_s, m) => {
            traceInfo(`Unhandled message found: ${m.header.msg_type}`);
        };
    }
    public dispose(): Promise<void> {
        return this.shutdown();
    }
    // Abstracts for each Session type to implement
    public abstract waitForIdle(timeout: number): Promise<void>;

    public async shutdown(): Promise<void> {
        this._isDisposed = true;
        if (this.session) {
            try {
                traceInfo('Shutdown session - current session');
                await this.shutdownSession(this.session, this.statusHandler, false);
                traceInfo('Shutdown session - get restart session');
                if (this.restartSessionPromise) {
                    const restartSession = await this.restartSessionPromise;
                    traceInfo('Shutdown session - shutdown restart session');
                    await this.shutdownSession(restartSession, undefined, true);
                }
            } catch {
                noop();
            }
            this.setSession(undefined);
            this.restartSessionPromise = undefined;
            this.onStatusChangedEvent.fire('dead');
            this._disposed.fire();
            this._disposed.dispose();
            this.onStatusChangedEvent.dispose();
        }
        disposeAllDisposables(this.disposables);
        traceInfo('Shutdown session -- complete');
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
            return;
        }

        // Start the restart session now in case it wasn't started
        if (!this.restartSessionPromise) {
            this.startRestartSession();
        }

        // Just kill the current session and switch to the other
        if (this.restartSessionPromise) {
            traceInfo(`Restarting ${this.session?.kernel?.id}`);

            // Save old state for shutdown
            const oldSession = this.session;
            const oldStatusHandler = this.statusHandler;

            // TODO? Why aren't we killing this old session here now?
            // We should, If we're restarting and it fails, how is it ok to
            // keep the old session (user could be restarting for a number of reasons).

            // Just switch to the other session. It should already be ready
            const newSession = await this.restartSessionPromise;
            this.setSession(newSession);

            if (newSession.kernel) {
                this.restartSessionUsed(newSession.kernel);
                traceInfo(`Got new session ${newSession.kernel.id}`);

                // Rewire our status changed event.
                newSession.statusChanged.connect(this.statusHandler);
            }
            this.restartSessionPromise = undefined;
            traceInfo('Started new restart session');
            if (oldStatusHandler && oldSession) {
                oldSession.statusChanged.disconnect(oldStatusHandler);
            }
            this.shutdownSession(oldSession, undefined, false).ignoreErrors();
        } else {
            throw new SessionDisposedError();
        }
    }

    public requestExecute(
        content: KernelMessage.IExecuteRequestMsg['content'],
        disposeOnDone?: boolean,
        metadata?: JSONObject
    ): Kernel.IShellFuture<KernelMessage.IExecuteRequestMsg, KernelMessage.IExecuteReplyMsg> {
        if (!this.session?.kernel) {
            throw new SessionDisposedError();
        }
        return this.session.kernel.requestExecute(content, disposeOnDone, metadata);
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
    protected abstract startRestartSession(): void;

    protected async waitForIdleOnSession(
        session: ISessionWithSocket | undefined,
        timeout: number,
        isRestartSession?: boolean
    ): Promise<void> {
        if (session && session.kernel) {
            traceInfo(`Waiting for idle on (kernel): ${session.kernel.id} -> ${session.kernel.status}`);

            // When our kernel connects and gets a status message it triggers the ready promise
            const deferred = createDeferred<string>();
            const handler = (_session: Kernel.IKernelConnection, status: KernelMessage.Status) => {
                if (status == 'idle') {
                    deferred.resolve(status);
                }
            };
            session.kernel.statusChanged?.connect(handler);
            if (session.kernel.status == 'idle') {
                deferred.resolve(session.kernel.status);
            }

            const result = await Promise.race([deferred.promise, sleep(timeout)]);
            session.kernel.statusChanged?.disconnect(handler);
            traceInfo(`Finished waiting for idle on (kernel): ${session.kernel.id} -> ${session.kernel.status}`);

            if (result.toString() == 'idle') {
                return;
            }
            // If we throw an exception, make sure to shutdown the session as it's not usable anymore
            this.shutdownSession(session, this.statusHandler, isRestartSession).ignoreErrors();
            throw new JupyterWaitForIdleError(localize.DataScience.jupyterLaunchTimedOut());
        } else {
            throw new JupyterInvalidKernelError(undefined);
        }
    }

    // Changes the current session.
    protected setSession(session: ISessionWithSocket | undefined) {
        const oldSession = this._session;
        if (oldSession) {
            if (this.ioPubHandler) {
                oldSession.iopubMessage.disconnect(this.ioPubHandler);
            }
            if (this.unhandledMessageHandler) {
                oldSession.unhandledMessage.disconnect(this.unhandledMessageHandler);
            }
            if (this.statusHandler) {
                oldSession.statusChanged.disconnect(this.statusHandler);
            }
        }
        this._session = session;
        if (session) {
            // Listen for session status changes
            session.statusChanged.connect(this.statusHandler);

            if (session.iopubMessage) {
                session.iopubMessage.connect(this.ioPubHandler);
            }
            if (session.unhandledMessage) {
                session.unhandledMessage.connect(this.unhandledMessageHandler);
            }
            // If we have a new session, then emit the new kernel connection information.
            if (oldSession !== session && session.kernel) {
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
        isRequestToShutDownRestartSession: boolean | undefined
    ): Promise<void> {
        if (session && session.kernel) {
            const kernelIdForLogging = `${session.kernel.id}, ${session.kernelConnectionMetadata?.id}`;
            traceInfo(`shutdownSession ${kernelIdForLogging} - start`);
            try {
                if (statusHandler) {
                    session.statusChanged.disconnect(statusHandler);
                }
                if (!this.canShutdownSession(session, isRequestToShutDownRestartSession)) {
                    traceInfo(`Session cannot be shutdown ${session.kernelConnectionMetadata?.id}`);
                    session.dispose();
                    return;
                }
                try {
                    traceInfo(`Session can be shutdown ${session.kernelConnectionMetadata?.id}`);
                    suppressShutdownErrors(session.kernel);
                    // Shutdown may fail if the process has been killed
                    if (!session.isDisposed) {
                        await waitForPromise(session.shutdown(), 1000);
                    }
                } catch {
                    noop();
                }
                if (session && !session.isDisposed) {
                    session.dispose();
                }
            } catch (e) {
                // Ignore, just trace.
                traceWarning(e);
            }
            traceInfo(`shutdownSession ${kernelIdForLogging} - shutdown complete`);
        }
    }
    private canShutdownSession(session: ISessionWithSocket, isRequestToShutDownRestartSession: boolean | undefined) {
        // We can never shut down existing (live) kernels.
        if (session.kernelConnectionMetadata?.kind === 'connectToLiveKernel') {
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
        if (session.resource && getResourceType(session.resource) === 'notebook' && session.isRemoteSession === true) {
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

    private onStatusChanged(_s: Session.ISessionConnection) {
        const status = this.getServerStatus();
        traceInfoIfCI(`Server Status = ${status}`);
        this.onStatusChangedEvent.fire(status);
    }
}
