// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import type { Kernel } from '@jupyterlab/services';
import type {
    IInfoReply,
    ShellMessageType,
    IShellMessage,
    ControlMessageType,
    IControlMessage,
    IInfoReplyMsg,
    ICompleteReplyMsg,
    IInspectReplyMsg,
    IHistoryRequestRange,
    IHistoryRequestSearch,
    IHistoryRequestTail,
    IHistoryReplyMsg,
    IExecuteRequestMsg,
    IExecuteReplyMsg,
    IDebugRequestMsg,
    IDebugReplyMsg,
    IIsCompleteReplyMsg,
    ICommInfoReplyMsg,
    IReplyErrorContent,
    IReplyAbortContent,
    IInputReply,
    ICommOpenMsg,
    IIOPubMessage,
    IOPubMessageType,
    IMessage,
    MessageType
} from '@jupyterlab/services/lib/kernel/messages';
import { ISpecModel } from '@jupyterlab/services/lib/kernelspec/restapi';
import { JSONObject } from '@lumino/coreutils';
import { Signal } from '@lumino/signaling';
import { Disposable } from 'vscode';
import { IDisposable } from '../../../common/types';
import { IKernel } from './types';

export class KernelConnectionWrapper implements Kernel.IKernelConnection {
    public readonly statusChanged = new Signal<this, Kernel.Status>(this);
    public readonly connectionStatusChanged = new Signal<this, Kernel.ConnectionStatus>(this);
    public readonly iopubMessage = new Signal<this, IIOPubMessage<IOPubMessageType>>(this);
    public readonly unhandledMessage = new Signal<this, IMessage<MessageType>>(this);
    public readonly anyMessage = new Signal<this, Kernel.IAnyMessageArgs>(this);
    public get serverSettings() {
        return (this.possibleKernelConnection || this._previousKernelConnection).serverSettings;
    }
    public readonly disposed = new Signal<this, void>(this);
    /**
     * Use `kernelConnection` to access the value as its not a constant (can change over time).
     * E.g. when restarting kernels or the like.
     */
    private _kernelConnection!: Kernel.IKernelConnection;
    private readonly _previousKernelConnection: Kernel.IKernelConnection;
    // private _isRestarting?: boolean;
    private get possibleKernelConnection(): undefined | Kernel.IKernelConnection {
        if (this.kernel.session?.kernel === this._kernelConnection) {
            return this._kernelConnection;
        }
        this.stopHandlingKernelMessages(this._kernelConnection);
        if (this.kernel.session?.kernel) {
            this.startHandleKernelMessages(this.kernel.session.kernel);
            return this._kernelConnection;
        }
    }
    private getKernelConnection(): Kernel.IKernelConnection {
        if (!this.possibleKernelConnection) {
            throw new Error(
                `Kernel connection is not available, status = ${this.status}, connection = ${this.connectionStatus}`
            );
        }
        return this.possibleKernelConnection;
    }

    constructor(readonly kernel: IKernel, disposables: IDisposable[]) {
        const emiStatusChangeEvents = () => {
            this.statusChanged.emit(kernel.status);
            if (kernel.status === 'dead' && !kernel.disposed && !kernel.disposing) {
                this.connectionStatusChanged.emit('disconnected');
            }
        };
        kernel.onDisposed(
            () => {
                // this._isRestarting = false;
                emiStatusChangeEvents();
                this.disposed.emit();
            },
            this,
            disposables
        );
        kernel.onStarted(emiStatusChangeEvents, this, disposables);
        kernel.onRestarted(emiStatusChangeEvents, this, disposables);
        kernel.onStatusChanged(emiStatusChangeEvents, this, disposables);
        this._previousKernelConnection = kernel.session!.kernel!;
        this.startHandleKernelMessages(kernel.session!.kernel!);
        disposables.push(
            new Disposable(() => {
                if (this.possibleKernelConnection) {
                    this.stopHandlingKernelMessages(this.possibleKernelConnection);
                }
            })
        );
    }
    public get id(): string {
        return (this.possibleKernelConnection || this._previousKernelConnection).id;
    }
    public get name(): string {
        return (this.possibleKernelConnection || this._previousKernelConnection).name;
    }
    public get isDisposed(): boolean {
        return this.kernel.disposed;
    }

    public get model(): Kernel.IModel {
        return (this.possibleKernelConnection || this._previousKernelConnection).model;
    }
    public get username(): string {
        return (this.possibleKernelConnection || this._previousKernelConnection).username;
    }
    public get clientId(): string {
        return (this.possibleKernelConnection || this._previousKernelConnection).clientId;
    }
    public get status(): Kernel.Status {
        return this.possibleKernelConnection?.status || 'dead';
    }
    public get connectionStatus(): Kernel.ConnectionStatus {
        return this.possibleKernelConnection?.connectionStatus || 'disconnected';
    }
    public get info(): Promise<IInfoReply> {
        return (this.possibleKernelConnection || this._previousKernelConnection).info;
    }
    public get spec(): Promise<ISpecModel | undefined> {
        return (this.possibleKernelConnection || this._previousKernelConnection).spec;
    }
    public get handleComms(): boolean {
        return (this.possibleKernelConnection || this._previousKernelConnection).handleComms;
    }
    sendShellMessage<T extends ShellMessageType>(
        msg: IShellMessage<T>,
        expectReply?: boolean,
        disposeOnDone?: boolean
    ): Kernel.IShellFuture<IShellMessage<T>, IShellMessage<ShellMessageType>> {
        return this.getKernelConnection().sendShellMessage(msg, expectReply, disposeOnDone);
    }
    sendControlMessage<T extends ControlMessageType>(
        msg: IControlMessage<T>,
        expectReply?: boolean,
        disposeOnDone?: boolean
    ): Kernel.IControlFuture<IControlMessage<T>, IControlMessage<ControlMessageType>> {
        return this.getKernelConnection().sendControlMessage(msg, expectReply, disposeOnDone);
    }
    reconnect(): Promise<void> {
        return this.getKernelConnection().reconnect();
    }
    requestKernelInfo(): Promise<IInfoReplyMsg | undefined> {
        return this.getKernelConnection().requestKernelInfo();
    }
    requestComplete(content: { code: string; cursor_pos: number }): Promise<ICompleteReplyMsg> {
        return this.getKernelConnection().requestComplete(content);
    }
    requestInspect(content: { code: string; cursor_pos: number; detail_level: 0 | 1 }): Promise<IInspectReplyMsg> {
        return this.getKernelConnection().requestInspect(content);
    }
    requestHistory(
        content: IHistoryRequestRange | IHistoryRequestSearch | IHistoryRequestTail
    ): Promise<IHistoryReplyMsg> {
        return this.getKernelConnection().requestHistory(content);
    }
    requestExecute(
        content: {
            code: string;
            silent?: boolean | undefined;
            store_history?: boolean | undefined;
            user_expressions?: JSONObject | undefined;
            allow_stdin?: boolean | undefined;
            stop_on_error?: boolean | undefined;
        },
        disposeOnDone?: boolean,
        metadata?: JSONObject
    ): Kernel.IShellFuture<IExecuteRequestMsg, IExecuteReplyMsg> {
        return this.getKernelConnection().requestExecute(content, disposeOnDone, metadata);
    }
    requestDebug(
        content: {
            seq: number;
            type: 'request';
            command: string; // Licensed under the MIT License.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            arguments?: any;
        },
        disposeOnDone?: boolean
    ): Kernel.IControlFuture<IDebugRequestMsg, IDebugReplyMsg> {
        return this.getKernelConnection().requestDebug(content, disposeOnDone);
    }
    requestIsComplete(content: { code: string }): Promise<IIsCompleteReplyMsg> {
        return this.getKernelConnection().requestIsComplete(content);
    }
    requestCommInfo(content: { target_name?: string | undefined }): Promise<ICommInfoReplyMsg> {
        return this.getKernelConnection().requestCommInfo(content);
    }
    sendInputReply(content: IReplyErrorContent | IReplyAbortContent | IInputReply): void {
        return this.getKernelConnection().sendInputReply(content);
    }
    createComm(targetName: string, commId?: string): Kernel.IComm {
        return this.getKernelConnection().createComm(targetName, commId);
    }
    hasComm(commId: string): boolean {
        return this.getKernelConnection().hasComm(commId);
    }
    registerCommTarget(
        targetName: string,
        callback: (comm: Kernel.IComm, msg: ICommOpenMsg<'iopub' | 'shell'>) => void | PromiseLike<void>
    ): void {
        return this.getKernelConnection().registerCommTarget(targetName, callback);
    }
    removeCommTarget(
        targetName: string,
        callback: (comm: Kernel.IComm, msg: ICommOpenMsg<'iopub' | 'shell'>) => void | PromiseLike<void>
    ): void {
        return this.getKernelConnection().removeCommTarget(targetName, callback);
    }
    registerMessageHook(
        msgId: string,
        hook: (msg: IIOPubMessage<IOPubMessageType>) => boolean | PromiseLike<boolean>
    ): void {
        return this.getKernelConnection().registerMessageHook(msgId, hook);
    }
    removeMessageHook(
        msgId: string,
        hook: (msg: IIOPubMessage<IOPubMessageType>) => boolean | PromiseLike<boolean>
    ): void {
        return this.getKernelConnection().removeMessageHook(msgId, hook);
    }
    async shutdown(): Promise<void> {
        if (
            this.kernel.kernelConnectionMetadata.kind === 'startUsingRemoteKernelSpec' ||
            this.kernel.kernelConnectionMetadata.kind === 'connectToLiveKernel'
        ) {
            await this.kernel.session?.shutdown();
        }
        await this.kernel.dispose();
    }
    clone(
        _options?: Pick<Kernel.IKernelConnection.IOptions, 'clientId' | 'username' | 'handleComms'>
    ): Kernel.IKernelConnection {
        throw new Error('Method not implemented.');
    }
    dispose(): void {
        void this.kernel.dispose();
    }
    async interrupt(): Promise<void> {
        // Sometimes we end up starting a new session.
        // Hence assume a new session was created, meaning we need to bind to the kernel connection all over again.
        this.stopHandlingKernelMessages(this.possibleKernelConnection!);

        await this.kernel.interrupt();

        if (!this.kernel.session?.kernel) {
            throw new Error('Restart failed');
        }
        this.startHandleKernelMessages(this.kernel.session?.kernel);
    }
    async restart(): Promise<void> {
        if (this.possibleKernelConnection) {
            this.stopHandlingKernelMessages(this.possibleKernelConnection);
        }

        // If this is a remote, then we do something special.
        await this.kernel.restart();

        if (!this.kernel.session?.kernel) {
            throw new Error('Restart failed');
        }
        this.startHandleKernelMessages(this.kernel.session?.kernel);
    }
    private startHandleKernelMessages(kernelConnection: Kernel.IKernelConnection) {
        this._kernelConnection = kernelConnection;
        kernelConnection.anyMessage.connect(this.onAnyMessage, this);
        kernelConnection.iopubMessage.connect(this.onIOPubMessage, this);
        kernelConnection.unhandledMessage.connect(this.onUnhandledMessage, this);
    }
    private stopHandlingKernelMessages(kernelConnection: Kernel.IKernelConnection) {
        kernelConnection.anyMessage.disconnect(this.onAnyMessage, this);
        kernelConnection.iopubMessage.disconnect(this.onIOPubMessage, this);
        kernelConnection.unhandledMessage.disconnect(this.onUnhandledMessage, this);
    }
    private onAnyMessage(connection: Kernel.IKernelConnection, msg: Kernel.IAnyMessageArgs) {
        if (connection === this.possibleKernelConnection) {
            this.anyMessage.emit(msg);
        }
    }
    private onIOPubMessage(connection: Kernel.IKernelConnection, msg: IIOPubMessage) {
        if (connection === this.possibleKernelConnection) {
            this.iopubMessage.emit(msg);
        }
    }
    private onUnhandledMessage(connection: Kernel.IKernelConnection, msg: IMessage<MessageType>) {
        if (connection === this.possibleKernelConnection) {
            this.unhandledMessage.emit(msg);
        }
    }
}
