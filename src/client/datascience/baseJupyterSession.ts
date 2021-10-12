// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import type { Kernel, KernelMessage, Session } from '@jupyterlab/services';
import type { JSONObject } from '@lumino/coreutils';
import type { Slot } from '@lumino/signaling';
import { Observable } from 'rxjs/Observable';
import { ReplaySubject } from 'rxjs/ReplaySubject';
import { Event, EventEmitter } from 'vscode';
import { ServerStatus } from '../../datascience-ui/interactive-common/mainState';
import { WrappedError } from '../common/errors/types';
import { traceError, traceInfo, traceInfoIfCI, traceWarning } from '../common/logger';
import { Resource } from '../common/types';
import { createDeferred, sleep, waitForPromise } from '../common/utils/async';
import * as localize from '../common/utils/localize';
import { noop } from '../common/utils/misc';
import { sendTelemetryEvent } from '../telemetry';
import { getResourceType } from './common';
import { Telemetry } from './constants';
import { JupyterInvalidKernelError } from './jupyter/jupyterInvalidKernelError';
import { JupyterWaitForIdleError } from './jupyter/jupyterWaitForIdleError';
import { kernelConnectionMetadataHasKernelSpec } from './jupyter/kernels/helpers';
import { JupyterKernelPromiseFailedError } from './jupyter/kernels/jupyterKernelPromiseFailedError';
import { KernelConnectionMetadata } from './jupyter/kernels/types';
import { suppressShutdownErrors } from './raw-kernel/rawKernel';
import { trackKernelResourceInformation } from './telemetry/telemetry';
import { IJupyterSession, ISessionWithSocket, KernelSocketInformation } from './types';

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
    protected get session(): ISessionWithSocket | undefined {
        return this._session;
    }
    protected kernelConnectionMetadata?: KernelConnectionMetadata;
    public get kernelSocket(): Observable<KernelSocketInformation | undefined> {
        return this._kernelSocket;
    }
    public get onSessionStatusChanged(): Event<ServerStatus> {
        if (!this.onStatusChangedEvent) {
            this.onStatusChangedEvent = new EventEmitter<ServerStatus>();
        }
        return this.onStatusChangedEvent.event;
    }
    public get onIOPubMessage(): Event<KernelMessage.IIOPubMessage> {
        if (!this.ioPubEventEmitter) {
            this.ioPubEventEmitter = new EventEmitter<KernelMessage.IIOPubMessage>();
        }
        return this.ioPubEventEmitter.event;
    }

    public get status(): ServerStatus {
        return this.getServerStatus();
    }

    public get isConnected(): boolean {
        return this.connected;
    }

    protected onStatusChangedEvent: EventEmitter<ServerStatus> = new EventEmitter<ServerStatus>();
    protected statusHandler: Slot<ISessionWithSocket, Kernel.Status>;
    protected connected: boolean = false;
    protected restartSessionPromise: Promise<ISessionWithSocket | undefined> | undefined;
    private _session: ISessionWithSocket | undefined;
    private _kernelSocket = new ReplaySubject<KernelSocketInformation | undefined>();
    private ioPubEventEmitter = new EventEmitter<KernelMessage.IIOPubMessage>();
    private ioPubHandler: Slot<ISessionWithSocket, KernelMessage.IIOPubMessage>;
    private unhandledMessageHandler: Slot<ISessionWithSocket, KernelMessage.IMessage>;

    constructor(
        protected resource: Resource,
        private restartSessionUsed: (id: Kernel.IKernelConnection) => void,
        public workingDirectory: string
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
        }
        if (this.onStatusChangedEvent) {
            this.onStatusChangedEvent.dispose();
        }
        traceInfo('Shutdown session -- complete');
    }
    public async interrupt(timeout: number): Promise<void> {
        if (this.session && this.session.kernel) {
            traceInfo(`Interrupting kernel: ${this.session.kernel.name}`);
            // Listen for session status changes
            this.session.statusChanged.connect(this.statusHandler);

            await this.waitForKernelPromise(
                this.session.kernel.interrupt(),
                timeout,
                localize.DataScience.interruptingKernelFailed()
            );
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
    public async changeKernel(
        resource: Resource,
        kernelConnection: KernelConnectionMetadata,
        timeoutMS: number
    ): Promise<void> {
        this.resource = resource;
        let newSession: ISessionWithSocket | undefined;
        // If we are already using this kernel in an active session just return back
        const currentKernelSpec =
            this.kernelConnectionMetadata && kernelConnectionMetadataHasKernelSpec(this.kernelConnectionMetadata)
                ? this.kernelConnectionMetadata.kernelSpec
                : undefined;
        const kernelSpecToUse = kernelConnectionMetadataHasKernelSpec(kernelConnection)
            ? kernelConnection.kernelSpec
            : undefined;
        if (this.session && currentKernelSpec && kernelSpecToUse && this.kernelConnectionMetadata) {
            // If we have selected the same kernel connection, then nothing to do.
            if (this.kernelConnectionMetadata.id === kernelConnection.id) {
                traceInfoIfCI(`Kernels are the same, no switching necessary.`);
                return;
            }
        }
        trackKernelResourceInformation(resource, { kernelConnection });
        newSession = await this.createNewKernelSession(resource, kernelConnection, timeoutMS);

        // This is just like doing a restart, kill the old session (and the old restart session), and start new ones
        if (this.session) {
            this.shutdownSession(this.session, this.statusHandler, false).ignoreErrors();
            this.restartSessionPromise?.then((r) => this.shutdownSession(r, undefined, true)).ignoreErrors(); // NOSONAR
        }

        traceInfoIfCI(`Switched notebook kernel to ${kernelSpecToUse?.display_name}`);

        // Update our kernel connection metadata.
        this.kernelConnectionMetadata = kernelConnection;

        // Save the new session
        this.setSession(newSession);

        // Listen for session status changes
        this.session?.statusChanged.connect(this.statusHandler); // NOSONAR
    }

    public async restart(timeout: number): Promise<void> {
        if (this.session?.isRemoteSession && this.session.kernel) {
            await this.session.kernel.restart();
            return;
        }

        // Start the restart session now in case it wasn't started
        if (!this.restartSessionPromise) {
            this.startRestartSession(timeout);
        }

        // Just kill the current session and switch to the other
        if (this.restartSessionPromise) {
            traceInfo(`Restarting ${this.session?.kernel?.id}`);

            // Save old state for shutdown
            const oldSession = this.session;
            const oldStatusHandler = this.statusHandler;

            // Just switch to the other session. It should already be ready
            this.setSession(await this.restartSessionPromise);
            if (!this.session) {
                throw new Error(localize.DataScience.sessionDisposed());
            }

            if (this.session.kernel) {
                this.restartSessionUsed(this.session.kernel);
                traceInfo(`Got new session ${this.session.kernel.id}`);

                // Rewire our status changed event.
                this.session.statusChanged.connect(this.statusHandler);
            }
            this.restartSessionPromise = undefined;
            traceInfo('Started new restart session');
            if (oldStatusHandler && oldSession) {
                oldSession.statusChanged.disconnect(oldStatusHandler);
            }
            this.shutdownSession(oldSession, undefined, false).ignoreErrors();
        } else {
            throw new Error(localize.DataScience.sessionDisposed());
        }
    }

    public requestExecute(
        content: KernelMessage.IExecuteRequestMsg['content'],
        disposeOnDone?: boolean,
        metadata?: JSONObject
    ): Kernel.IShellFuture<KernelMessage.IExecuteRequestMsg, KernelMessage.IExecuteReplyMsg> {
        if (!this.session?.kernel) {
            throw new Error(localize.DataScience.sessionDisposed());
        }
        return this.session.kernel.requestExecute(content, disposeOnDone, metadata);
    }

    public requestDebug(
        content: KernelMessage.IDebugRequestMsg['content'],
        disposeOnDone?: boolean
    ): Kernel.IControlFuture<KernelMessage.IDebugRequestMsg, KernelMessage.IDebugReplyMsg> {
        if (!this.session?.kernel) {
            throw new Error(localize.DataScience.sessionDisposed());
        }
        return this.session.kernel.requestDebug(content, disposeOnDone);
    }

    public requestInspect(
        content: KernelMessage.IInspectRequestMsg['content']
    ): Promise<KernelMessage.IInspectReplyMsg> {
        if (!this.session?.kernel) {
            throw new Error(localize.DataScience.sessionDisposed());
        }
        return this.session.kernel.requestInspect(content);
    }

    public requestComplete(
        content: KernelMessage.ICompleteRequestMsg['content']
    ): Promise<KernelMessage.ICompleteReplyMsg> {
        if (!this.session?.kernel) {
            throw new Error(localize.DataScience.sessionDisposed());
        }
        return this.session.kernel.requestComplete(content);
    }

    public sendInputReply(content: string) {
        if (this.session && this.session.kernel) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.session.kernel.sendInputReply({ value: content, status: 'ok' });
        }
    }

    public registerCommTarget(
        targetName: string,
        callback: (comm: Kernel.IComm, msg: KernelMessage.ICommOpenMsg) => void | PromiseLike<void>
    ) {
        if (this.session && this.session.kernel) {
            this.session.kernel.registerCommTarget(targetName, callback);
        } else {
            throw new Error(localize.DataScience.sessionDisposed());
        }
    }

    public registerMessageHook(
        msgId: string,
        hook: (msg: KernelMessage.IIOPubMessage) => boolean | PromiseLike<boolean>
    ): void {
        if (this.session?.kernel) {
            return this.session.kernel.registerMessageHook(msgId, hook);
        } else {
            throw new Error(localize.DataScience.sessionDisposed());
        }
    }
    public removeMessageHook(
        msgId: string,
        hook: (msg: KernelMessage.IIOPubMessage) => boolean | PromiseLike<boolean>
    ): void {
        if (this.session?.kernel) {
            return this.session.kernel.removeMessageHook(msgId, hook);
        } else {
            throw new Error(localize.DataScience.sessionDisposed());
        }
    }

    // Sub classes need to implement their own restarting specific code
    protected abstract startRestartSession(timeout: number): void;
    // Sub classes need to implement their own kernel change specific code
    protected abstract createNewKernelSession(
        resource: Resource,
        kernelConnection: KernelConnectionMetadata,
        timeoutMS: number
    ): Promise<ISessionWithSocket>;

    protected async waitForIdleOnSession(
        session: ISessionWithSocket | undefined,
        timeout: number,
        isRestartSession?: boolean
    ): Promise<void> {
        if (session && session.kernel) {
            traceInfo(`Waiting for idle on (kernel): ${session.kernel.id} -> ${session.kernel.status}`);

            // When our kernel connects and gets a status message it triggers the ready promise
            const deferred = createDeferred<string>();
            const handler = (_session: Kernel.IKernelConnection, status: Kernel.Status) => {
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
        if (this.ioPubHandler && oldSession) {
            oldSession.iopubMessage.disconnect(this.ioPubHandler);
        }
        if (this.unhandledMessageHandler && oldSession) {
            oldSession.unhandledMessage.disconnect(this.unhandledMessageHandler);
        }
        this._session = session;
        if (session && session.iopubMessage) {
            session.iopubMessage.connect(this.ioPubHandler);
        }
        if (session && session.unhandledMessage) {
            session.unhandledMessage.connect(this.unhandledMessageHandler);
        }

        // If we have a new session, then emit the new kernel connection information.
        if (session && oldSession !== session && session.kernel) {
            if (!session.kernelSocketInformation) {
                traceError(`Unable to find WebSocket connection associated with kernel ${session.kernel.id}`);
                this._kernelSocket.next(undefined);
            } else {
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
        statusHandler: Slot<ISessionWithSocket, Kernel.Status> | undefined,
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
    private getServerStatus(): ServerStatus {
        if (this.session && this.session.kernel) {
            switch (this.session.kernel.status) {
                case 'busy':
                    return ServerStatus.Busy;
                case 'dead':
                case 'terminating':
                    return ServerStatus.Dead;
                case 'idle':
                    return ServerStatus.Idle;
                case 'restarting':
                case 'autorestarting':
                    return ServerStatus.Restarting;
                case 'starting':
                    return ServerStatus.Starting;
                default:
                    return ServerStatus.NotStarted;
            }
        }

        return ServerStatus.NotStarted;
    }

    private async waitForKernelPromise(
        kernelPromise: Promise<void>,
        timeout: number,
        errorMessage: string
    ): Promise<void | null> {
        // Wait for this kernel promise to happen
        try {
            await waitForPromise(kernelPromise, timeout);
        } catch (e) {
            // TODO: This will never get throw, `waitForPromise` never throws when there's a timeout,
            // TODO: Review usages of `JupyterKernelPromiseFailedError` it might never get thrown.
            if (!e) {
                // We timed out. Throw a specific exception
                throw new JupyterKernelPromiseFailedError(errorMessage);
            }
            throw e;
        }
    }

    private onStatusChanged(_s: Session.ISessionConnection) {
        if (this.onStatusChangedEvent) {
            this.onStatusChangedEvent.fire(this.getServerStatus());
        }
    }
}
