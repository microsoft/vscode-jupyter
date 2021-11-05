// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import type { Kernel, KernelMessage, ServerConnection, Session } from '@jupyterlab/services';
import { ISignal, Signal } from '@lumino/signaling';
import * as uuid from 'uuid/v4';
import { getTelemetrySafeErrorMessageFromPythonTraceback } from '../../common/errors/errorUtils';
import '../../common/extensions';
import { traceError, traceInfoIfCI } from '../../common/logger';
import { IDisposable, Resource } from '../../common/types';
import { createDeferred, sleep } from '../../common/utils/async';
import { noop } from '../../common/utils/misc';
import { sendTelemetryEvent } from '../../telemetry';
import { Telemetry } from '../constants';
import { KernelConnectionTimeoutError } from '../errors/kernelConnectionTimeoutError';
import { KernelConnectionMetadata } from '../jupyter/kernels/types';
import { IKernelProcess } from '../kernel-launcher/types';
import { ISessionWithSocket, KernelSocketInformation } from '../types';
import { createRawKernel, RawKernel } from './rawKernel';

/*
RawSession class implements a jupyterlab ISession object
This provides enough of the ISession interface so that our direct
ZMQ Kernel connection can pretend to be a jupyterlab Session
*/
export class RawSession implements ISessionWithSocket {
    public isDisposed: boolean = false;
    public readonly kernelConnectionMetadata: KernelConnectionMetadata;
    private isDisposing?: boolean;

    // Note, ID is the ID of this session
    // ClientID is the ID that we pass in messages to the kernel
    // and is also the clientID of the active kernel
    private _id: string;
    private _clientID: string;
    private _kernel: RawKernel;
    private readonly _statusChanged: Signal<this, KernelMessage.Status>;
    private readonly _kernelChanged: Signal<this, Session.ISessionConnection.IKernelChangedArgs>;
    private readonly _terminated: Signal<this, void>;
    private readonly _ioPubMessage: Signal<this, KernelMessage.IIOPubMessage>;
    private readonly _connectionStatusChanged: Signal<this, Kernel.ConnectionStatus>;
    private readonly exitHandler: IDisposable;
    private readonly signaling: typeof import('@lumino/signaling');
    private _jupyterLabServices?: typeof import('@jupyterlab/services');
    private cellExecutedSuccessfully?: boolean;
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

    // RawSession owns the lifetime of the kernel process and will dispose it
    constructor(public kernelProcess: IKernelProcess, public readonly resource: Resource) {
        this.kernelConnectionMetadata = kernelProcess.kernelConnectionMetadata;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const signaling = (this.signaling = require('@lumino/signaling') as typeof import('@lumino/signaling'));
        this._statusChanged = new signaling.Signal<this, KernelMessage.Status>(this);
        this._kernelChanged = new signaling.Signal<this, Session.ISessionConnection.IKernelChangedArgs>(this);
        this._ioPubMessage = new signaling.Signal<this, KernelMessage.IIOPubMessage>(this);
        this._terminated = new signaling.Signal<this, void>(this);
        this._connectionStatusChanged = new signaling.Signal<this, Kernel.ConnectionStatus>(this);
        // Unique ID for this session instance
        this._id = uuid();

        // ID for our client JMP connection
        this._clientID = uuid();

        // Connect our kernel and hook up status changes
        this._kernel = createRawKernel(kernelProcess, this._clientID);
        this._kernel.statusChanged.connect(this.onKernelStatus, this);
        this._kernel.iopubMessage.connect(this.onIOPubMessage, this);
        this._kernel.connectionStatusChanged.connect(this.onKernelConnectionStatus, this);
        this.exitHandler = kernelProcess.exited(this.handleUnhandledExitingOfKernelProcess, this);
    }
    public get connectionStatus() {
        return this._kernel.connectionStatus;
    }
    public get connectionStatusChanged(): ISignal<this, Kernel.ConnectionStatus> {
        return this._kernel.connectionStatusChanged;
    }
    public get disposed(): ISignal<this, void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return this._kernel.disposed as any;
    }
    isRemoteSession?: boolean | undefined;

    public async dispose() {
        // We want to know who called dispose on us
        const stacktrace = new Error().stack;
        sendTelemetryEvent(Telemetry.RawKernelSessionDisposed, undefined, { stacktrace });

        // Now actually dispose ourselves
        this.isDisposing = true;
        if (!this.isDisposed) {
            this.exitHandler.dispose();
            await this._kernel.shutdown();
            this._kernel.dispose();
            await this.kernelProcess.dispose().catch(noop);
        }
        this.isDisposed = true;
        this.signaling.Signal.disconnectAll(this);
    }

    // Return the ID, this is session's ID, not clientID for messages
    get id(): string {
        return this._id;
    }

    // Return the current kernel for this session
    get kernel(): Kernel.IKernelConnection {
        return this._kernel;
    }

    get kernelSocketInformation(): KernelSocketInformation {
        return {
            socket: this._kernel.socket,
            options: {
                id: this._kernel.id,
                clientId: this._clientID,
                userName: '',
                model: this._kernel.model
            }
        };
    }

    // Provide status changes for the attached kernel
    get statusChanged(): ISignal<this, KernelMessage.Status> {
        return this._statusChanged;
    }

    // Provide a way to wait for connected status
    public async waitForReady(): Promise<void> {
        // When our kernel connects and gets a status message it triggers the ready promise
        const deferred = createDeferred<string>();
        const handler = (_session: RawSession, status: Kernel.ConnectionStatus) => {
            if (status == 'connected') {
                traceInfoIfCI('Raw session connected');
                deferred.resolve(status);
            }
        };
        this.connectionStatusChanged.connect(handler);
        if (this.connectionStatus === 'connected') {
            traceInfoIfCI('Raw session connected');
            deferred.resolve(this.connectionStatus);
        }

        const result = await Promise.race([deferred.promise, sleep(30_000)]);
        this.connectionStatusChanged.disconnect(handler);

        if (result.toString() !== 'connected') {
            throw new KernelConnectionTimeoutError(this.kernelConnectionMetadata);
        }
    }

    // Shutdown our session and kernel
    public shutdown(): Promise<void> {
        return this.dispose();
    }

    // Not Implemented ISession
    get terminated(): ISignal<this, void> {
        return this._terminated;
    }
    get kernelChanged(): ISignal<this, Session.ISessionConnection.IKernelChangedArgs> {
        return this._kernelChanged;
    }
    get propertyChanged(): ISignal<this, 'path' | 'name' | 'type'> {
        throw new Error('Not yet implemented');
    }
    get iopubMessage(): ISignal<this, KernelMessage.IIOPubMessage> {
        return this._ioPubMessage;
    }
    get unhandledMessage(): ISignal<this, KernelMessage.IMessage> {
        return this._kernel.unhandledMessage;
    }
    get anyMessage(): ISignal<this, Kernel.IAnyMessageArgs> {
        return this._kernel.anyMessage;
    }
    get path(): string {
        throw new Error('Not yet implemented');
    }
    get name(): string {
        return this.kernel.name;
    }
    get type(): string {
        return 'notebook';
    }
    get serverSettings(): ServerConnection.ISettings {
        return this.kernel.serverSettings;
    }
    get model(): Session.IModel {
        return {
            id: this._id,
            name: this._kernel.name,
            path: this.kernelProcess.kernelConnectionMetadata.interpreter?.path || 'kernel_path',
            type: 'notebook',
            kernel: this._kernel.model
        };
    }
    get status(): KernelMessage.Status {
        return this.kernel.status;
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
        this._statusChanged.emit(state);
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
        this._ioPubMessage.emit(msg);
    }
    private onKernelConnectionStatus(_sender: Kernel.IKernelConnection, state: Kernel.ConnectionStatus) {
        this._connectionStatusChanged.emit(state);
    }
    private handleUnhandledExitingOfKernelProcess(e: { exitCode?: number | undefined; reason?: string | undefined }) {
        if (this.isDisposing) {
            return;
        }
        traceError(`Disposing session as kernel process died ExitCode: ${e.exitCode}, Reason: ${e.reason}`);
        // Send telemetry so we know why the kernel process exited,
        // as this affects our kernel startup success
        sendTelemetryEvent(Telemetry.RawKernelSessionKernelProcessExited, undefined, {
            exitCode: e.exitCode,
            exitReason: getTelemetrySafeErrorMessageFromPythonTraceback(e.reason)
        });

        // Just kill the session.
        this.dispose().ignoreErrors();
    }
}
