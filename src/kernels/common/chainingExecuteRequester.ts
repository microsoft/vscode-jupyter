// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { JSONObject } from '@lumino/coreutils';
import type { Kernel, KernelMessage } from '@jupyterlab/services';
import { DelayedFutureExecute } from './delayedFutureExecute';

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
        // There is no need to queue the requests we send out (i.e. hidden requests, that are not directly sent by the user).
        // I.e. where possible we shouldn't have to queue requests unnecessarily.
        // Ensures we don't run into situations where we're waiting for a previous request to complete, which could result in a dead lock.
        // See here for such an example https://github.com/microsoft/vscode-jupyter/issues/10510
        if (!content.store_history) {
            return kernel.requestExecute(content, disposeOnDone, metadata);
        }
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
