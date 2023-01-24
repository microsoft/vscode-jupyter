// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { JSONObject } from '@lumino/coreutils';
import type { Kernel, KernelMessage } from '@jupyterlab/services';
import { traceInfoIfCI } from '../../platform/logging';
import { createDeferred } from '../../platform/common/utils/async';
import { CancellationError } from 'vscode';
import { noop } from '../../platform/common/utils/misc';

// Wraps a future so that a requestExecute on a session will wait for the previous future to finish before actually executing
export class DelayedFutureExecute
    implements Kernel.IShellFuture<KernelMessage.IExecuteRequestMsg, KernelMessage.IExecuteReplyMsg>
{
    private doneDeferred = createDeferred<KernelMessage.IExecuteReplyMsg>();
    private requestFuture:
        | Kernel.IShellFuture<KernelMessage.IExecuteRequestMsg, KernelMessage.IExecuteReplyMsg>
        | undefined;
    private pendingOnReply: ((msg: KernelMessage.IExecuteReplyMsg) => void | PromiseLike<void>) | undefined;
    private pendingOnIOPub:
        | ((msg: KernelMessage.IIOPubMessage<KernelMessage.IOPubMessageType>) => void | PromiseLike<void>)
        | undefined;
    private pendingOnStdin:
        | ((msg: KernelMessage.IStdinMessage<KernelMessage.StdinMessageType>) => void | PromiseLike<void>)
        | undefined;
    private pendingHooks: ((
        msg: KernelMessage.IIOPubMessage<KernelMessage.IOPubMessageType>
    ) => boolean | PromiseLike<boolean>)[] = [];
    private pendingInputReplies: (
        | KernelMessage.IReplyErrorContent
        | KernelMessage.IReplyAbortContent
        | KernelMessage.IInputReply
    )[] = [];
    private disposed = false;
    private statusChangedHandler: (_session: Kernel.IKernelConnection, status: KernelMessage.Status) => void;
    constructor(
        private kernelConnection: Kernel.IKernelConnection,
        previousLink: Kernel.IShellFuture<KernelMessage.IExecuteRequestMsg, KernelMessage.IExecuteReplyMsg>,
        private content: KernelMessage.IExecuteRequestMsg['content'],
        private disposeOnDone?: boolean,
        private metadata?: JSONObject
    ) {
        // Ensure we don't have any unhandled promises.
        this.doneDeferred.promise.catch(noop);
        // Setup our request based on the previous link finishing
        previousLink.done.then(() => this.requestExecute()).catch((e) => this.doneDeferred.reject(e));

        // If the kernel dies, finish our future
        this.statusChangedHandler = (_session: Kernel.IKernelConnection, status: KernelMessage.Status) => {
            if (status === 'unknown' || status === 'restarting' || status === 'dead' || status === 'autorestarting') {
                this.doneDeferred.reject(new CancellationError());
            }
        };
        kernelConnection.statusChanged?.connect(this.statusChangedHandler);

        // Run the handler now to check
        this.statusChangedHandler(kernelConnection, kernelConnection.status);
    }
    public get msg(): KernelMessage.IExecuteRequestMsg {
        if (this.requestFuture) {
            return this.requestFuture.msg;
        }
        return {
            content: this.content,
            channel: 'shell',
            header: {
                date: Date.now.toString(),
                msg_id: '1',
                session: this.kernelConnection.id,
                msg_type: 'execute_request',
                username: '',
                version: '1'
            },
            parent_header: {},
            metadata: {}
        };
    }
    public get done(): Promise<KernelMessage.IExecuteReplyMsg> {
        return this.doneDeferred.promise;
    }
    public set onReply(value: (msg: KernelMessage.IExecuteReplyMsg) => void | PromiseLike<void>) {
        if (this.requestFuture) {
            this.requestFuture.onReply = value;
        } else {
            this.pendingOnReply = value;
        }
    }
    public set onIOPub(
        value: (msg: KernelMessage.IIOPubMessage<KernelMessage.IOPubMessageType>) => void | PromiseLike<void>
    ) {
        if (this.requestFuture) {
            this.requestFuture.onIOPub = value;
        } else {
            this.pendingOnIOPub = value;
        }
    }
    public set onStdin(
        value: (msg: KernelMessage.IStdinMessage<KernelMessage.StdinMessageType>) => void | PromiseLike<void>
    ) {
        if (this.requestFuture) {
            this.requestFuture.onStdin = value;
        } else {
            this.pendingOnStdin = value;
        }
    }
    public registerMessageHook(
        hook: (msg: KernelMessage.IIOPubMessage<KernelMessage.IOPubMessageType>) => boolean | PromiseLike<boolean>
    ): void {
        if (this.requestFuture) {
            this.requestFuture.registerMessageHook(hook);
        } else {
            this.pendingHooks.push(hook);
        }
    }
    public removeMessageHook(
        hook: (msg: KernelMessage.IIOPubMessage<KernelMessage.IOPubMessageType>) => boolean | PromiseLike<boolean>
    ): void {
        this.pendingHooks = this.pendingHooks.filter((h) => h != hook);
        if (this.requestFuture) {
            this.requestFuture.removeMessageHook(hook);
        }
    }
    public sendInputReply(
        content: KernelMessage.IReplyErrorContent | KernelMessage.IReplyAbortContent | KernelMessage.IInputReply
    ): void {
        if (this.requestFuture) {
            this.requestFuture.sendInputReply(content);
        } else {
            this.pendingInputReplies.push(content);
        }
    }
    public get isDisposed(): boolean {
        return this.disposed;
    }
    dispose(): void {
        this.disposed = true;
        this.kernelConnection.statusChanged.disconnect(this.statusChangedHandler);
        if (this.requestFuture) {
            this.requestFuture.dispose();
            this.requestFuture = undefined;
            this.clear();
        }
    }

    private clear(): void {
        this.pendingInputReplies = [];
        this.pendingHooks = [];
        this.pendingOnReply = undefined;
        this.pendingOnIOPub = undefined;
        this.pendingOnStdin = undefined;
    }

    private requestExecute() {
        if (this.requestFuture) {
            throw new Error(`ChainedFuture already executed. Can't execute more than once.`);
        }
        traceInfoIfCI(`DelayedFuture is starting request now for ${this.content}.`);
        this.requestFuture = this.kernelConnection.requestExecute(this.content, this.disposeOnDone, this.metadata);
        if (this.requestFuture) {
            if (this.pendingOnReply) {
                this.requestFuture.onReply = this.pendingOnReply;
            }
            if (this.pendingOnIOPub) {
                this.requestFuture.onIOPub = this.pendingOnIOPub;
            }
            if (this.pendingOnStdin) {
                this.requestFuture.onStdin = this.pendingOnStdin;
            }
            if (this.pendingHooks.length) {
                this.pendingHooks.forEach((h) => this.requestFuture?.registerMessageHook(h));
            }
            if (this.pendingInputReplies) {
                this.pendingInputReplies.forEach((r) => this.requestFuture?.sendInputReply(r));
            }
            this.requestFuture.done.then((r) => this.doneDeferred.resolve(r)).catch((e) => this.doneDeferred.reject(e));
            this.clear();
        }
    }
}
