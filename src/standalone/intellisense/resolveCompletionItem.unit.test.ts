// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { Signal } from '@lumino/signaling';
import * as sinon from 'sinon';
import type * as nbformat from '@jupyterlab/nbformat';
import uuid from 'uuid/v4';
import * as fakeTimers from '@sinonjs/fake-timers';
import { Kernel, type KernelMessage } from '@jupyterlab/services';
import { anything, instance, mock, reset, verify, when } from 'ts-mockito';
import {
    IKernel,
    IKernelProvider,
    IKernelSession,
    LocalKernelSpecConnectionMetadata,
    PythonKernelConnectionMetadata
} from '../../kernels/types';
import { createMockedDocument } from '../../test/datascience/editor-integration/helpers';
import {
    CancellationToken,
    CancellationTokenSource,
    CompletionItem,
    Disposable,
    Position,
    Range,
    TextDocument,
    Uri,
    type NotebookCellOutput,
    EventEmitter,
    type MarkdownString
} from 'vscode';
import { maxPendingKernelRequests, resolveCompletionItem } from './resolveCompletionItem';
import { IDisposable, IDisposableRegistry } from '../../platform/common/types';
import { DisposableStore, dispose } from '../../platform/common/utils/lifecycle';
import { Deferred, createDeferred } from '../../platform/common/utils/async';
import { IInspectReplyMsg } from '@jupyterlab/services/lib/kernel/messages';
import { sleep } from '../../test/core';
import { ServiceContainer } from '../../platform/ioc/container';
import { NotebookKernelExecution } from '../../kernels/kernelExecution';
import { PythonExtension } from '@vscode/python-extension';
import { setPythonApi } from '../../platform/interpreter/helpers';
import type { Output } from '../../api';
import { executionCounters } from '../api/kernels/backgroundExecution';
import { cellOutputToVSCCellOutput } from '../../kernels/execution/helpers';

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
    const pythonKernel = PythonKernelConnectionMetadata.create({
        id: 'pythonId',
        interpreter: {
            id: 'pythonId',
            uri: Uri.file('python')
        },
        kernelSpec: {
            argv: ['python', '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
            display_name: 'Python 3',
            executable: 'python',
            name: 'python3'
        }
    });
    const nonPythonKernel = LocalKernelSpecConnectionMetadata.create({
        id: 'java',
        kernelSpec: {
            argv: ['java'],
            display_name: 'Java',
            executable: 'java',
            name: 'java'
        }
    });
    let kernelStatusChangedSignal: Signal<Kernel.IKernelConnection, Kernel.Status>;
    setup(() => {
        kernelConnection = mock<Kernel.IKernelConnection>();
        kernel = mock<IKernel>();
        kernelId = uuid();
        when(kernel.id).thenReturn(kernelId);
        when(kernel.kernelConnectionMetadata).thenReturn(instance(pythonKernel));
        const session = mock<IKernelSession>();
        when(kernel.session).thenReturn(instance(session));
        when(session.kernel).thenReturn(instance(kernelConnection));
        kernelStatusChangedSignal = new Signal<Kernel.IKernelConnection, Kernel.Status>(instance(kernelConnection));
        when(kernelConnection.statusChanged).thenReturn(kernelStatusChangedSignal);
        disposables.push(new Disposable(() => Signal.disconnectAll(kernelStatusChangedSignal)));
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
        sinon.reset();
        disposables = dispose(disposables);
    });
    suite('Non-Python', () => {
        setup(() => {
            when(kernel.kernelConnectionMetadata).thenReturn(nonPythonKernel);
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
                    'java',
                    document,
                    new Position(0, 4)
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
                'java',
                document,
                new Position(0, 4)
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
                'java',
                document,
                new Position(0, 4)
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
                'java',
                document,
                new Position(0, 4)
            );
            const [result] = await Promise.all([resultPromise, clock.tickAsync(5_000)]);
            assert.strictEqual(result.documentation, 'Some documentation');
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
                'java',
                document,
                new Position(0, 4)
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
                'java',
                document,
                new Position(0, 4)
            );
            const [result] = await Promise.all([resultPromise, clock.tickAsync(5_000)]);
            assert.strictEqual(result.documentation, 'Some documentation');
        });
        test('Never make any requests if we fail to get a response in time', async () => {
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
                    'java',
                    document,
                    new Position(0, 4)
                );

            // Send a completion request and it will not complete, but will time out.
            const [result0] = await Promise.all([sendRequest(), clock.tickAsync(5_000)]);
            assert.strictEqual(result0.documentation, completionItem.documentation);
            verify(kernelConnection.requestInspect(anything())).times(1);

            // Lets try to send a lot more & verify this is a noop.
            for (let index = 0; index < 100; index++) {
                void sendRequest();
            }

            // Verify we still send that one request (which is still pending).
            verify(kernelConnection.requestInspect(anything())).times(1);

            // From now on we will not send any requests as the previous never completed.
            reset(kernelConnection);
            when(kernelConnection.requestInspect(anything())).thenReturn(deferred.promise);
            const resultPromise = resolveCompletionItem(
                completionItem,
                undefined,
                token,
                instance(kernel),
                kernelId,
                'java',
                document,
                new Position(0, 4)
            );
            const [result] = await Promise.all([resultPromise, clock.tickAsync(5_000)]);
            assert.strictEqual(result.documentation, completionItem.documentation);
            verify(kernelConnection.requestInspect(anything())).never();
        });
        test('Never queue more than 1 requests', async () => {
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
                    'java',
                    document,
                    new Position(0, 4)
                );

            void sendRequest();
            await clock.tickAsync(10);

            for (let index = 0; index < maxPendingKernelRequests; index++) {
                // Asking for resolving another completion will not send a new request, as there are too many
                void sendRequest();
                await clock.tickAsync(100); // Wait for 500ms (lets see if the back off strategy works & does not send any requests)
                verify(kernelConnection.requestInspect(anything())).times(maxPendingKernelRequests);
                assert.strictEqual(requests.length, maxPendingKernelRequests);
            }

            // Complete one of the requests, this should allow another request to be sent
            requests.pop()?.resolve({ content: { status: 'ok', data: {}, found: false, metadata: {} } } as any);
            kernelStatusChangedSignal.emit('idle');
            await clock.tickAsync(100); // Wait for backoff strategy to work.
            verify(kernelConnection.requestInspect(anything())).times(maxPendingKernelRequests + 1);

            void sendRequest();
            void sendRequest();
            void sendRequest();
            void sendRequest();

            // After calling everything, nothing should be sent (as all have been cancelled).
            tokenSource.cancel();
            await clock.tickAsync(500); // Wait for backoff strategy to work.
            verify(kernelConnection.requestInspect(anything())).times(maxPendingKernelRequests + 1);
        });
        test('Cache the responses', async () => {
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
                'java',
                document,
                new Position(0, 4)
            );
            const [result] = await Promise.all([resultPromise, clock.tickAsync(5_000)]);
            const resultPromise2 = resolveCompletionItem(
                completionItem,
                undefined,
                token,
                instance(kernel),
                kernelId,
                'java',
                document,
                new Position(0, 4)
            );
            const [result2] = await Promise.all([resultPromise2, clock.tickAsync(5_000)]);
            assert.deepEqual(result, result2);
            // Only one request should have been sent
            verify(kernelConnection.requestInspect(anything())).once();

            const resultPromise3 = resolveCompletionItem(
                completionItem,
                undefined,
                token,
                instance(kernel),
                kernelId,
                'java',
                document,
                new Position(0, 1)
            );
            await Promise.all([resultPromise3, clock.tickAsync(5_000)]);
            // Should have sent the new request (as we do not have a cache for this)
            verify(kernelConnection.requestInspect(anything())).twice();
        });
    });
    suite('Python', () => {
        let onDidRecieveDisplayUpdate: EventEmitter<NotebookCellOutput>;
        let resolveOutputs: Deferred<NotebookCellOutput[]>;
        let kernelExecution: NotebookKernelExecution;
        setup(() => {
            when(kernel.kernelConnectionMetadata).thenReturn(pythonKernel);
            when(kernel.disposed).thenReturn(false);

            async function* mockOutput(): AsyncGenerator<Output, void, unknown> {
                const outputs = await resolveOutputs.promise;
                for (const output of outputs) {
                    yield output;
                }
            }

            resolveOutputs = createDeferred<NotebookCellOutput[]>();
            onDidRecieveDisplayUpdate = new EventEmitter<NotebookCellOutput>();
            disposables.push(onDidRecieveDisplayUpdate);
            const container = mock<ServiceContainer>();
            const kernelProvider = mock<IKernelProvider>();
            kernelExecution = mock<NotebookKernelExecution>();
            when(kernelExecution.onDidRecieveDisplayUpdate).thenReturn(onDidRecieveDisplayUpdate.event);
            when(kernelExecution.executeCode(anything(), anything(), anything(), anything())).thenCall(() =>
                mockOutput()
            );
            when(kernelProvider.getKernelExecution(instance(kernel))).thenReturn(instance(kernelExecution));
            when(container.get<IKernelProvider>(IKernelProvider)).thenReturn(instance(kernelProvider));
            when(container.get<IDisposableRegistry>(IDisposableRegistry)).thenReturn([]);
            sinon.stub(ServiceContainer, 'instance').get(() => instance(container));

            const pythonApi = mock<PythonExtension>();
            setPythonApi(instance(pythonApi));
            disposables.push(new Disposable(() => setPythonApi(undefined as any)));

            when(pythonApi.environments).thenReturn({ known: [] } as any);
        });
        function createCompletionOutputs(kernel: IKernel, completion: string) {
            const counter = executionCounters.get(kernel) || 0;
            const mime = `application/vnd.vscode.bg.execution.${counter}`;
            const mimeFinalResult = `application/vnd.vscode.bg.execution.${counter}.result`;
            const result: KernelMessage.IInspectReplyMsg['content'] = {
                status: 'ok',
                data: {
                    'text/plain': completion
                },
                found: true,
                metadata: {}
            };
            const output1: nbformat.IOutput = {
                data: {
                    [mime]: ''
                },
                execution_count: 1,
                output_type: 'display_data',
                transient: {
                    display_id: '123'
                },
                metadata: {
                    foo: 'bar'
                }
            };
            const finalOutput: nbformat.IOutput = {
                data: {
                    [mimeFinalResult]: result as any
                },
                execution_count: 1,
                output_type: 'update_display_data',
                transient: {
                    display_id: '123'
                },
                metadata: {
                    foo: 'bar'
                }
            };
            return [output1, finalOutput].map(cellOutputToVSCCellOutput);
        }
        test('Resolve the documentation', async () => {
            completionItem = new CompletionItem('One');
            completionItem.range = new Range(0, 4, 0, 4);
            when(kernel.status).thenReturn('idle');

            const resultPromise = resolveCompletionItem(
                completionItem,
                undefined,
                token,
                instance(kernel),
                kernelId,
                'python',
                document,
                new Position(0, 4)
            );

            // Create the output mimem type
            const outputs = createCompletionOutputs(instance(kernel), 'Some documentation');
            resolveOutputs.resolve(outputs);

            const [result] = await Promise.all([resultPromise, clock.tickAsync(5_000)]);
            assert.strictEqual((result.documentation as MarkdownString).value, 'Some documentation');
        });
        test('Resolve the documentation even if kernel is busy', async () => {
            completionItem = new CompletionItem('One');
            completionItem.range = new Range(0, 4, 0, 4);
            when(kernel.status).thenReturn('busy');

            const resultPromise = resolveCompletionItem(
                completionItem,
                undefined,
                token,
                instance(kernel),
                kernelId,
                'python',
                document,
                new Position(0, 4)
            );

            // Create the output mimem type
            const outputs = createCompletionOutputs(instance(kernel), 'Some documentation');
            resolveOutputs.resolve(outputs);

            const [result] = await Promise.all([resultPromise, clock.tickAsync(5_000)]);
            assert.strictEqual((result.documentation as MarkdownString).value, 'Some documentation');
        });
        // test.only('Never queue more than 5 requests', async () => {
        //     completionItem = new CompletionItem('One');
        //     completionItem.range = new Range(0, 4, 0, 4);
        //     when(kernel.status).thenReturn('idle');

        //     const sendRequest = () =>
        //         resolveCompletionItem(
        //             completionItem,
        //             undefined,
        //             token,
        //             instance(kernel),
        //             kernelId,
        //             'python',
        //             document,
        //             new Position(0, 4)
        //         );

        //     void sendRequest();
        //     await clock.tickAsync(10);

        //     for (let index = 0; index < maxPendingPythonKernelRequests; index++) {
        //         // Asking for resolving another completion will not send a new request, as there are too many
        //         void sendRequest();
        //     }

        //     verify(kernelExecution.executeCode(anything(), anything(), anything(), anything())).times(5);

        // // Complete one of the requests, this should allow another request to be sent
        // requests.pop()?.resolve({ content: { status: 'ok', data: {}, found: false, metadata: {} } } as any);
        // kernelStatusChangedSignal.emit('idle');
        // await clock.tickAsync(100); // Wait for backoff strategy to work.
        // verify(kernelConnection.requestInspect(anything())).times(maxPendingNonPythonkernelRequests + 1);

        // void sendRequest();
        // void sendRequest();
        // void sendRequest();
        // void sendRequest();

        // // After calling everything, nothing should be sent (as all have been cancelled).
        // tokenSource.cancel();
        // await clock.tickAsync(500); // Wait for backoff strategy to work.
        // verify(kernelConnection.requestInspect(anything())).times(maxPendingNonPythonkernelRequests + 1);
        // });
    });
});
