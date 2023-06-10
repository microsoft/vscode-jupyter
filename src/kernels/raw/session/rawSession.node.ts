// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Kernel, KernelMessage, ServerConnection, Session } from '@jupyterlab/services';
import { Signal } from '@lumino/signaling';
import uuid from 'uuid/v4';
import { getTelemetrySafeErrorMessageFromPythonTraceback } from '../../../platform/errors/errorUtils';
import { traceVerbose, traceInfoIfCI, traceError, traceWarning } from '../../../platform/logging';
import { IDisplayOptions, IDisposable, Resource } from '../../../platform/common/types';
import { createDeferred, raceTimeout, sleep } from '../../../platform/common/utils/async';
import { KernelConnectionTimeoutError } from '../../errors/kernelConnectionTimeoutError';
import { Telemetry } from '../../../telemetry';
import { IKernelSocket, ISessionWithSocket, KernelSocketInformation, LocalKernelConnectionMetadata } from '../../types';
import { IKernelLauncher, IKernelProcess } from '../types';
import { RawKernelConnection } from './rawKernelConnection.node';
import { sendKernelTelemetryEvent } from '../../telemetry/sendKernelTelemetryEvent';
import { noop } from '../../../platform/common/utils/misc';
import { getDisplayNameOrNameOfKernelConnection, getNameOfKernelConnection } from '../../helpers';
import { RawSocket } from './rawSocket.node';
import { CancellationError, CancellationTokenSource, Uri } from 'vscode';
import { CancellationToken } from 'vscode-jsonrpc';
import { trackKernelResourceInformation } from '../../telemetry/helper';
import { isCancellationError, raceCancellationError } from '../../../platform/common/cancellation';
import { KernelProgressReporter } from '../../../platform/progress/kernelProgressReporter';
import { DataScience } from '../../../platform/common/utils/localize';
import { StopWatch } from '../../../platform/common/utils/stopWatch';
import { IWebSocketLike } from '../../common/kernelSocketWrapper';

let nonSerializingKernel: typeof import('@jupyterlab/services/lib/kernel/default');

/*
RawSession class implements a jupyterlab ISession object
This provides enough of the ISession interface so that our direct
ZMQ Kernel connection can pretend to be a jupyterlab Session
*/
export class RawSession implements ISessionWithSocket {
    public isDisposed: boolean = false;
    private isDisposing?: boolean;
    public readonly id: string;
    public readonly path: string;
    public readonly name: string;
    private _clientID: string;
    private _kernel?: RawKernelConnection;
    public readonly statusChanged = new Signal<this, KernelMessage.Status>(this);
    public readonly kernelChanged = new Signal<this, Session.ISessionConnection.IKernelChangedArgs>(this);
    public readonly terminated = new Signal<this, void>(this);
    public readonly iopubMessage = new Signal<this, KernelMessage.IIOPubMessage>(this);
    public readonly unhandledMessage = new Signal<this, KernelMessage.IMessage>(this);
    public readonly anyMessage = new Signal<this, Kernel.IAnyMessageArgs>(this);
    public readonly disposed = new Signal<this, void>(this);
    public readonly connectionStatusChanged = new Signal<this, Kernel.ConnectionStatus>(this);
    public readonly propertyChanged = new Signal<this, 'path' | 'name' | 'type'>(this);
    private exitHandler?: IDisposable;
    private _jupyterLabServices?: typeof import('@jupyterlab/services');
    private cellExecutedSuccessfully?: boolean;
    private kernelId = uuid();
    private kernelProcess?: IKernelProcess;
    public get atleastOneCellExecutedSuccessfully() {
        return this.cellExecutedSuccessfully === true;
    }
    private get jupyterLabServices() {
        if (!this._jupyterLabServices) {
            // Lazy load jupyter lab for faster extension loading.
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            this._jupyterLabServices = require('@jupyterlab/services') as typeof import('@jupyterlab/services'); // NOSONAR
        }
        return this._jupyterLabServices;
    }

    public get connectionStatus() {
        return this._kernel?.connectionStatus || 'disconnected';
    }
    get serverSettings(): ServerConnection.ISettings {
        // We do not expect anyone to use this. Hence return a setting thats now expected to work, but at least compiles.
        const jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services'); // NOSONAR
        return jupyterLab.ServerConnection.makeSettings({
            wsUrl: 'RAW'
        });
    }
    get model(): Session.IModel {
        return {
            id: this.id,
            name: this.name,
            path: this.path,
            type: 'notebook',
            kernel: {
                id: this.kernelId,
                name: this.name
            }
        };
    }
    get status(): KernelMessage.Status {
        return this.kernel?.status ?? 'unknown';
    }

    isRemoteSession?: boolean | undefined;

    // RawSession owns the lifetime of the kernel process and will dispose it
    constructor(
        public readonly resource: Resource,
        private readonly kernelLauncher: IKernelLauncher,
        private readonly workingDirectory: Uri,
        public readonly kernelConnectionMetadata: LocalKernelConnectionMetadata,
        private readonly launchTimeout: number,
        public readonly type: 'notebook' | 'console'
    ) {
        // Unique ID for this session instance
        this.id = uuid();
        this.name = getNameOfKernelConnection(this.kernelConnectionMetadata) || 'python3';
        this.path = this.resource?.fsPath || this.kernelConnectionMetadata.interpreter?.uri.fsPath || 'kernel_path';
        // ID for our client JMP connection
        this._clientID = uuid();
    }

    public async dispose() {
        // We want to know who called dispose on us
        const stacktrace = new Error().stack;
        sendKernelTelemetryEvent(this.resource, Telemetry.RawKernelSessionDisposed, undefined, { stacktrace });

        // Now actually dispose ourselves
        this.isDisposing = true;
        await this.shutdown();
        this.isDisposed = true;
        Signal.disconnectAll(this);
    }
    // Return the current kernel for this session
    get kernel(): Kernel.IKernelConnection | null {
        return this._kernel as Kernel.IKernelConnection | null;
    }

    get kernelSocketInformation(): KernelSocketInformation {
        return {
            socket: this._kernel?.socket,
            options: {
                id: this.kernelId,
                clientId: this._clientID,
                userName: '',
                model: {
                    id: this.kernelId,
                    name: this.name
                }
            }
        };
    }

    // Shutdown our session and kernel
    public async shutdown(): Promise<void> {
        this.statusChanged.emit('terminating');
        this.exitHandler?.dispose();
        this.exitHandler = undefined;
        const kernel = this._kernel;
        this._kernel = undefined;
        this.kernelProcess = undefined;
        if (kernel) {
            try {
                kernel.statusChanged.disconnect(this.onKernelStatus, this);
                kernel.iopubMessage.disconnect(this.onIOPubMessage, this);
                kernel.connectionStatusChanged.disconnect(this.onKernelConnectionStatus, this);
                kernel.unhandledMessage.disconnect(this.onUnhandledMessage, this);
                kernel.anyMessage.disconnect(this.onAnyMessage, this);
                kernel.disposed.disconnect(this.onDisposed, this);
            } catch {
                //
            }
            await kernel
                .shutdown()
                .catch((ex) => traceWarning(`Failed to shutdown kernel, ${this.kernelConnectionMetadata.id}`, ex));
            kernel.dispose();
        }
        this.statusChanged.emit('dead');
    }

    public setPath(_path: string): Promise<void> {
        throw new Error('Not yet implemented');
    }
    public setName(_name: string): Promise<void> {
        throw new Error('Not yet implemented');
    }
    public setType(_type: string): Promise<void> {
        throw new Error('Not yet implemented');
    }
    public changeKernel(_options: Partial<Kernel.IModel>): Promise<Kernel.IKernelConnection> {
        throw new Error('Not yet implemented');
    }

    // Private
    // Send out a message when our kernel changes state
    private onKernelStatus(_sender: Kernel.IKernelConnection, state: KernelMessage.Status) {
        traceInfoIfCI(`RawSession status changed to ${state}`);
        this.statusChanged.emit(state);
    }
    private onIOPubMessage(_sender: Kernel.IKernelConnection, msg: KernelMessage.IIOPubMessage) {
        if (
            !this.cellExecutedSuccessfully &&
            msg.header.msg_type === 'execute_result' &&
            msg.content &&
            (this.jupyterLabServices.KernelMessage.isExecuteResultMsg(msg) ||
                this.jupyterLabServices.KernelMessage.isExecuteInputMsg(msg)) &&
            msg.content.execution_count
        ) {
            this.cellExecutedSuccessfully = true;
        }
        this.iopubMessage.emit(msg);
    }
    private onAnyMessage(_sender: Kernel.IKernelConnection, msg: Kernel.IAnyMessageArgs) {
        this.anyMessage.emit(msg);
    }
    private onUnhandledMessage(_sender: Kernel.IKernelConnection, msg: KernelMessage.IMessage) {
        this.unhandledMessage.emit(msg);
    }
    private onKernelConnectionStatus(_sender: Kernel.IKernelConnection, state: Kernel.ConnectionStatus) {
        this.connectionStatusChanged.emit(state);
    }
    private onDisposed(_sender: Kernel.IKernelConnection) {
        this.disposed.emit();
    }
    public async startKernel(options: {
        token: CancellationToken;
        ui: IDisplayOptions;
    }): Promise<Kernel.IKernelConnection> {
        await trackKernelResourceInformation(this.resource, { kernelConnection: this.kernelConnectionMetadata });
        const result = await this.startNewKernel(options.token);
        this._kernel = new RawKernelConnection(
            result.realKernel,
            this.kernelConnectionMetadata,
            result.socket,
            result.kernelProcess,
            this.startNewKernel.bind(this)
        );
        this._kernel.statusChanged.connect(this.onKernelStatus, this);
        this._kernel.iopubMessage.connect(this.onIOPubMessage, this);
        this._kernel.connectionStatusChanged.connect(this.onKernelConnectionStatus, this);
        this._kernel.unhandledMessage.connect(this.onUnhandledMessage, this);
        this._kernel.anyMessage.connect(this.onAnyMessage, this);
        this._kernel.disposed.connect(this.onDisposed, this);
        return this._kernel;
    }
    private async startNewKernel(token?: CancellationToken): Promise<{
        realKernel: Kernel.IKernelConnection;
        socket: IKernelSocket & IWebSocketLike & IDisposable;
        kernelProcess: IKernelProcess;
    }> {
        const asyncDisposablesIfFailed: { dispose: () => Promise<void> }[] = [];
        try {
            this.exitHandler?.dispose();
            this.exitHandler = undefined;
            this.kernelProcess?.dispose()?.catch(noop);

            // Try to start up our raw session, allow for cancellation or timeout
            // Notebook Provider level will handle the thrown error
            const kernelProcess = (this.kernelProcess = await KernelProgressReporter.wrapAndReportProgress(
                this.resource,
                DataScience.connectingToKernel(getDisplayNameOrNameOfKernelConnection(this.kernelConnectionMetadata)),
                () => {
                    const token = new CancellationTokenSource();
                    // Shutdown current kernel.
                    return this.kernelLauncher.launch(
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        this.kernelConnectionMetadata as any,
                        this.launchTimeout,
                        this.resource,
                        this.workingDirectory.fsPath,
                        token.token
                    );
                }
            ));
            asyncDisposablesIfFailed.push({ dispose: () => kernelProcess?.dispose().catch(noop) });
            this.exitHandler = this.kernelProcess.exited(
                (e: { exitCode?: number | undefined; reason?: string | undefined }) => {
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
                    this.exitHandler?.dispose();
                    this.exitHandler = undefined;

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

                    // Just kill the session.
                    this.shutdown().catch(noop);
                },
                this
            );
            const result = createRawKernel(this.kernelProcess, this._clientID, this.kernelId);
            const kernel = result.realKernel;
            asyncDisposablesIfFailed.push({
                dispose: async () => {
                    await kernel
                        .shutdown()
                        .catch((ex) =>
                            traceWarning(`Failed to shutdown kernel, ${this.kernelConnectionMetadata.id}`, ex)
                        );
                    kernel.dispose();
                }
            });
            const tokenSource = new CancellationTokenSource();
            await KernelProgressReporter.wrapAndReportProgress(
                this.resource,
                DataScience.waitingForJupyterSessionToBeIdle,
                () =>
                    postStartKernel({
                        token: tokenSource.token,
                        kernel: result.realKernel,
                        kernelConnectionMetadata: this.kernelConnectionMetadata,
                        launchTimeout: this.launchTimeout,
                        resource: this.resource
                    })
            ).finally(() => tokenSource.dispose());
            return result;
        } catch (error) {
            await asyncDisposablesIfFailed.map((d) => d.dispose().catch(noop));

            if (isCancellationError(error) || token?.isCancellationRequested) {
                traceVerbose('Starting of raw session cancelled by user');
            } else {
                traceError(`Failed to connect raw kernel session: ${error}`);
            }
            throw error;
        }
    }
}
async function postStartKernel({
    token,
    launchTimeout,
    resource,
    kernelConnectionMetadata,
    kernel
}: {
    token: CancellationToken;
    launchTimeout: number;
    resource: Resource;
    kernelConnectionMetadata: LocalKernelConnectionMetadata;
    kernel: Kernel.IKernelConnection;
}): Promise<void> {
    try {
        // Wait for it to be ready
        traceVerbose('Waiting for Raw Session to be ready in postStartRawSession');
        await raceCancellationError(token, waitForReady(kernel, kernelConnectionMetadata));
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

function createRawKernel(kernelProcess: IKernelProcess, clientId: string, kernelId: string = uuid()) {
    const jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services'); // NOSONAR
    const jupyterLabSerialize =
        require('@jupyterlab/services/lib/kernel/serialize') as typeof import('@jupyterlab/services/lib/kernel/serialize'); // NOSONAR

    // Dummy websocket we give to the underlying real kernel
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let socketInstance: IKernelSocket & IWebSocketLike & IDisposable;
    class RawSocketWrapper extends RawSocket {
        constructor() {
            super(kernelProcess.connection, jupyterLabSerialize.serialize, jupyterLabSerialize.deserialize);
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
        username: uuid(),
        model: {
            name: getNameOfKernelConnection(kernelProcess.kernelConnectionMetadata) || 'python3',
            id: kernelId
        }
    });

    // Use this real kernel in result.
    return { realKernel, socket: socketInstance!, kernelProcess };
}

/**
 * Provide a way to wait for connected status
 */
async function waitForReady(
    kernel: Kernel.IKernelConnection,
    kernelConnectionMetadata: LocalKernelConnectionMetadata
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
    const result = await raceTimeout(30_000, deferred.promise);
    kernel.connectionStatusChanged.disconnect(handler);
    traceVerbose(`Waited for Raw session to be ready & got ${result}`);

    if (result !== 'connected') {
        throw new KernelConnectionTimeoutError(kernelConnectionMetadata);
    }
}
