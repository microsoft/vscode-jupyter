// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Kernel, KernelMessage } from '@jupyterlab/services';
import { assert } from 'chai';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { CancellationError, CancellationTokenSource } from 'vscode';
import { createDeferred } from '../platform/common/utils/async';
import { executeSilently } from './helpers';

suite('Silent Startup Execution Cancellation', () => {
    test('an already cancelled operation sends no execution request', async () => {
        const kernel = mock<Kernel.IKernelConnection>();
        const token = new CancellationTokenSource();
        token.cancel();
        try {
            const error = await executeSilently(instance(kernel), 'pass', undefined, token.token).then(
                () => undefined,
                (reason) => reason
            );
            assert.instanceOf(error, CancellationError);
            verify(kernel.requestExecute(anything(), anything())).never();
        } finally {
            token.dispose();
        }
    });

    test('cancelling an awaiting execution disposes its underlying future', async () => {
        const kernel = mock<Kernel.IKernelConnection>();
        const future = mock<Kernel.IShellFuture<KernelMessage.IExecuteRequestMsg, KernelMessage.IExecuteReplyMsg>>();
        const completed = createDeferred<KernelMessage.IExecuteReplyMsg>();
        const token = new CancellationTokenSource();
        let disposed = false;
        when(kernel.id).thenReturn('cancelled-startup-execution');
        when(kernel.requestExecute(anything(), anything())).thenReturn(instance(future));
        when(future.done).thenReturn(completed.promise);
        when(future.isDisposed).thenCall(() => disposed);
        when(future.dispose()).thenCall(() => {
            disposed = true;
            completed.reject(new CancellationError());
        });
        try {
            const operation = executeSilently(instance(kernel), 'pass', undefined, token.token).then(
                () => undefined,
                (reason) => reason
            );
            token.cancel();
            assert.instanceOf(await operation, CancellationError);
            assert.isTrue(disposed);
            verify(future.dispose()).once();
        } finally {
            token.dispose();
        }
    });
});
