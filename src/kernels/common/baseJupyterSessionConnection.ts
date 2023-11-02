// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Kernel, KernelMessage, Session } from '@jupyterlab/services';
import { Signal } from '@lumino/signaling';
import { CancellationToken, EventEmitter } from 'vscode';
import type { IChangedArgs } from '@jupyterlab/coreutils';
import { IDisposable } from '../../platform/common/types';
import { dispose } from '../../platform/common/utils/lifecycle';
import { traceInfo, traceInfoIfCI, traceWarning } from '../../platform/logging';
import { IBaseKernelSession, IKernelSocket } from '../types';
import { KernelSocketMap } from '../kernelSocket';

export abstract class BaseJupyterSessionConnection<
        S extends Session.ISessionConnection,
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
    public get kernel(): Kernel.IKernelConnection | null {
        if (this.isDisposed || !this.session.kernel) {
            return null;
        }
        return this.session.kernel;
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
    protected _onDidKernelSocketChange = new EventEmitter<void>();

    public get onDidKernelSocketChange() {
        return this._onDidKernelSocketChange.event;
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
        this.statusChanged.emit('dead');
        this._disposed.fire();
        this.disposed.emit();
        this.previousAnyMessageHandler?.dispose();

        dispose(this.disposables);
        Signal.disconnectAll(this);
    }
    abstract shutdown(): Promise<void>;
    abstract waitForIdle(timeout: number, token: CancellationToken): Promise<void>;
    public async restart(): Promise<void> {
        await this.session.kernel?.restart();
        this.initializeKernelSocket();
        traceInfo(`Restarted ${this.session?.kernel?.id}`);
    }
    private previousKernelSocketInformation?: {
        kernel: Kernel.IKernelConnection;
        socket: IKernelSocket | undefined;
    };
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
            socket: KernelSocketMap.get(this.session.kernel.id)
        };
        // If we have a new session, then emit the new kernel connection information.
        if (
            JSON.stringify(this.previousKernelSocketInformation?.kernel.model) ===
                JSON.stringify(newKernelSocketInformation.kernel.model) &&
            this.previousKernelSocketInformation?.kernel === newKernelSocketInformation.kernel &&
            this.previousKernelSocketInformation?.kernel.id === newKernelSocketInformation.kernel.id &&
            // We MUST compare the instance of the socket,
            // When restarting local kernels, the id is the same, but the socket instance is different.
            this.previousKernelSocketInformation?.socket === newKernelSocketInformation.socket
        ) {
            return;
        }

        this.previousKernelSocketInformation = newKernelSocketInformation;
        this.previousAnyMessageHandler?.dispose();
        this.session.kernel?.connectionStatusChanged.disconnect(this.onKernelConnectionStatusHandler, this);

        // Listen for session status changes
        this.session.kernel?.connectionStatusChanged.connect(this.onKernelConnectionStatusHandler, this);
        this._onDidKernelSocketChange.fire();
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
    }
}
