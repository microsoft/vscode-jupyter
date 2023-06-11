// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Kernel, KernelMessage, Session } from '@jupyterlab/services';
import type { Slot } from '@lumino/signaling';
import { CancellationError, Disposable, EventEmitter, Uri } from 'vscode';
import { CancellationToken } from 'vscode-jsonrpc';
import { Cancellation, isCancellationError } from '../../../platform/common/cancellation';
import { traceError, traceInfoIfCI, traceVerbose, traceWarning } from '../../../platform/logging';
import { IDisplayOptions, IDisposable, Resource } from '../../../platform/common/types';
import { trackKernelResourceInformation } from '../../telemetry/helper';
import {
    IBaseKernelSession,
    IRawKernelSession,
    ISessionWithSocket,
    KernelConnectionMetadata,
    KernelSocketInformation,
    isLocalConnection
} from '../../../kernels/types';
import { IKernelLauncher } from '../types';
import { RawSession } from './rawSession.node';
import { KernelConnectionWrapper } from './../../common/kernelConnectionWrapper';
import { Observable } from 'rxjs/Observable';
import { ReplaySubject } from 'rxjs/ReplaySubject';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { suppressShutdownErrors } from '../../common/baseJupyterSession';
import { KernelProgressReporter } from '../../../platform/progress/kernelProgressReporter';
import { DataScience } from '../../../platform/common/utils/localize';
import { createDeferred, raceTimeout } from '../../../platform/common/utils/async';
import { noop, swallowExceptions } from '../../../platform/common/utils/misc';
import { JupyterInvalidKernelError } from '../../errors/jupyterInvalidKernelError';
import { JupyterWaitForIdleError } from '../../errors/jupyterWaitForIdleError';

/*
RawJupyterSession is the implementation of IJupyterKernelConnectionSession that instead of
connecting to JupyterLab services it instead connects to a kernel directly
through ZMQ.
It's responsible for translating our IJupyterKernelConnectionSession interface into the
jupyterlabs interface as well as starting up and connecting to a raw session
*/
export class RawJupyterSession implements IRawKernelSession, IBaseKernelSession<'localRaw'> {
    public readonly session: RawSession;
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
    public readonly onDidDispose = this._disposed.event;
    public readonly onDidShutdown = this.didShutdown.event;

    protected statusHandler: Slot<ISessionWithSocket, KernelMessage.Status>;
    private unhandledMessageHandler: Slot<ISessionWithSocket, KernelMessage.IMessage>;
    private previousAnyMessageHandler?: IDisposable;
    private _kernelSocket = new ReplaySubject<KernelSocketInformation | undefined>();
    public readonly kernelSocket: Observable<KernelSocketInformation | undefined> = this._kernelSocket;
    protected onStatusChangedEvent = new EventEmitter<KernelMessage.Status>();
    public readonly onSessionStatusChanged = this.onStatusChangedEvent.event;
    public readonly kind: 'localRaw';
    protected connected: boolean = false;
    public get isConnected(): boolean {
        return this.connected;
    }

    public get kernelId(): string {
        return this.session.kernel?.id || '';
    }
    public get kernel(): Kernel.IKernelConnection | undefined {
        if (this._wrappedKernel) {
            return this._wrappedKernel;
        }
        if (!this.session.kernel) {
            return;
        }
        this._wrappedKernel = new KernelConnectionWrapper(this.session.kernel, this.disposables);
        return this._wrappedKernel;
    }
    private terminatingStatus?: KernelMessage.Status;
    public get atleastOneCellExecutedSuccessfully() {
        return this.session.atleastOneCellExecutedSuccessfully;
    }
    public get status(): KernelMessage.Status {
        if (this.terminatingStatus && !this.disposed) {
            return this.terminatingStatus;
        }
        if (this.disposed) {
            return 'dead';
        }
        if (this.session.kernel) {
            return this.session.kernel.status;
        }
        traceInfoIfCI(`Real kernel is ${this.session.kernel ? 'defined' : 'undefined'}`);
        return 'unknown';
    }

    constructor(
        private readonly kernelLauncher: IKernelLauncher,
        private readonly resource: Resource,
        public workingDirectory: Uri,
        private readonly kernelConnectionMetadata: KernelConnectionMetadata,
        private readonly launchTimeout: number,
        type: 'notebook' | 'console'
    ) {
        this.statusHandler = this.onStatusChanged.bind(this);
        this.unhandledMessageHandler = (_s, m) => {
            traceWarning(`Unhandled message found: ${m.header.msg_type}`);
        };

        if (!isLocalConnection(kernelConnectionMetadata)) {
            throw new Error(`Invalid KernelConnectionMetadata for RawJupyterSession, ${kernelConnectionMetadata.kind}`);
        }
        this.session = new RawSession(
            this.resource,
            this.kernelLauncher,
            this.workingDirectory,
            kernelConnectionMetadata,
            this.launchTimeout,
            type
        );
        // Listen for session status changes
        this.session.statusChanged.connect(this.statusHandler);
        this.session.unhandledMessage.connect(this.unhandledMessageHandler);
    }

    // Connect to the given kernelspec, which should already have ipykernel installed into its interpreter
    public async start(options: { token: CancellationToken; ui: IDisplayOptions }): Promise<void> {
        await trackKernelResourceInformation(this.resource, { kernelConnection: this.kernelConnectionMetadata });
        try {
            // Try to start up our raw session, allow for cancellation or timeout
            // Notebook Provider level will handle the thrown error
            this.terminatingStatus = undefined;
            await this.session.startKernel(options);
            Cancellation.throwIfCanceled(options.token);
            this.setupSessionAndKernel();
        } catch (error) {
            this.connected = false;
            if (isCancellationError(error) || options.token.isCancellationRequested) {
                traceVerbose('Starting of raw session cancelled by user');
                throw error;
            } else {
                traceError(`Failed to connect raw kernel session: ${error}`);
                throw error;
            }
        }

        this.connected = true;
    }
    public async dispose(): Promise<void> {
        await this.shutdown();
    }
    public async waitForIdle(timeout: number, token: CancellationToken): Promise<void> {
        if (this.session) {
            return this.waitForIdleOnSession(this.session, timeout, token);
        }
    }

    public async shutdown(): Promise<void> {
        this._isDisposed = true;
        if (this.session) {
            try {
                traceVerbose(`Shutdown session - current session, called from ${new Error('').stack}`);
                await this.shutdownSession(this.session, this.statusHandler);
                traceVerbose('Shutdown session - get restart session');
            } catch {
                noop();
            }
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

    public async restart(): Promise<void> {
        await this.session.kernel?.restart();
        this.setupSessionAndKernel();
    }

    protected async waitForIdleOnSession(
        session: ISessionWithSocket | undefined,
        timeout: number,
        token?: CancellationToken
    ): Promise<void> {
        if (session && session.kernel) {
            const progress = KernelProgressReporter.reportProgress(
                this.resource,
                DataScience.waitingForJupyterSessionToBeIdle
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
                this.shutdownSession(session, this.statusHandler).catch(noop);
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
    protected setupSessionAndKernel(forceUpdateKernelSocketInfo: boolean = false) {
        if (this.session.kernel && this._wrappedKernel) {
            this._wrappedKernel.changeKernel(this.session.kernel);
        }

        // Listen for session status changes
        this.session.kernel?.connectionStatusChanged.connect(this.onKernelConnectionStatusHandler, this);
        if (this.session.kernelSocketInformation.socket?.onAnyMessage) {
            // These messages are sent directly to the kernel bypassing the Jupyter lab npm libraries.
            // As a result, we don't get any notification that messages were sent (on the anymessage signal).
            // To ensure those signals can still be used to monitor such messages, send them via a callback so that we can emit these messages on the anymessage signal.
            this.previousAnyMessageHandler = this.session.kernelSocketInformation.socket?.onAnyMessage((msg) => {
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
        // If we have a new session, then emit the new kernel connection information.
        if (forceUpdateKernelSocketInfo && this.session.kernel) {
            this._kernelSocket.next({
                options: {
                    clientId: this.session.kernel.clientId,
                    id: this.session.kernel.id,
                    model: { ...this.session.kernel.model },
                    userName: this.session.kernel.username
                },
                socket: this.session.kernelSocketInformation.socket
            });
        }
    }
    protected async shutdownSession(
        session: ISessionWithSocket | undefined,
        statusHandler: Slot<ISessionWithSocket, KernelMessage.Status> | undefined
    ): Promise<void> {
        if (session && session.kernel) {
            const kernelIdForLogging = `${session.kernel.id}, ${this.kernelConnectionMetadata?.id}`;
            traceVerbose(`shutdownSession ${kernelIdForLogging} - start`);
            try {
                if (statusHandler) {
                    session.statusChanged.disconnect(statusHandler);
                }
                try {
                    traceVerbose(`Session can be shutdown ${this.kernelConnectionMetadata?.id}`);
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
    private onKernelConnectionStatusHandler(_: unknown, kernelConnection: Kernel.ConnectionStatus) {
        traceInfoIfCI(`Server Kernel Status = ${kernelConnection}`);
        if (kernelConnection === 'disconnected') {
            this.onStatusChangedEvent.fire(this.status);
        }
    }
    private onStatusChanged(_s: Session.ISessionConnection) {
        const status = this.status;
        traceInfoIfCI(`Server Status = ${status}`);
        this.onStatusChangedEvent.fire(status);
    }
}
