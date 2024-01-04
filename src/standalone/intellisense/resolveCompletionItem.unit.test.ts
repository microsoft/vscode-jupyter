// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { Signal } from '@lumino/signaling';
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
    MarkdownString,
    Position,
    Range,
    TextDocument,
    Uri
} from 'vscode';
import { MAX_PENDING_REQUESTS, resolveCompletionItem } from './resolveCompletionItem';
import { IDisposable } from '../../platform/common/types';
import { DisposableStore, dispose } from '../../platform/common/utils/lifecycle';
import { Deferred, createDeferred } from '../../platform/common/utils/async';
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
        const kernelStatusChangedSignal = new Signal<Kernel.IKernelConnection, Kernel.Status>(
            instance(kernelConnection)
        );
        when(kernelConnection.statusChanged).thenReturn(kernelStatusChangedSignal);
        document = createMockedDocument('foo.', Uri.parse('a.ipynb'), 1, true);

        tokenSource = new CancellationTokenSource();
        token = tokenSource.token;
        toDispose = new DisposableStore();

        clock = fakeTimers.install();

        disposables.push(new Disposable(() => clock.uninstall()));
        disposables.push(new Disposable(() => Signal.disconnectAll(instance(kernelConnection))));
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
                undefined,
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
            undefined,
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
    test('Return the same item if kernel does not reply in time (test timeout)', async () => {
        completionItem = new CompletionItem('One');
        completionItem.range = new Range(0, 4, 0, 4);
        when(kernel.status).thenReturn('idle');
        const deferred = createDeferred<IInspectReplyMsg>();
        when(kernelConnection.requestInspect(anything())).thenReturn(deferred.promise);

        const resultPromise = resolveCompletionItem(
            completionItem,
            undefined,
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
            undefined,
            token,
            instance(kernel),
            kernelId,
            'python',
            document,
            new Position(0, 4),
            toDispose
        );
        const [result] = await Promise.all([resultPromise, clock.tickAsync(5_000)]);
        assert.strictEqual((result.documentation as MarkdownString).value, 'Some documentation');
    });
    test('Resolve & leave documentation as is when nothing is returned from the kernel', async () => {
        completionItem = new CompletionItem('One');
        completionItem.range = new Range(0, 4, 0, 4);
        when(kernel.status).thenReturn('idle');
        const deferred = createDeferred<IInspectReplyMsg>();
        deferred.resolve({
            channel: 'shell',
            content: {
                status: 'ok',
                data: {},
                found: false,
                metadata: {}
            },
            header: {} as any,
            metadata: {} as any,
            parent_header: {} as any
        });
        when(kernelConnection.requestInspect(anything())).thenReturn(deferred.promise);

        const resultPromise = resolveCompletionItem(
            completionItem,
            undefined,
            token,
            instance(kernel),
            kernelId,
            'python',
            document,
            new Position(0, 4),
            toDispose
        );
        const [result] = await Promise.all([resultPromise, clock.tickAsync(5_000)]);
        assert.isUndefined(result.documentation);
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
            undefined,
            token,
            instance(kernel),
            kernelId,
            'python',
            document,
            new Position(0, 4),
            toDispose
        );
        const [result] = await Promise.all([resultPromise, clock.tickAsync(5_000)]);
        assert.strictEqual((result.documentation as MarkdownString).value, 'Some documentation');
    });
    test('Never make any requests if we fail to get a response n times', async () => {
        completionItem = new CompletionItem('One');
        completionItem.range = new Range(0, 4, 0, 4);
        when(kernel.status).thenReturn('idle');
        const deferred = createDeferred<IInspectReplyMsg>();
        when(kernelConnection.requestInspect(anything())).thenReturn(deferred.promise);
        const sendRequest = () =>
            resolveCompletionItem(
                completionItem,
                undefined,
                token,
                instance(kernel),
                kernelId,
                'python',
                document,
                new Position(0, 4),
                toDispose
            );

        for (let index = 0; index < MAX_PENDING_REQUESTS; index++) {
            const resultPromise = sendRequest();
            const [result] = await Promise.all([resultPromise, clock.tickAsync(5_000)]);
            assert.strictEqual(result.documentation, completionItem.documentation);
            verify(kernelConnection.requestInspect(anything())).times(index + 1);
        }

        // Lets try to send a lot more & verify this is a noop.
        for (let index = 0; index < 100; index++) {
            void sendRequest();
        }
        verify(kernelConnection.requestInspect(anything())).times(MAX_PENDING_REQUESTS);

        reset(kernelConnection);
        when(kernelConnection.requestInspect(anything())).thenReturn(deferred.promise);
        const resultPromise = resolveCompletionItem(
            completionItem,
            undefined,
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
    test('Never queue more than 5 requests', async () => {
        completionItem = new CompletionItem('One');
        completionItem.range = new Range(0, 4, 0, 4);
        when(kernel.status).thenReturn('idle');
        const requests: Deferred<IInspectReplyMsg>[] = [];
        when(kernelConnection.requestInspect(anything())).thenCall(() => {
            const deferred = createDeferred<IInspectReplyMsg>();
            requests.push(deferred);
            disposables.push(new Disposable(() => deferred.resolve())); // No dangling promises.
            return deferred.promise;
        });

        const sendRequest = () =>
            resolveCompletionItem(
                completionItem,
                undefined,
                token,
                instance(kernel),
                kernelId,
                'python',
                document,
                new Position(0, 4),
                toDispose
            );
        for (let index = 0; index < MAX_PENDING_REQUESTS; index++) {
            void sendRequest();
        }
        // const [result] = await Promise.all([resultPromise, clock.tickAsync(5_000)]);
        // assert.strictEqual(result.documentation, completionItem.documentation);
        verify(kernelConnection.requestInspect(anything())).times(MAX_PENDING_REQUESTS);
        assert.strictEqual(requests.length, MAX_PENDING_REQUESTS);

        await clock.tickAsync(500); // Wait for 500ms (lets see if the back off strategy works & does not send any requests)
        verify(kernelConnection.requestInspect(anything())).times(MAX_PENDING_REQUESTS);
        assert.strictEqual(requests.length, MAX_PENDING_REQUESTS);

        // Asking for resolving another completion will not send a new request, as there are too many
        void sendRequest();
        await clock.tickAsync(500); // Wait for 500ms (lets see if the back off strategy works & does not send any requests)
        verify(kernelConnection.requestInspect(anything())).times(MAX_PENDING_REQUESTS);
        assert.strictEqual(requests.length, MAX_PENDING_REQUESTS);

        // Complete one of the requests, this should allow another request to be sent
        requests.pop()?.resolve({ content: { status: 'ok', data: {}, found: false, metadata: {} } } as any);
        await clock.tickAsync(500); // Wait for backoff strategy to work.
        verify(kernelConnection.requestInspect(anything())).times(MAX_PENDING_REQUESTS + 1);

        // Asking for resolving another completion will not send a new request, as there are too many
        void sendRequest();
        await clock.tickAsync(500); // Wait for 500ms (lets see if the back off strategy works & does not send any requests)
        verify(kernelConnection.requestInspect(anything())).times(MAX_PENDING_REQUESTS + 1);
        assert.strictEqual(requests.length, MAX_PENDING_REQUESTS);

        // Complete one of the requests, this should allow another request to be sent
        requests.pop()?.resolve({ content: { status: 'ok', data: {}, found: false, metadata: {} } } as any);
        await clock.tickAsync(500); // Wait for backoff strategy to work.
        verify(kernelConnection.requestInspect(anything())).times(MAX_PENDING_REQUESTS + 2);

        // Even if the token is cancelled, the pending requests queue should not be cleared.
        // This is because we want to ensure we don't send too many requests to the kernel.
        void sendRequest();
        void sendRequest();
        void sendRequest();
        void sendRequest();
        tokenSource.cancel();
        await clock.tickAsync(500); // Wait for backoff strategy to work.
        verify(kernelConnection.requestInspect(anything())).times(MAX_PENDING_REQUESTS + 2);
    });
});
