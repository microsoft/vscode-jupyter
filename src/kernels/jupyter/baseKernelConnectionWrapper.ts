// Copyright (c) Microsoft Corporation.
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
import type { ISpecModel } from '@jupyterlab/services/lib/kernelspec/restapi';
import type { JSONObject } from '@lumino/coreutils';
import { Signal } from '@lumino/signaling';
import { Disposable } from 'vscode';
import { IDisposable } from '../../platform/common/types';
import { ChainingExecuteRequester } from '../common/chainingExecuteRequester';

/**
 * Wrapper around a Kernel.IKernelConnection.
 */
export abstract class BaseKernelConnectionWrapper implements Kernel.IKernelConnection {
    private chainingExecute = new ChainingExecuteRequester();
    public readonly statusChanged = new Signal<this, Kernel.Status>(this);
    public readonly connectionStatusChanged = new Signal<this, Kernel.ConnectionStatus>(this);
    public readonly iopubMessage = new Signal<this, IIOPubMessage<IOPubMessageType>>(this);
    public readonly unhandledMessage = new Signal<this, IMessage<MessageType>>(this);
    public readonly anyMessage = new Signal<this, Kernel.IAnyMessageArgs>(this);
    public get serverSettings() {
        return (this.possibleKernelConnection || this._previousKernelConnection).serverSettings;
    }
    public readonly disposed = new Signal<this, void>(this);
    // private _isRestarting?: boolean;
    protected abstract get possibleKernelConnection(): undefined | Kernel.IKernelConnection;
    private getKernelConnection(): Kernel.IKernelConnection {
        if (!this.possibleKernelConnection) {
            throw new Error(
                `Kernel connection is not available, status = ${this.status}, connection = ${this.connectionStatus}`
            );
        }
        return this.possibleKernelConnection;
    }
    public readonly originalKernel: Kernel.IKernelConnection;

    constructor(
        private _previousKernelConnection: Kernel.IKernelConnection,
        disposables: IDisposable[]
    ) {
        this.originalKernel = _previousKernelConnection;
        this.startHandleKernelMessages(_previousKernelConnection);
        disposables.push(
            new Disposable(() => {
                if (this.possibleKernelConnection) {
                    this.stopHandlingKernelMessages(this.possibleKernelConnection);
                }
            })
        );
    }
    abstract shutdown(): Promise<void>;
    abstract dispose(): void;
    abstract interrupt(): Promise<void>;
    abstract restart(): Promise<void>;

    public get id(): string {
        return (this.possibleKernelConnection || this._previousKernelConnection).id;
    }
    public get name(): string {
        return (this.possibleKernelConnection || this._previousKernelConnection).name;
    }
    public get isDisposed(): boolean {
        return this.possibleKernelConnection ? this.possibleKernelConnection?.isDisposed === true : true;
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
        return this.chainingExecute.requestExecute(this.getKernelConnection(), content, disposeOnDone, metadata);
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

    clone(
        _options?: Pick<Kernel.IKernelConnection.IOptions, 'clientId' | 'username' | 'handleComms'>
    ): Kernel.IKernelConnection {
        throw new Error('Method not implemented.');
    }
    protected startHandleKernelMessages(kernelConnection: Kernel.IKernelConnection) {
        kernelConnection.anyMessage.connect(this.onAnyMessage, this);
        kernelConnection.iopubMessage.connect(this.onIOPubMessage, this);
        kernelConnection.unhandledMessage.connect(this.onUnhandledMessage, this);
    }
    protected stopHandlingKernelMessages(kernelConnection: Kernel.IKernelConnection) {
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
