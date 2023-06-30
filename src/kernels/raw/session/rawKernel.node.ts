// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Kernel, KernelSpec, KernelMessage, ServerConnection } from '@jupyterlab/services';
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
import cloneDeep from 'lodash/cloneDeep';
import uuid from 'uuid/v4';
import { traceError, traceInfo } from '../../../platform/logging';
import { IDisposable } from '../../../platform/common/types';
import { swallowExceptions } from '../../../platform/common/utils/misc';
import { getNameOfKernelConnection, isUserRegisteredKernelSpecConnection } from '../../../kernels/helpers';
import { IWebSocketLike } from '../../common/kernelSocketWrapper';
import { IKernelProcess } from '../types';
import { RawSocket } from './rawSocket.node';
import { IKernelSocket } from '../../types';
import { suppressShutdownErrors } from '../../common/shutdownHelper';
import { Signal } from '@lumino/signaling';
import type { IIOPubMessage, IMessage, IOPubMessageType, MessageType } from '@jupyterlab/services/lib/kernel/messages';

/*
RawKernel class represents the mapping from the JupyterLab services IKernel interface
to a raw IPython kernel running on the local machine. RawKernel is in charge of taking
input request, translating them, sending them to an IPython kernel over ZMQ, then passing back the messages
*/
export class RawKernel implements Kernel.IKernelConnection {
    public socket: IKernelSocket & IDisposable;
    public readonly statusChanged = new Signal<this, Kernel.Status>(this);
    public readonly connectionStatusChanged = new Signal<this, Kernel.ConnectionStatus>(this);
    public readonly iopubMessage = new Signal<this, IIOPubMessage<IOPubMessageType>>(this);
    public readonly unhandledMessage = new Signal<this, IMessage<MessageType>>(this);
    public readonly anyMessage = new Signal<this, Kernel.IAnyMessageArgs>(this);
    public readonly disposed = new Signal<this, void>(this);
    public get connectionStatus() {
        return this.realKernel.connectionStatus;
    }
    public get serverSettings(): ServerConnection.ISettings {
        return this.realKernel.serverSettings;
    }
    public get id(): string {
        return this.realKernel.id;
    }
    public get name(): string {
        return this.realKernel.name;
    }
    public get model(): Kernel.IModel {
        return this.realKernel.model;
    }
    public get username(): string {
        return this.realKernel.username;
    }
    public get clientId(): string {
        return this.realKernel.clientId;
    }
    public get status(): KernelMessage.Status {
        return this.realKernel.status;
    }
    public get info() {
        return this.realKernel.info;
    }
    public get handleComms(): boolean {
        return this.realKernel.handleComms;
    }
    public get isDisposed(): boolean {
        return this.realKernel.isDisposed;
    }
    constructor(
        private realKernel: Kernel.IKernelConnection,
        socket: IKernelSocket & IWebSocketLike & IDisposable,
        private kernelProcess: IKernelProcess
    ) {
        // Save this raw socket as our kernel socket. It will be
        // used to watch and respond to kernel messages.
        this.socket = socket;
        this.startHandleKernelMessages();
        // Pretend like an open occurred. This will prime the real kernel to be connected
        socket.emit('open');
    }
    public createComm(targetName: string, commId?: string): Kernel.IComm {
        return this.realKernel.createComm(targetName, commId);
    }
    public hasComm(commId: string): boolean {
        return this.realKernel.hasComm(commId);
    }
    public clone(
        options?: Pick<Kernel.IKernelConnection.IOptions, 'clientId' | 'username' | 'handleComms'>
    ): Kernel.IKernelConnection {
        return createRawKernel(this.kernelProcess, options?.clientId || this.clientId);
    }

    public async shutdown(): Promise<void> {
        suppressShutdownErrors(this.realKernel);
        await this.kernelProcess.dispose();
        this.socket.dispose();
        this.stopHandlingKernelMessages();
    }
    public get spec(): Promise<KernelSpec.ISpecModel | undefined> {
        if (isUserRegisteredKernelSpecConnection(this.kernelProcess.kernelConnectionMetadata)) {
            const kernelSpec = cloneDeep(this.kernelProcess.kernelConnectionMetadata.kernelSpec) as any;
            const resources = 'resources' in kernelSpec ? kernelSpec.resources : {};
            return {
                ...kernelSpec,
                resources
            };
        }
        traceError('Fetching kernel spec from raw kernel using JLab API');
        return this.realKernel.spec;
    }
    public sendShellMessage<T extends KernelMessage.ShellMessageType>(
        msg: KernelMessage.IShellMessage<T>,
        expectReply?: boolean,
        disposeOnDone?: boolean
    ): Kernel.IShellFuture<
        KernelMessage.IShellMessage<T>,
        KernelMessage.IShellMessage<KernelMessage.ShellMessageType>
    > {
        return this.realKernel.sendShellMessage(msg, expectReply, disposeOnDone);
    }
    public sendControlMessage<T extends KernelMessage.ControlMessageType>(
        msg: KernelMessage.IControlMessage<T>,
        expectReply?: boolean,
        disposeOnDone?: boolean
    ): Kernel.IControlFuture<
        KernelMessage.IControlMessage<T>,
        KernelMessage.IControlMessage<KernelMessage.ControlMessageType>
    > {
        return this.realKernel.sendControlMessage(msg, expectReply, disposeOnDone);
    }
    public reconnect(): Promise<void> {
        throw new Error('Reconnect is not supported.');
    }
    public async interrupt(): Promise<void> {
        // Send a kernel interrupt request to the real process only for our python kernels.

        // Send this directly to our kernel process. Don't send it through the real kernel. The
        // real kernel will send a goofy API request to the websocket.
        if (this.kernelProcess.canInterrupt) {
            return this.kernelProcess.interrupt();
        } else if (this.kernelProcess.kernelConnectionMetadata.kernelSpec.interrupt_mode === 'message') {
            traceInfo(`Interrupting kernel with a shell message`);
            const jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services');
            const msg = jupyterLab.KernelMessage.createMessage({
                msgType: 'interrupt_request' as any,
                channel: 'shell',
                username: this.realKernel.username,
                session: this.realKernel.clientId,
                content: {}
            }) as any as KernelMessage.IShellMessage<'inspect_request'>;
            await this.realKernel
                .sendShellMessage<'interrupt_request'>(msg as any, true, true)
                .done.catch((ex) => traceError('Failed to interrupt via a message', ex));
        } else {
            traceError('Kernel interrupt not supported');
        }
    }
    public restart(): Promise<void> {
        throw new Error('This method should not be called. Restart is implemented at a higher level');
    }
    public requestKernelInfo() {
        return this.realKernel.requestKernelInfo();
    }
    public requestComplete(content: { code: string; cursor_pos: number }): Promise<KernelMessage.ICompleteReplyMsg> {
        return this.realKernel.requestComplete(content);
    }
    public requestInspect(content: {
        code: string;
        cursor_pos: number;
        detail_level: 0 | 1;
    }): Promise<KernelMessage.IInspectReplyMsg> {
        return this.realKernel.requestInspect(content);
    }
    public requestHistory(
        content:
            | KernelMessage.IHistoryRequestRange
            | KernelMessage.IHistoryRequestSearch
            | KernelMessage.IHistoryRequestTail
    ): Promise<KernelMessage.IHistoryReplyMsg> {
        return this.realKernel.requestHistory(content);
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
        return this.realKernel.requestExecute(content, disposeOnDone, metadata);
    }
    public requestDebug(
        // eslint-disable-next-line no-caller,no-eval
        content: { seq: number; type: 'request'; command: string; arguments?: any },
        disposeOnDone?: boolean
    ): Kernel.IControlFuture<KernelMessage.IDebugRequestMsg, KernelMessage.IDebugReplyMsg> {
        return this.realKernel.requestDebug(content, disposeOnDone);
    }
    public requestIsComplete(content: { code: string }): Promise<KernelMessage.IIsCompleteReplyMsg> {
        return this.realKernel.requestIsComplete(content);
    }
    public requestCommInfo(content: {
        target_name?: string;
        target?: string;
    }): Promise<KernelMessage.ICommInfoReplyMsg> {
        return this.realKernel.requestCommInfo(content);
    }
    public sendInputReply(content: KernelMessage.IInputReplyMsg['content']): void {
        return this.realKernel.sendInputReply(content);
    }
    public registerCommTarget(
        targetName: string,
        callback: (comm: Kernel.IComm, msg: KernelMessage.ICommOpenMsg) => void | PromiseLike<void>
    ): void {
        return this.realKernel.registerCommTarget(targetName, callback);
    }
    public removeCommTarget(
        targetName: string,
        callback: (comm: Kernel.IComm, msg: KernelMessage.ICommOpenMsg) => void | PromiseLike<void>
    ): void {
        return this.realKernel.removeCommTarget(targetName, callback);
    }
    public dispose(): void {
        swallowExceptions(() => this.realKernel.dispose());
        swallowExceptions(() => this.socket.dispose());
    }
    public registerMessageHook(
        msgId: string,
        hook: (msg: KernelMessage.IIOPubMessage) => boolean | PromiseLike<boolean>
    ): void {
        this.realKernel.registerMessageHook(msgId, hook);
    }
    public removeMessageHook(
        msgId: string,
        hook: (msg: KernelMessage.IIOPubMessage) => boolean | PromiseLike<boolean>
    ): void {
        this.realKernel.removeMessageHook(msgId, hook);
    }
    private startHandleKernelMessages() {
        this.realKernel.anyMessage.connect(this.onAnyMessage, this);
        this.realKernel.iopubMessage.connect(this.onIOPubMessage, this);
        this.realKernel.unhandledMessage.connect(this.onUnhandledMessage, this);
        this.realKernel.statusChanged.connect(this.onStatusChanged, this);
        this.realKernel.disposed.connect(this.onDisposed, this);
    }
    private stopHandlingKernelMessages() {
        this.realKernel.anyMessage.disconnect(this.onAnyMessage, this);
        this.realKernel.iopubMessage.disconnect(this.onIOPubMessage, this);
        this.realKernel.unhandledMessage.disconnect(this.onUnhandledMessage, this);
        this.realKernel.statusChanged.disconnect(this.onStatusChanged, this);
        this.realKernel.disposed.disconnect(this.onDisposed, this);
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

let nonSerializingKernel: typeof import('@jupyterlab/services/lib/kernel/default');

export function createRawKernel(kernelProcess: IKernelProcess, clientId: string): RawKernel {
    const jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services'); // NOSONAR
    const jupyterLabSerialize =
        require('@jupyterlab/services/lib/kernel/serialize') as typeof import('@jupyterlab/services/lib/kernel/serialize'); // NOSONAR

    // Dummy websocket we give to the underlying real kernel
    let socketInstance: any;
    class RawSocketWrapper extends RawSocket {
        constructor() {
            super(kernelProcess.connection, jupyterLabSerialize.serialize, jupyterLabSerialize.deserialize);
            socketInstance = this;
        }
    }

    // Remap the server settings for the real kernel to use our dummy websocket
    const settings = jupyterLab.ServerConnection.makeSettings({
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
            id: uuid()
        }
    });

    // Use this real kernel in result.
    return new RawKernel(realKernel, socketInstance, kernelProcess);
}
