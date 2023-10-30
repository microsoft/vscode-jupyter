// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Kernel, KernelSpec, KernelMessage, ServerConnection } from '@jupyterlab/services';
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
import uuid from 'uuid/v4';
import { traceError, traceInfo, traceVerbose, traceWarning } from '../../../platform/logging';
import { IDisposable, Resource } from '../../../platform/common/types';
import { noop, swallowExceptions } from '../../../platform/common/utils/misc';
import {
    getDisplayNameOrNameOfKernelConnection,
    getNameOfKernelConnection,
    isUserRegisteredKernelSpecConnection
} from '../../../kernels/helpers';
import { IWebSocketLike } from '../../common/kernelSocketWrapper';
import { IKernelLauncher, IKernelProcess } from '../types';
import { RawSocket } from './rawSocket.node';
import { IKernelSocket, LocalKernelConnectionMetadata } from '../../types';
import { suppressShutdownErrors } from '../../common/baseJupyterSession';
import { Signal } from '@lumino/signaling';
import type { IIOPubMessage, IMessage, IOPubMessageType, MessageType } from '@jupyterlab/services/lib/kernel/messages';
import { CancellationError, CancellationToken, CancellationTokenSource, Uri } from 'vscode';
import { KernelProgressReporter } from '../../../platform/progress/kernelProgressReporter';
import { DataScience } from '../../../platform/common/utils/localize';
import { sendKernelTelemetryEvent } from '../../telemetry/sendKernelTelemetryEvent';
import { Telemetry } from '../../../telemetry';
import { getTelemetrySafeErrorMessageFromPythonTraceback } from '../../../platform/errors/errorUtils';
import { createDeferred, raceTimeout, sleep } from '../../../platform/common/utils/async';
import { KernelConnectionTimeoutError } from '../../errors/kernelConnectionTimeoutError';
import {
    isCancellationError,
    raceCancellationError,
    wrapCancellationTokens
} from '../../../platform/common/cancellation';
import { StopWatch } from '../../../platform/common/utils/stopWatch';
import { dispose } from '../../../platform/common/helpers';
import { KernelSocketMap } from '../../kernelSocket';

let nonSerializingKernel: typeof import('@jupyterlab/services/lib/kernel/default');

/*
RawKernel class represents the mapping from the JupyterLab services IKernel interface
to a raw IPython kernel running on the local machine. RawKernel is in charge of taking
input request, translating them, sending them to an IPython kernel over ZMQ, then passing back the messages
*/
export class RawKernelConnection implements Kernel.IKernelConnection {
    public readonly statusChanged = new Signal<this, Kernel.Status>(this);
    public readonly connectionStatusChanged = new Signal<this, Kernel.ConnectionStatus>(this);
    public readonly iopubMessage = new Signal<this, IIOPubMessage<IOPubMessageType>>(this);
    public readonly unhandledMessage = new Signal<this, IMessage<MessageType>>(this);
    public readonly anyMessage = new Signal<this, Kernel.IAnyMessageArgs>(this);
    public readonly disposed = new Signal<this, void>(this);
    public get connectionStatus() {
        return this.realKernel ? this.realKernel.connectionStatus : 'connecting';
    }
    public get serverSettings(): ServerConnection.ISettings {
        return this.realKernel!.serverSettings;
    }
    public readonly name: string;
    public readonly model: Kernel.IModel;
    public readonly id = uuid();
    public readonly clientId = uuid();
    public readonly username = uuid();
    private isRestarting?: boolean;
    private isShuttingDown?: boolean;
    private hasShutdown?: boolean;
    public get status(): KernelMessage.Status {
        if (this.isDisposed || this.hasShutdown) {
            return 'dead';
        }
        if (this.isRestarting) {
            return 'restarting';
        }
        if (this.isShuttingDown) {
            return 'terminating';
        }
        if (!this.realKernel) {
            return 'starting';
        }
        return this.realKernel.status;
    }
    private infoDeferred = createDeferred<KernelMessage.IInfoReply>();
    public get info() {
        return this.realKernel ? this.realKernel.info : this.infoDeferred.promise;
    }
    public get handleComms(): boolean {
        return this.realKernel!.handleComms;
    }
    private isDisposing?: boolean;
    private _isDisposed?: boolean;
    public get isDisposed(): boolean {
        return this._isDisposed || this.realKernel?.isDisposed === true;
    }
    private kernelProcess?: IKernelProcess;
    private exitHandler?: IDisposable;
    private realKernel?: Kernel.IKernelConnection;
    private socket: IKernelSocket & IWebSocketLike & IDisposable;
    private restartToken?: CancellationTokenSource;

    constructor(
        private readonly resource: Resource,
        private readonly kernelLauncher: IKernelLauncher,
        private readonly workingDirectory: Uri,
        private readonly launchTimeout: number,

        private readonly kernelConnectionMetadata: LocalKernelConnectionMetadata
    ) {
        this.name = getNameOfKernelConnection(kernelConnectionMetadata) || 'python3';
        this.model = {
            name: this.name,
            id: this.id
        };
    }
    public async restart(): Promise<void> {
        this.stopHandlingKernelMessages();
        this._isDisposed = false;
        this.isShuttingDown = false;
        this.hasShutdown = false;
        this.isRestarting = true;
        this.restartToken = new CancellationTokenSource();
        try {
            this.statusChanged.emit('restarting');
            await this.start(this.restartToken.token);
        } finally {
            this.restartToken.dispose();
        }
    }
    public async start(token: CancellationToken): Promise<void> {
        const disposables: IDisposable[] = [];
        const postStartToken = wrapCancellationTokens(token);
        disposables.push(postStartToken);
        try {
            const oldKernelProcess = this.kernelProcess;
            this.kernelProcess = undefined;
            oldKernelProcess?.dispose()?.catch(noop);
            swallowExceptions(() => this.socket?.dispose());
            swallowExceptions(() => this.realKernel?.dispose());
            // Try to start up our raw session, allow for cancellation or timeout
            // Notebook Provider level will handle the thrown error
            const kernelProcess = (this.kernelProcess = await KernelProgressReporter.wrapAndReportProgress(
                this.resource,
                DataScience.connectingToKernel(getDisplayNameOrNameOfKernelConnection(this.kernelConnectionMetadata)),
                () =>
                    this.kernelLauncher.launch(
                        this.kernelConnectionMetadata,
                        this.launchTimeout,
                        this.resource,
                        this.workingDirectory.fsPath,
                        token
                    )
            ));
            if (token.isCancellationRequested) {
                throw new CancellationError();
            }
            this.hookupKernelProcessExitHandler(kernelProcess);
            const result = newRawKernel(this.kernelProcess, this.clientId, this.username, this.model);
            this.kernelProcess = result.kernelProcess;
            this.realKernel = result.realKernel;
            this.socket = result.socket;
            result.realKernel.info.then(
                (info) => this.infoDeferred.resolve(info),
                (ex) => this.infoDeferred.reject(ex)
            );

            const timeout = setTimeout(() => postStartToken.cancel(), this.launchTimeout);
            disposables.push({ dispose: () => clearTimeout(timeout) });
            await KernelProgressReporter.wrapAndReportProgress(
                this.resource,
                DataScience.waitingForJupyterSessionToBeIdle,
                () =>
                    postStartKernel(
                        postStartToken.token,
                        this.launchTimeout,
                        this.resource,
                        this.kernelConnectionMetadata,
                        result.realKernel
                    )
            );
            if (token.isCancellationRequested) {
                throw new CancellationError();
            }
            this.startHandleKernelMessages();
            this.isRestarting = false;
            // Pretend like an open occurred. This will prime the real kernel to be connected
            this.statusChanged.emit(this.status);
        } catch (error) {
            await Promise.all([
                this.kernelProcess?.dispose().catch(noop),
                this.realKernel
                    ?.shutdown()
                    .catch((ex) => traceWarning(`Failed to shutdown kernel, ${this.kernelConnectionMetadata.id}`, ex))
            ]);
            if (
                isCancellationError(error) &&
                postStartToken.token.isCancellationRequested &&
                !token.isCancellationRequested
            ) {
                // This happens when we timeout waiting for the kernel to connect.
                throw new KernelConnectionTimeoutError(this.kernelConnectionMetadata);
            }
            if (isCancellationError(error) || token.isCancellationRequested) {
                traceVerbose('Starting of raw session cancelled by user');
            } else {
                traceError(`Failed to connect raw kernel session: ${error}`);
            }
            throw error;
        } finally {
            dispose(disposables);
        }
    }
    private hookupKernelProcessExitHandler(kernelProcess: IKernelProcess) {
        const oldExitHandler = this.exitHandler;
        this.exitHandler = undefined;
        oldExitHandler?.dispose();
        this.exitHandler = kernelProcess.exited((e: { exitCode?: number | undefined; reason?: string | undefined }) => {
            if (
                // We have a new process, and the old is being shutdown.
                kernelProcess !== this.kernelProcess ||
                this.isDisposing ||
                !this.kernelProcess ||
                this.status === 'dead' ||
                this.status === 'terminating'
            ) {
                return;
            }

            traceError(`Disposing session as kernel process died ExitCode: ${e.exitCode}, Reason: ${e.reason}`);
            // Send telemetry so we know why the kernel process exited,
            // as this affects our kernel startup success
            sendKernelTelemetryEvent(
                this.resource,
                Telemetry.RawKernelSessionKernelProcessExited,
                e.exitCode ? { exitCode: e.exitCode } : undefined,
                {
                    exitReason: getTelemetrySafeErrorMessageFromPythonTraceback(e.reason)
                }
            );

            this.shutdown().catch(noop);
        }, this);
    }
    public dispose(): void {
        if (this.isDisposed || this.isDisposing) {
            return;
        }
        this.isDisposing = true;
        this.shutdown()
            .finally(() => {
                this._isDisposed = true;
                this.disposed.emit();
                Signal.disconnectAll(this);
            })
            .catch(noop);
    }
    public async shutdown(): Promise<void> {
        if (this.isShuttingDown || this.hasShutdown) {
            return;
        }
        this.isShuttingDown = true;
        this.restartToken?.cancel();
        this.restartToken?.dispose();
        suppressShutdownErrors(this.realKernel);
        await this.kernelProcess?.dispose().catch(noop);
        this.socket.dispose();
        this.stopHandlingKernelMessages();
        this.isShuttingDown = false;
        this.hasShutdown = true;
        // Before triggering any status events ensure this is marked as disposed.
        if (this.isDisposing) {
            this._isDisposed = true;
        }
        this.statusChanged.emit(this.status);
        this.connectionStatusChanged.emit('disconnected');
    }
    public createComm(targetName: string, commId?: string): Kernel.IComm {
        return this.realKernel!.createComm(targetName, commId);
    }
    public hasComm(commId: string): boolean {
        return this.realKernel!.hasComm(commId);
    }
    public clone(
        _options?: Pick<Kernel.IKernelConnection.IOptions, 'clientId' | 'username' | 'handleComms'>
    ): Kernel.IKernelConnection {
        return this;
    }
    public get spec(): Promise<KernelSpec.ISpecModel | undefined> {
        if (isUserRegisteredKernelSpecConnection(this.kernelConnectionMetadata)) {
            const kernelSpec = JSON.parse(JSON.stringify(this.kernelConnectionMetadata.kernelSpec)) as any;
            const resources = 'resources' in kernelSpec ? kernelSpec.resources : {};
            return {
                ...kernelSpec,
                resources
            };
        }
        traceError('Fetching kernel spec from raw kernel using JLab API');
        return this.realKernel!.spec;
    }
    public sendShellMessage<T extends KernelMessage.ShellMessageType>(
        msg: KernelMessage.IShellMessage<T>,
        expectReply?: boolean,
        disposeOnDone?: boolean
    ): Kernel.IShellFuture<
        KernelMessage.IShellMessage<T>,
        KernelMessage.IShellMessage<KernelMessage.ShellMessageType>
    > {
        return this.realKernel!.sendShellMessage(msg, expectReply, disposeOnDone);
    }
    public sendControlMessage<T extends KernelMessage.ControlMessageType>(
        msg: KernelMessage.IControlMessage<T>,
        expectReply?: boolean,
        disposeOnDone?: boolean
    ): Kernel.IControlFuture<
        KernelMessage.IControlMessage<T>,
        KernelMessage.IControlMessage<KernelMessage.ControlMessageType>
    > {
        return this.realKernel!.sendControlMessage(msg, expectReply, disposeOnDone);
    }
    public reconnect(): Promise<void> {
        throw new Error('Reconnect is not supported for Local Kernels as connections cannot be lost.');
    }
    public async interrupt(): Promise<void> {
        // Send a kernel interrupt request to the real process only for our python kernels.

        // Send this directly to our kernel process. Don't send it through the real kernel. The
        // real kernel will send a goofy API request to the websocket.
        if (this.kernelProcess?.canInterrupt) {
            return this.kernelProcess?.interrupt();
        } else if (this.kernelConnectionMetadata.kernelSpec.interrupt_mode === 'message') {
            traceInfo(`Interrupting kernel with a shell message`);
            const jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services');
            const msg = jupyterLab.KernelMessage.createMessage({
                msgType: 'interrupt_request' as any,
                channel: 'shell',
                username: this.realKernel!.username,
                session: this.realKernel!.clientId,
                content: {}
            }) as any as KernelMessage.IShellMessage<'inspect_request'>;
            await this.realKernel!.sendShellMessage<'interrupt_request'>(msg as any, true, true).done.catch((ex) =>
                traceError('Failed to interrupt via a message', ex)
            );
        } else {
            traceError('Kernel interrupt not supported');
        }
    }
    public requestKernelInfo() {
        return this.realKernel!.requestKernelInfo();
    }
    public requestComplete(content: { code: string; cursor_pos: number }): Promise<KernelMessage.ICompleteReplyMsg> {
        return this.realKernel!.requestComplete(content);
    }
    public requestInspect(content: {
        code: string;
        cursor_pos: number;
        detail_level: 0 | 1;
    }): Promise<KernelMessage.IInspectReplyMsg> {
        return this.realKernel!.requestInspect(content);
    }
    public requestHistory(
        content:
            | KernelMessage.IHistoryRequestRange
            | KernelMessage.IHistoryRequestSearch
            | KernelMessage.IHistoryRequestTail
    ): Promise<KernelMessage.IHistoryReplyMsg> {
        return this.realKernel!.requestHistory(content);
    }
    public requestExecute(
        content: {
            code: string;
            silent?: boolean;
            store_history?: boolean;
            user_expressions?: import('@lumino/coreutils').JSONObject;
            allow_stdin?: boolean;
            stop_on_error?: boolean;
        },
        disposeOnDone?: boolean,
        metadata?: import('@lumino/coreutils').JSONObject
    ): Kernel.IShellFuture<KernelMessage.IExecuteRequestMsg, KernelMessage.IExecuteReplyMsg> {
        return this.realKernel!.requestExecute(content, disposeOnDone, metadata);
    }
    public requestDebug(
        // eslint-disable-next-line no-caller,no-eval
        content: { seq: number; type: 'request'; command: string; arguments?: any },
        disposeOnDone?: boolean
    ): Kernel.IControlFuture<KernelMessage.IDebugRequestMsg, KernelMessage.IDebugReplyMsg> {
        return this.realKernel!.requestDebug(content, disposeOnDone);
    }
    public requestIsComplete(content: { code: string }): Promise<KernelMessage.IIsCompleteReplyMsg> {
        return this.realKernel!.requestIsComplete(content);
    }
    public requestCommInfo(content: {
        target_name?: string;
        target?: string;
    }): Promise<KernelMessage.ICommInfoReplyMsg> {
        return this.realKernel!.requestCommInfo(content);
    }
    public sendInputReply(content: KernelMessage.IInputReplyMsg['content']): void {
        return this.realKernel!.sendInputReply(content);
    }
    public registerCommTarget(
        targetName: string,
        callback: (comm: Kernel.IComm, msg: KernelMessage.ICommOpenMsg) => void | PromiseLike<void>
    ): void {
        return this.realKernel!.registerCommTarget(targetName, callback);
    }
    public removeCommTarget(
        targetName: string,
        callback: (comm: Kernel.IComm, msg: KernelMessage.ICommOpenMsg) => void | PromiseLike<void>
    ): void {
        return this.realKernel!.removeCommTarget(targetName, callback);
    }
    public registerMessageHook(
        msgId: string,
        hook: (msg: KernelMessage.IIOPubMessage) => boolean | PromiseLike<boolean>
    ): void {
        this.realKernel!.registerMessageHook(msgId, hook);
    }
    public removeMessageHook(
        msgId: string,
        hook: (msg: KernelMessage.IIOPubMessage) => boolean | PromiseLike<boolean>
    ): void {
        this.realKernel!.removeMessageHook(msgId, hook);
    }
    private startHandleKernelMessages() {
        this.realKernel!.anyMessage.connect(this.onAnyMessage, this);
        this.realKernel!.iopubMessage.connect(this.onIOPubMessage, this);
        this.realKernel!.unhandledMessage.connect(this.onUnhandledMessage, this);
        this.realKernel!.statusChanged.connect(this.onStatusChanged, this);
        this.realKernel!.disposed.connect(this.onDisposed, this);
    }
    private stopHandlingKernelMessages() {
        this.realKernel!.anyMessage.disconnect(this.onAnyMessage, this);
        this.realKernel!.iopubMessage.disconnect(this.onIOPubMessage, this);
        this.realKernel!.unhandledMessage.disconnect(this.onUnhandledMessage, this);
        this.realKernel!.statusChanged.disconnect(this.onStatusChanged, this);
        this.realKernel!.disposed.disconnect(this.onDisposed, this);
    }
    private onAnyMessage(_connection: Kernel.IKernelConnection, msg: Kernel.IAnyMessageArgs) {
        this.anyMessage.emit(msg);
    }
    private onIOPubMessage(_connection: Kernel.IKernelConnection, msg: IIOPubMessage) {
        this.iopubMessage.emit(msg);
    }
    private onUnhandledMessage(_connection: Kernel.IKernelConnection, msg: IMessage<MessageType>) {
        this.unhandledMessage.emit(msg);
    }
    private onStatusChanged(_connection: Kernel.IKernelConnection, msg: Kernel.Status) {
        this.statusChanged.emit(msg);
    }
    private onDisposed(_connection: Kernel.IKernelConnection) {
        this.disposed.emit();
    }
}

async function postStartKernel(
    token: CancellationToken,
    launchTimeout: number,
    resource: Resource,
    kernelConnectionMetadata: LocalKernelConnectionMetadata,
    kernel: Kernel.IKernelConnection
): Promise<void> {
    try {
        // Wait for it to be ready
        traceVerbose('Waiting for Raw Session to be ready in postStartRawSession');
        await raceCancellationError(token, waitForReady(kernel, kernelConnectionMetadata, launchTimeout));
        traceVerbose('Successfully waited for Raw Session to be ready in postStartRawSession');
    } catch (ex) {
        traceError('Failed waiting for Raw Session to be ready', ex);
        if (isCancellationError(ex) || token.isCancellationRequested) {
            throw new CancellationError();
        }
        throw ex;
    }

    // Attempt to get kernel to respond to requests (this is what jupyter does today).
    // Kinda warms up the kernel communication & ensure things are in the right state.
    traceVerbose(`Kernel status before requesting kernel info and after ready is ${kernel?.status}`);
    // Lets wait for the response (max of 3s), like jupyter (python code) & jupyter client (jupyter lab npm) does.
    // Lets not wait for full timeout, we don't want to slow kernel startup.
    // Note: in node_modules/@jupyterlab/services/lib/kernel/default.js we only wait for 3s.
    // Hence we'll try for a max of 3 seconds (1.5s for first try & then another 1.5s for the second attempt),
    // Note: jupyter (python code) tries this a couple f times).
    // Note: We don't yet want to do what Jupyter does today, it could slow the startup of kernels.
    // Lets try this and see (hence the telemetry to see the cost of this check).
    // We know 10s is way too slow, see https://github.com/microsoft/vscode-jupyter/issues/8917
    const gotIoPubMessage = createDeferred<boolean>();
    const iopubHandler = () => gotIoPubMessage.resolve(true);
    kernel.iopubMessage.connect(iopubHandler);
    try {
        const stopWatch = new StopWatch();
        let attempts = 1;
        for (let attempts = 1; attempts <= 2; attempts++) {
            try {
                traceVerbose('Sending request for kernelInfo');
                await raceCancellationError(
                    token,
                    Promise.all([kernel.requestKernelInfo(), gotIoPubMessage.promise]),
                    sleep(Math.min(launchTimeout, 1_500)).then(noop)
                );
            } catch (ex) {
                traceError('Failed to request kernel info', ex);
                throw ex;
            }

            if (gotIoPubMessage.completed) {
                traceVerbose(`Got response for requestKernelInfo`);
                break;
            } else {
                traceVerbose(`Did not get a response for requestKernelInfo`);
                continue;
            }
        }
        if (gotIoPubMessage.completed) {
            traceVerbose('Successfully completed postStartRawSession');
        } else {
            traceWarning(`Didn't get response for requestKernelInfo after ${stopWatch.elapsedTime}ms.`);
        }
        sendKernelTelemetryEvent(
            resource,
            Telemetry.RawKernelInfoResponse,
            { duration: stopWatch.elapsedTime, attempts },
            {
                timedout: !gotIoPubMessage.completed
            }
        );
    } finally {
        kernel.iopubMessage.disconnect(iopubHandler);
    }

    /**
         * To get a better understanding of the way Jupyter works, we need to look at Jupyter Client code.
         * Here's an excerpt (there are a lot of checks in a number of different files, this is NOT he only place)
         * Leaving this here for reference purposes.

            def wait_for_ready(self):
                # Wait for kernel info reply on shell channel
                while True:
                    self.kernel_info()
                    try:
                        msg = self.shell_channel.get_msg(block=True, timeout=1)
                    except Empty:
                        pass
                    else:
                        if msg['msg_type'] == 'kernel_info_reply':
                            # Checking that IOPub is connected. If it is not connected, start over.
                            try:
                                self.iopub_channel.get_msg(block=True, timeout=0.2)
                            except Empty:
                                pass
                            else:
                                self._handle_kernel_info_reply(msg)
                                break

                # Flush IOPub channel
                while True:
                    try:
                        msg = self.iopub_channel.get_msg(block=True, timeout=0.2)
                        print(msg['msg_type'])
                    except Empty:
                        break
        */
}

function newRawKernel(kernelProcess: IKernelProcess, clientId: string, username: string, model: Kernel.IModel) {
    const jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services'); // NOSONAR
    const jupyterLabSerialize =
        require('@jupyterlab/services/lib/kernel/serialize') as typeof import('@jupyterlab/services/lib/kernel/serialize'); // NOSONAR

    // Dummy websocket we give to the underlying real kernel
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let socketInstance: IKernelSocket & IWebSocketLike & IDisposable;
    class RawSocketWrapper extends RawSocket {
        constructor() {
            super(kernelProcess.connection, jupyterLabSerialize.serialize);
            socketInstance = this;
        }
    }

    // Remap the server settings for the real kernel to use our dummy websocket
    const settings = jupyterLab.ServerConnection.makeSettings({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        WebSocket: RawSocketWrapper as any, // NOSONAR
        wsUrl: 'RAW'
    });

    // Then create the real kernel. We will remap its serialize/deserialize functions
    // to do nothing so that we can control serialization at our socket layer.
    if (!nonSerializingKernel) {
        // Note, this is done with a postInstall step (found in build\ci\postInstall.js). In that post install step
        // we eliminate the serialize import from the default kernel and remap it to do nothing.
        nonSerializingKernel =
            require('@jupyterlab/services/lib/kernel/nonSerializingKernel') as typeof import('@jupyterlab/services/lib/kernel/default'); // NOSONAR
    }
    const realKernel = new nonSerializingKernel.KernelConnection({
        serverSettings: settings,
        clientId,
        handleComms: true,
        username,
        model
    });

    KernelSocketMap.set(realKernel.id, socketInstance!);
    socketInstance!.emit('open');
    // Use this real kernel in result.
    return { realKernel, socket: socketInstance!, kernelProcess };
}

/**
 * Provide a way to wait for connected status
 */
async function waitForReady(
    kernel: Kernel.IKernelConnection,
    kernelConnectionMetadata: LocalKernelConnectionMetadata,
    launchTimeout: number
): Promise<void> {
    traceVerbose(`Waiting for Raw session to be ready, currently ${kernel.connectionStatus}`);
    // When our kernel connects and gets a status message it triggers the ready promise
    const deferred = createDeferred<'connected'>();
    const handler = (_: unknown, status: Kernel.ConnectionStatus) => {
        if (status == 'connected') {
            traceVerbose('Raw session connected');
            deferred.resolve(status);
        } else {
            traceVerbose(`Raw session not connected, status: ${status}`);
        }
    };
    kernel.connectionStatusChanged.connect(handler);
    if (kernel.connectionStatus === 'connected') {
        traceVerbose('Raw session connected');
        deferred.resolve(kernel.connectionStatus);
    }

    traceVerbose('Waiting for Raw session to be ready for 30s');
    const result = await raceTimeout(launchTimeout, deferred.promise);
    kernel.connectionStatusChanged.disconnect(handler);
    traceVerbose(`Waited for Raw session to be ready & got ${result}`);

    if (result !== 'connected') {
        throw new KernelConnectionTimeoutError(kernelConnectionMetadata);
    }
}
