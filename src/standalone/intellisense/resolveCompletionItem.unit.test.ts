// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import uuid from 'uuid/v4';
import * as fakeTimers from '@sinonjs/fake-timers';
import { Kernel } from '@jupyterlab/services';
import { anything, instance, mock, reset, verify, when } from 'ts-mockito';
import { IKernel, IKernelSession, KernelConnectionMetadata } from '../../kernels/types';
import { createMockedDocument } from '../../test/datascience/editor-integration/helpers';
import {
    CancellationToken,
    CancellationTokenSource,
    CompletionItem,
    Disposable,
    Position,
    Range,
    TextDocument,
    Uri
} from 'vscode';
import { MAX_ATTEMPTS_BEFORE_IGNORING_RESOLVE_COMPLETION, resolveCompletionItem } from './resolveCompletionItem';
import { IDisposable } from '../../platform/common/types';
import { DisposableStore, dispose } from '../../platform/common/utils/lifecycle';
import { createDeferred } from '../../platform/common/utils/async';
import { IInspectReplyMsg } from '@jupyterlab/services/lib/kernel/messages';
import { sleep } from '../../test/core';

suite('Jupyter Kernel Completion (requestInspect)', () => {
    let kernel: IKernel;
    let kernelId = '';
    let kernelConnection: Kernel.IKernelConnection;
    let document: TextDocument;
    let completionItem: CompletionItem;
    let token: CancellationToken;
    let tokenSource: CancellationTokenSource;
    let disposables: IDisposable[] = [];
    let toDispose: DisposableStore;
    let clock: fakeTimers.InstalledClock;
    setup(() => {
        kernelConnection = mock<Kernel.IKernelConnection>();
        kernel = mock<IKernel>();
        kernelId = uuid();
        when(kernel.id).thenReturn(kernelId);
        const kernelConnectionMetadata = mock<KernelConnectionMetadata>();
        when(kernel.kernelConnectionMetadata).thenReturn(instance(kernelConnectionMetadata));
        when(kernelConnectionMetadata.id).thenReturn(kernelId);
        const session = mock<IKernelSession>();
        when(kernel.session).thenReturn(instance(session));
        when(session.kernel).thenReturn(instance(kernelConnection));
        document = createMockedDocument('foo.', Uri.parse('a.ipynb'), 1, true);

        tokenSource = new CancellationTokenSource();
        token = tokenSource.token;
        toDispose = new DisposableStore();

        clock = fakeTimers.install();

        disposables.push(new Disposable(() => clock.uninstall()));
        disposables.push(tokenSource);
        disposables.push(toDispose);
    });

    teardown(() => {
        disposables = dispose(disposables);
    });
    test('Return the same item if kernel is not idle', async () => {
        completionItem = new CompletionItem('One');
        completionItem.range = new Range(0, 4, 0, 4);

        const statuses: Kernel.Status[] = [
            'busy',
            'starting',
            'restarting',
            'dead',
            'autorestarting',
            'dead',
            'terminating',
            'unknown'
        ];

        for (const status of statuses) {
            when(kernel.status).thenReturn(status);
            const result = await resolveCompletionItem(
                completionItem,
                token,
                instance(kernel),
                kernelId,
                'python',
                document,
                new Position(0, 4),
                toDispose
            );

            assert.strictEqual(result.documentation, completionItem.documentation);
        }
    });
    test('Return the same item if cancelled', async () => {
        completionItem = new CompletionItem('One');
        completionItem.range = new Range(0, 4, 0, 4);
        when(kernel.status).thenReturn('idle');
        const deferred = createDeferred<IInspectReplyMsg>();
        deferred.resolve({
            channel: 'shell',
            content: {
                status: 'ok',
                data: {
                    'text/plain': 'Some documentation'
                },
                found: true,
                metadata: {}
            },
            header: {} as any,
            metadata: {} as any,
            parent_header: {} as any
        });
        // Resolve the response 2s later
        when(kernelConnection.requestInspect(anything())).thenReturn(
            sleep(2000, disposables).then(() => deferred.promise)
        );

        const resultPromise = resolveCompletionItem(
            completionItem,
            token,
            instance(kernel),
            kernelId,
            'python',
            document,
            new Position(0, 4),
            toDispose
        );
        // Cancel the request 1s later
        void sleep(1000, disposables).then(() => tokenSource.cancel());
        const [result] = await Promise.all([resultPromise, clock.tickAsync(5_000)]);
        assert.isUndefined(result.documentation);
    });
    test('Return the sam item if kernel does not reply in time', async () => {
        completionItem = new CompletionItem('One');
        completionItem.range = new Range(0, 4, 0, 4);
        when(kernel.status).thenReturn('idle');
        const deferred = createDeferred<IInspectReplyMsg>();
        when(kernelConnection.requestInspect(anything())).thenReturn(deferred.promise);

        const resultPromise = resolveCompletionItem(
            completionItem,
            token,
            instance(kernel),
            kernelId,
            'python',
            document,
            new Position(0, 4),
            toDispose
        );

        const [result] = await Promise.all([resultPromise, clock.tickAsync(5_000)]);

        assert.strictEqual(result.documentation, completionItem.documentation);
        verify(kernelConnection.requestInspect(anything())).once();
    });
    test('Resolve the documentation', async () => {
        completionItem = new CompletionItem('One');
        completionItem.range = new Range(0, 4, 0, 4);
        when(kernel.status).thenReturn('idle');
        const deferred = createDeferred<IInspectReplyMsg>();
        deferred.resolve({
            channel: 'shell',
            content: {
                status: 'ok',
                data: {
                    'text/plain': 'Some documentation'
                },
                found: true,
                metadata: {}
            },
            header: {} as any,
            metadata: {} as any,
            parent_header: {} as any
        });
        when(kernelConnection.requestInspect(anything())).thenReturn(deferred.promise);

        const resultPromise = resolveCompletionItem(
            completionItem,
            token,
            instance(kernel),
            kernelId,
            'python',
            document,
            new Position(0, 4),
            toDispose
        );
        const [result] = await Promise.all([resultPromise, clock.tickAsync(5_000)]);
        assert.strictEqual(result.documentation, 'Some documentation');
    });
    test('Resolve the documentation, even if it takes a few ms (less than timeout)', async () => {
        completionItem = new CompletionItem('One');
        completionItem.range = new Range(0, 4, 0, 4);
        when(kernel.status).thenReturn('idle');
        const deferred = createDeferred<IInspectReplyMsg>();
        deferred.resolve({
            channel: 'shell',
            content: {
                status: 'ok',
                data: {
                    'text/plain': 'Some documentation'
                },
                found: true,
                metadata: {}
            },
            header: {} as any,
            metadata: {} as any,
            parent_header: {} as any
        });
        when(kernelConnection.requestInspect(anything())).thenReturn(sleep(1000).then(() => deferred.promise));

        const resultPromise = resolveCompletionItem(
            completionItem,
            token,
            instance(kernel),
            kernelId,
            'python',
            document,
            new Position(0, 4),
            toDispose
        );
        const [result] = await Promise.all([resultPromise, clock.tickAsync(5_000)]);
        assert.strictEqual(result.documentation, 'Some documentation');
    });
    test('Never make any requests if we fail to get a response n times', async () => {
        completionItem = new CompletionItem('One');
        completionItem.range = new Range(0, 4, 0, 4);
        when(kernel.status).thenReturn('idle');
        const deferred = createDeferred<IInspectReplyMsg>();
        when(kernelConnection.requestInspect(anything())).thenReturn(deferred.promise);

        for (let index = 0; index < MAX_ATTEMPTS_BEFORE_IGNORING_RESOLVE_COMPLETION; index++) {
            const resultPromise = resolveCompletionItem(
                completionItem,
                token,
                instance(kernel),
                kernelId,
                'python',
                document,
                new Position(0, 4),
                toDispose
            );
            const [result] = await Promise.all([resultPromise, clock.tickAsync(5_000)]);
            assert.strictEqual(result.documentation, completionItem.documentation);
            verify(kernelConnection.requestInspect(anything())).atLeast(index + 1);
        }

        reset(kernelConnection);
        when(kernelConnection.requestInspect(anything())).thenReturn(deferred.promise);
        const resultPromise = resolveCompletionItem(
            completionItem,
            token,
            instance(kernel),
            kernelId,
            'python',
            document,
            new Position(0, 4),
            toDispose
        );
        const [result] = await Promise.all([resultPromise, clock.tickAsync(5_000)]);
        assert.strictEqual(result.documentation, completionItem.documentation);
        verify(kernelConnection.requestInspect(anything())).never();
    });
});
