// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import type { JSONObject } from '@lumino/coreutils';
import type { Kernel, KernelMessage } from '@jupyterlab/services';
import { DelayedFutureExecute } from './delayedFutureExecute.node';

// Class that makes sure when doing a requestExecute on an IKernelConnection, that only one request happens
// at a time.
export class ChainingExecuteRequester {
    private previousExecute:
        | Kernel.IShellFuture<KernelMessage.IExecuteRequestMsg, KernelMessage.IExecuteReplyMsg>
        | undefined;
    private previousKernel: Kernel.IKernelConnection | undefined;
    public requestExecute(
        kernel: Kernel.IKernelConnection,
        content: KernelMessage.IExecuteRequestMsg['content'],
        disposeOnDone?: boolean,
        metadata?: JSONObject
    ): Kernel.IShellFuture<KernelMessage.IExecuteRequestMsg, KernelMessage.IExecuteReplyMsg> {
        // Wrap execute in a delay so we don't queue up more than one of these at a time.
        // Make sure for same kernel though. Otherwise the previous execute may never return.
        const nextExecute =
            this.previousExecute && this.previousKernel?.id === kernel.id
                ? new DelayedFutureExecute(kernel, this.previousExecute, content, disposeOnDone, metadata)
                : kernel.requestExecute(content, disposeOnDone, metadata);
        this.previousExecute = nextExecute;
        this.previousKernel = kernel;
        nextExecute.done
            .then(() => {
                if (this.previousExecute == nextExecute) {
                    this.previousExecute = undefined;
                    this.previousKernel = undefined;
                }
            })
            .catch(() => {
                if (this.previousExecute == nextExecute) {
                    this.previousExecute = undefined;
                    this.previousKernel = undefined;
                }
            });
        return nextExecute;
    }
}
