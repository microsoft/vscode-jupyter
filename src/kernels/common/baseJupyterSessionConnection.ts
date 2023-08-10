// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Kernel, KernelMessage, Session } from '@jupyterlab/services';
import { Signal } from '@lumino/signaling';
import { CancellationToken, Event, EventEmitter } from 'vscode';
import { Observable } from 'rxjs/Observable';
import { ReplaySubject } from 'rxjs/ReplaySubject';
import type { IChangedArgs } from '@jupyterlab/coreutils';
import { IDisposable } from '../../platform/common/types';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { traceInfo, traceInfoIfCI, traceWarning } from '../../platform/logging';
import { IBaseKernelSession, INewSessionWithSocket, KernelSocketInformation } from '../types';
import { KernelConnectionWrapper } from './kernelConnectionWrapper';

export abstract class BaseJupyterSessionConnection<
        S extends INewSessionWithSocket,
        T extends 'remoteJupyter' | 'localJupyter' | 'localRaw'
    >
    implements Session.ISessionConnection, IBaseKernelSession<T>
{
    public get id() {
        return this.session.id;
    }
    public get path() {
        return this.session.path;
    }
    public get name() {
        return this.session.name;
    }
    public get type() {
        return this.session.type;
    }
    public get serverSettings() {
        return this.session.serverSettings;
    }
    public get model() {
        return this.session.model;
    }
    public readonly propertyChanged = new Signal<this, 'path' | 'name' | 'type'>(this);
    kernelChanged = new Signal<
        this,
        IChangedArgs<Kernel.IKernelConnection | null, Kernel.IKernelConnection | null, 'kernel'>
    >(this);
    statusChanged = new Signal<this, Kernel.Status>(this);
    /**
     * The kernel connectionStatusChanged signal, proxied from the current
     * kernel.
     */
    connectionStatusChanged = new Signal<this, Kernel.ConnectionStatus>(this);
    /**
     * The kernel iopubMessage signal, proxied from the current kernel.
     */
    iopubMessage = new Signal<this, KernelMessage.IIOPubMessage>(this);
    /**
     * The kernel unhandledMessage signal, proxied from the current kernel.
     */
    unhandledMessage = new Signal<this, KernelMessage.IMessage>(this);
    /**
     * The kernel anyMessage signal, proxied from the current kernel.
     */
    anyMessage = new Signal<this, Kernel.IAnyMessageArgs>(this);
    protected onStatusChangedEvent = new EventEmitter<KernelMessage.Status>();
    protected readonly disposables: IDisposable[] = [];

    constructor(
        public readonly kind: T,
        protected readonly session: S
    ) {
        session.propertyChanged.connect(this.onPropertyChanged, this);
        session.kernelChanged.connect(this.onKernelChanged, this);
        session.statusChanged.connect(this.onStatusChanged, this);
        session.connectionStatusChanged.connect(this.onConnectionStatusChanged, this);
        session.iopubMessage.connect(this.onIOPubMessage, this);
        session.unhandledMessage.connect(this.onUnhandledMessage, this);
        session.anyMessage.connect(this.onAnyMessage, this);

        this.disposables.push({
            dispose: () => {
                this.didShutdown.dispose();
                this._disposed.dispose();
                this.onStatusChangedEvent.dispose();

                this.session.propertyChanged.disconnect(this.onPropertyChanged, this);
                this.session.kernelChanged.disconnect(this.onKernelChanged, this);
                this.session.statusChanged.disconnect(this.onStatusChanged, this);
                this.session.connectionStatusChanged.disconnect(this.onConnectionStatusChanged, this);
                this.session.iopubMessage.disconnect(this.onIOPubMessage, this);
                this.session.unhandledMessage.disconnect(this.onUnhandledMessage, this);
                this.session.anyMessage.disconnect(this.onAnyMessage, this);
            }
        });
    }
    /**
     * Keep a single instance of KernelConnectionWrapper.
     * This way when sessions change, we still have a single Kernel.IKernelConnection proxy (wrapper),
     * which will have all of the event handlers bound to it.
     * This allows consumers to add event handlers hand not worry about internals & can use the lower level Jupyter API.
     */
    protected _wrappedKernel?: KernelConnectionWrapper;
    public get kernel(): Kernel.IKernelConnection | null {
        if (this.isDisposed || !this.session.kernel) {
            return null;
        }
        if (this._wrappedKernel?.originalKernel === this.session.kernel) {
            return this._wrappedKernel;
        }
        // We need to use KernelConnectionWrapper just for one reason, we need to ensure all
        // of the requestExecute methods are sent sequentially to the kernel.
        // See KernelConnectionWrapper why we need to send these messages sequentially.
        this._wrappedKernel = new KernelConnectionWrapper(this.session.kernel, this.disposables);
        return this._wrappedKernel;
    }

    public disposed = new Signal<this, void>(this);
    public get isDisposed(): boolean {
        return this._isDisposed === true;
    }
    protected _isDisposed: boolean;
    protected readonly _disposed = new EventEmitter<void>();
    protected readonly didShutdown = new EventEmitter<void>();
    public get onDidDispose() {
        return this._disposed.event;
    }
    public get onDidShutdown() {
        return this.didShutdown.event;
    }
    public get kernelId(): string | undefined {
        return this.session?.kernel?.id || '';
    }
    protected _kernelSocket = new ReplaySubject<KernelSocketInformation | undefined>();

    public get kernelSocket(): Observable<KernelSocketInformation | undefined> {
        return this._kernelSocket;
    }
    public get onSessionStatusChanged(): Event<KernelMessage.Status> {
        return this.onStatusChangedEvent.event;
    }

    public abstract readonly status: KernelMessage.Status;
    protected previousAnyMessageHandler?: IDisposable;
    private disposeInvoked?: boolean;
    public async disposeAsync(): Promise<void> {
        this.dispose();
    }
    public dispose() {
        if (this.disposeInvoked) {
            return;
        }
        // onStatusChangedEvent is Deprecated, use statusChanged instead.
        // Until we remove onStatusChangedEvent, leave this comment so we know why we're still leaving this event around but not firing it.
        // Only fired in the old session classes.
        // this.onStatusChangedEvent.fire('dead');
        this.statusChanged.emit('dead');
        this._disposed.fire();
        this.disposed.emit();
        this.previousAnyMessageHandler?.dispose();

        disposeAllDisposables(this.disposables);
        Signal.disconnectAll(this);
    }
    abstract shutdown(): Promise<void>;
    abstract waitForIdle(timeout: number, token: CancellationToken): Promise<void>;
    public async restart(): Promise<void> {
        await this.session.kernel?.restart();
        this.initializeKernelSocket();
        traceInfo(`Restarted ${this.session?.kernel?.id}`);
    }
    private previousKernelSocketInformation?: KernelSocketInformation & { kernel: Kernel.IKernelConnection };
    protected initializeKernelSocket() {
        if (!this.session.kernel) {
            throw new Error('Kernel not initialized in Session');
        }
        const newKernelSocketInformation = {
            kernel: this.session.kernel,
            options: {
                clientId: this.session.kernel.clientId,
                id: this.session.kernel.id,
                model: { ...this.session.kernel.model },
                userName: this.session.kernel.username
            },
            socket: this.session.kernelSocketInformation.socket
        };
        // If we have a new session, then emit the new kernel connection information.
        if (
            JSON.stringify(this.previousKernelSocketInformation?.options) ===
                JSON.stringify(newKernelSocketInformation.options) &&
            this.previousKernelSocketInformation?.kernel === newKernelSocketInformation.kernel &&
            this.previousKernelSocketInformation?.socket === newKernelSocketInformation.socket
        ) {
            return;
        }

        this.previousKernelSocketInformation = newKernelSocketInformation;
        this.previousAnyMessageHandler?.dispose();
        this.session.kernel?.connectionStatusChanged.disconnect(this.onKernelConnectionStatusHandler, this);

        // Listen for session status changes
        this.session.kernel?.connectionStatusChanged.connect(this.onKernelConnectionStatusHandler, this);
        if (this.session.kernelSocketInformation.socket?.onAnyMessage) {
            // See IKernelSocket.onAnyMessage
            // Some messages are sent directly to the kernel bypassing the Jupyter lab npm libraries.
            // As a result onAnyMessage signal is not emitted for such messages.
            // The IKernelSocket exposes an onAnyMessage event that can be used to listen to such messages
            // Once we get these messages we can emit them on the anyMessage signal.
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
        this._kernelSocket.next(newKernelSocketInformation);
    }

    private onPropertyChanged(_: unknown, value: 'path' | 'name' | 'type') {
        this.propertyChanged.emit(value);
    }
    private onKernelChanged(
        _: unknown,
        value: IChangedArgs<Kernel.IKernelConnection | null, Kernel.IKernelConnection | null, 'kernel'>
    ) {
        this.kernelChanged.emit(value);
    }
    private onStatusChanged(_: unknown, value: Kernel.Status) {
        this.statusChanged.emit(value);
        const status = this.status;
        traceInfoIfCI(`Server Status = ${status}`);
        if (status !== 'dead') {
            // onStatusChangedEvent is Deprecated, use statusChanged instead.
            // Until we remove onStatusChangedEvent, leave this comment so we know why we're still leaving this event around but not firing it.
            // Only fired in the old session classes.
            this.onStatusChangedEvent.fire(status);
        }
    }
    private onConnectionStatusChanged(_: unknown, value: Kernel.ConnectionStatus) {
        this.connectionStatusChanged.emit(value);
    }
    private onIOPubMessage(_: unknown, value: KernelMessage.IIOPubMessage) {
        this.iopubMessage.emit(value);
    }
    private onUnhandledMessage(_: unknown, value: KernelMessage.IMessage) {
        traceWarning(`Unhandled message found: ${value.header.msg_type}`);
        this.unhandledMessage.emit(value);
    }
    private onAnyMessage(_: unknown, value: Kernel.IAnyMessageArgs) {
        this.anyMessage.emit(value);
    }
    public setPath(value: string) {
        return this.session.setPath(value);
    }
    public setName(value: string) {
        return this.session.setName(value);
    }
    public setType(value: string) {
        return this.session.setType(value);
    }
    public changeKernel(options: Partial<Kernel.IModel>) {
        return this.session.changeKernel(options);
    }
    private onKernelConnectionStatusHandler(_: unknown, kernelConnection: Kernel.ConnectionStatus) {
        traceInfoIfCI(`Server Kernel Status = ${kernelConnection}`);
        if (kernelConnection === 'disconnected') {
            if (this.status !== 'dead') {
                // onStatusChangedEvent is Deprecated, use statusChanged instead.
                // Until we remove onStatusChangedEvent, leave this comment so we know why we're still leaving this event around but not firing it.
                // Only fired in the old session classes.
                this.onStatusChangedEvent.fire(this.status);
            }
        }
    }
}
