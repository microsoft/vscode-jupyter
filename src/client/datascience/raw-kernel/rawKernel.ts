// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import type { Kernel, KernelSpec, KernelMessage, ServerConnection } from '@jupyterlab/services';
import { ISignal } from '@lumino/signaling';
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
import cloneDeep = require('lodash/cloneDeep');
import * as uuid from 'uuid/v4';
import { isTestExecution } from '../../common/constants';
import { traceError, traceInfo } from '../../common/logger';
import { IDisposable } from '../../common/types';
import { swallowExceptions } from '../../common/utils/misc';
import { getNameOfKernelConnection } from '../jupyter/kernels/helpers';
import { IKernelProcess } from '../kernel-launcher/types';
import { IWebSocketLike } from '../kernelSocketWrapper';
import { IKernelSocket } from '../types';
import { RawSocket } from './rawSocket';

export function suppressShutdownErrors(realKernel: any) {
    // When running under a test, mark all futures as done so we
    // don't hit this problem:
    // https://github.com/jupyterlab/jupyterlab/issues/4252
    /* eslint-disable @typescript-eslint/no-explicit-any */
    if (isTestExecution()) {
        const defaultKernel = realKernel as any; // NOSONAR
        if (defaultKernel && defaultKernel._futures) {
            const futures = defaultKernel._futures as Map<any, any>; // NOSONAR
            if (futures) {
                futures.forEach((f) => {
                    if (f._status !== undefined) {
                        f._status |= 4;
                    }
                });
            }
        }
        if (defaultKernel && defaultKernel._reconnectLimit) {
            defaultKernel._reconnectLimit = 0;
        }
    }
}

/*
RawKernel class represents the mapping from the JupyterLab services IKernel interface
to a raw IPython kernel running on the local machine. RawKernel is in charge of taking
input request, translating them, sending them to an IPython kernel over ZMQ, then passing back the messages
*/
export class RawKernel implements Kernel.IKernelConnection {
    public socket: IKernelSocket & IDisposable;
    public get statusChanged() {
        return this.realKernel.statusChanged as any; // NOSONAR
    }
    public get iopubMessage() {
        return this.realKernel.iopubMessage as any; // NOSONAR
    }
    public get unhandledMessage() {
        return this.realKernel.unhandledMessage as any; // NOSONAR
    }
    public get connectionStatusChanged() {
        return this.realKernel.connectionStatusChanged as any; // NOSONAR
    }
    public get connectionStatus() {
        return this.realKernel.connectionStatus;
    }
    public get anyMessage() {
        return this.realKernel.anyMessage as any; // NOSONAR
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
    public get disposed(): ISignal<this, void> {
        return this.realKernel.disposed as any; // NOSONAR
    }

    public async shutdown(): Promise<void> {
        suppressShutdownErrors(this.realKernel);
        await this.kernelProcess.dispose();
        this.socket.dispose();
    }
    public get spec(): Promise<KernelSpec.ISpecModel | undefined> {
        if (this.kernelProcess.kernelConnectionMetadata.kind === 'startUsingKernelSpec') {
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
            const msg = (jupyterLab.KernelMessage.createMessage({
                msgType: 'interrupt_request' as any,
                channel: 'shell',
                username: this.realKernel.username,
                session: this.realKernel.clientId,
                content: {}
            }) as any) as KernelMessage.IShellMessage<'inspect_request'>;
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
}

let nonSerializingKernel: typeof import('@jupyterlab/services/lib/kernel/default');

export function createRawKernel(kernelProcess: IKernelProcess, clientId: string): RawKernel {
    const jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services'); // NOSONAR
    const jupyterLabSerialize = require('@jupyterlab/services/lib/kernel/serialize') as typeof import('@jupyterlab/services/lib/kernel/serialize'); // NOSONAR

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
        nonSerializingKernel = require('@jupyterlab/services/lib/kernel/nonSerializingKernel') as typeof import('@jupyterlab/services/lib/kernel/default'); // NOSONAR
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
