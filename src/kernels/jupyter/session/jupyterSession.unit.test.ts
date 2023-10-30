// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IChangedArgs } from '@jupyterlab/coreutils';
import * as fakeTimers from '@sinonjs/fake-timers';
import { Kernel, KernelMessage, ServerConnection, Session } from '@jupyterlab/services';
import { ISignal, Signal } from '@lumino/signaling';
import { assert } from 'chai';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { CancellationTokenSource, Disposable, Uri } from 'vscode';
import { IDisposable, Resource } from '../../../platform/common/types';
import { DataScience } from '../../../platform/common/utils/localize';
import { noop } from '../../../platform/common/utils/misc';
import {
    IJupyterConnection,
    KernelConnectionMetadata,
    LiveRemoteKernelConnectionMetadata,
    LocalKernelSpecConnectionMetadata,
    RemoteKernelSpecConnectionMetadata
} from '../../../kernels/types';
import { JupyterKernelService } from '../../../kernels/jupyter/session/jupyterKernelService.node';
import { dispose } from '../../../platform/common/helpers';
import { resolvableInstance } from '../../../test/datascience/helpers';
import { createEventHandler } from '../../../test/common';
import { JupyterSessionWrapper } from './jupyterSession';

suite('JupyterSession', () => {
    const disposables: IDisposable[] = [];
    let jupyterSession: JupyterSessionWrapper;
    let connection: IJupyterConnection;
    let session: Session.ISessionConnection;
    let kernel: Kernel.IKernelConnection;
    let token: CancellationTokenSource;
    let clock: fakeTimers.InstalledClock;
    let sessionDisposed: Signal<Session.ISessionConnection, void>;
    let sessionPropertyChanged: Signal<Session.ISessionConnection, 'path'>;
    let sessionIOPubMessage: Signal<Session.ISessionConnection, KernelMessage.IIOPubMessage>;
    let sessionKernelChanged: Signal<
        Session.ISessionConnection,
        IChangedArgs<Kernel.IKernelConnection | null, Kernel.IKernelConnection | null, 'kernel'>
    >;
    let sessionUnhandledMessage: Signal<Session.ISessionConnection, KernelMessage.IMessage>;
    let sessionConnectionStatusChanged: Signal<Session.ISessionConnection, Kernel.ConnectionStatus>;
    let sessionAnyMessage: Signal<Session.ISessionConnection, Kernel.IAnyMessageArgs>;
    let kernelService: JupyterKernelService;
    function createJupyterSession(resource: Resource = undefined, kernelConnectionMetadata: KernelConnectionMetadata) {
        connection = mock<IJupyterConnection>();
        token = new CancellationTokenSource();
        disposables.push(token);

        session = mock<Session.ISessionConnection>();
        kernel = mock<Kernel.IKernelConnection>();
        when(session.shutdown()).thenResolve();
        when(session.dispose()).thenReturn();
        when(session.kernel).thenReturn(instance(kernel));
        sessionDisposed = new Signal<Session.ISessionConnection, void>(instance(session));
        sessionPropertyChanged = new Signal<Session.ISessionConnection, 'path'>(instance(session));
        sessionIOPubMessage = new Signal<Session.ISessionConnection, KernelMessage.IIOPubMessage>(instance(session));
        sessionKernelChanged = new Signal<
            Session.ISessionConnection,
            IChangedArgs<Kernel.IKernelConnection | null, Kernel.IKernelConnection | null, 'kernel'>
        >(instance(session));
        sessionUnhandledMessage = new Signal<Session.ISessionConnection, KernelMessage.IMessage>(instance(session));
        sessionConnectionStatusChanged = new Signal<Session.ISessionConnection, Kernel.ConnectionStatus>(
            instance(session)
        );
        sessionAnyMessage = new Signal<Session.ISessionConnection, Kernel.IAnyMessageArgs>(instance(session));
        when(session.disposed).thenReturn(sessionDisposed);
        when(session.propertyChanged).thenReturn(sessionPropertyChanged);
        when(session.iopubMessage).thenReturn(sessionIOPubMessage);
        when(session.kernelChanged).thenReturn(sessionKernelChanged);
        when(session.statusChanged).thenReturn(
            new Signal<Session.ISessionConnection, Kernel.Status>(instance(session))
        );
        when(session.unhandledMessage).thenReturn(sessionUnhandledMessage);
        when(session.connectionStatusChanged).thenReturn(sessionConnectionStatusChanged);
        when(session.anyMessage).thenReturn(sessionAnyMessage);
        when(session.isDisposed).thenReturn(false);
        when(kernel.status).thenReturn('idle');
        when(kernel.connectionStatus).thenReturn('connected');
        when(kernel.statusChanged).thenReturn(instance(mock<ISignal<Kernel.IKernelConnection, Kernel.Status>>()));
        when(kernel.iopubMessage).thenReturn(
            instance(
                mock<ISignal<Kernel.IKernelConnection, KernelMessage.IIOPubMessage<KernelMessage.IOPubMessageType>>>()
            )
        );
        when(kernel.anyMessage).thenReturn({ connect: noop, disconnect: noop } as any);
        when(kernel.unhandledMessage).thenReturn(
            instance(mock<ISignal<Kernel.IKernelConnection, KernelMessage.IMessage<KernelMessage.MessageType>>>())
        );
        when(kernel.disposed).thenReturn(instance(mock<ISignal<Kernel.IKernelConnection, void>>()));
        when(kernel.connectionStatusChanged).thenReturn(
            instance(mock<ISignal<Kernel.IKernelConnection, Kernel.ConnectionStatus>>())
        );
        when(connection.rootDirectory).thenReturn(Uri.file(''));
        kernelService = mock(JupyterKernelService);
        when(kernelService.ensureKernelIsUsable(anything(), anything(), anything(), anything())).thenResolve();
        resolvableInstance(session);
        jupyterSession = new JupyterSessionWrapper(
            instance(session),
            resource,
            kernelConnectionMetadata,
            Uri.file(''),
            instance(kernelService),
            'jupyterExtension'
        );
    }
    teardown(async () => {
        await jupyterSession.disposeAsync().catch(noop);
        dispose(disposables);
    });

    suite('Shutting down of sessions when disposing a session', () => {
        test('New Remote sessions started with Interactive should be shutdown when disposing the session', async () => {
            createJupyterSession(
                Uri.file('test.py'),
                RemoteKernelSpecConnectionMetadata.create({
                    id: '',
                    kernelSpec: {} as any,
                    baseUrl: '',
                    serverProviderHandle: { handle: '1', id: '1', extensionId: '' }
                })
            );

            const onDidShutdown = createEventHandler(jupyterSession, 'onDidShutdown');
            const onDidDispose = createEventHandler(jupyterSession, 'onDidDispose');
            let disposeSignalled = false;
            jupyterSession.disposed.connect(() => (disposeSignalled = true));
            // const onDidDispose = jupyterSession.
            when(session.shutdown()).thenResolve();
            when(session.dispose()).thenReturn();

            await jupyterSession.disposeAsync();

            // Shutdown sessions started for Interactive window.
            verify(session.shutdown()).once();
            verify(session.dispose()).once();
            assert.strictEqual(onDidShutdown.count, 1);
            assert.strictEqual(onDidDispose.count, 1);
            assert.strictEqual(jupyterSession.status, 'dead');
            assert.strictEqual(jupyterSession.isDisposed, true);
            assert.strictEqual(disposeSignalled, true);
        });
        test('New Remote sessions started with Interactive should be shutdown when disposing the session (without calling disposeAsync)', async () => {
            createJupyterSession(
                Uri.file('test.py'),
                RemoteKernelSpecConnectionMetadata.create({
                    id: '',
                    kernelSpec: {} as any,
                    baseUrl: '',
                    serverProviderHandle: { handle: '1', id: '1', extensionId: '' }
                })
            );

            const onDidShutdown = createEventHandler(jupyterSession, 'onDidShutdown');
            const onDidDispose = createEventHandler(jupyterSession, 'onDidDispose');
            let disposeSignalled = false;
            jupyterSession.disposed.connect(() => (disposeSignalled = true));
            // const onDidDispose = jupyterSession.
            when(session.shutdown()).thenResolve();
            when(session.dispose()).thenReturn();

            jupyterSession.dispose();
            await onDidShutdown.assertFiredExactly(1, 100);
            await onDidDispose.assertFiredExactly(1, 100);

            // Shutdown sessions started for Interactive window.
            verify(session.shutdown()).once();
            verify(session.dispose()).once();
            assert.strictEqual(onDidShutdown.count, 1);
            assert.strictEqual(onDidDispose.count, 1);
            assert.strictEqual(jupyterSession.status, 'dead');
            assert.strictEqual(jupyterSession.isDisposed, true);
            assert.strictEqual(disposeSignalled, true);
        });
        test('Existing Remote session connected with Interactive should not be shutdown when disposing the session', async () => {
            createJupyterSession(
                Uri.file('test.py'),
                LiveRemoteKernelConnectionMetadata.create({
                    id: '',
                    kernelModel: {} as any,
                    baseUrl: '',
                    serverProviderHandle: { handle: '1', id: '1', extensionId: '' }
                })
            );

            const onDidShutdown = createEventHandler(jupyterSession, 'onDidShutdown');
            const onDidDispose = createEventHandler(jupyterSession, 'onDidDispose');
            let disposeSignalled = false;
            jupyterSession.disposed.connect(() => (disposeSignalled = true));
            when(session.shutdown()).thenResolve();
            when(session.dispose()).thenReturn();

            await jupyterSession.disposeAsync();

            // Never shutdown live sessions connected from Interactive window.
            verify(session.shutdown()).never();
            verify(session.dispose()).once();
            assert.strictEqual(onDidShutdown.count, 0);
            assert.strictEqual(onDidDispose.count, 1);
            assert.strictEqual(jupyterSession.status, 'dead');
            assert.strictEqual(jupyterSession.isDisposed, true);
            assert.strictEqual(disposeSignalled, true);
        });
        test('New Remote sessions started with Notebook should not be shutdown when disposing the session', async () => {
            createJupyterSession(
                Uri.file('test.ipynb'),
                RemoteKernelSpecConnectionMetadata.create({
                    id: '',
                    kernelSpec: {} as any,
                    baseUrl: '',
                    serverProviderHandle: { handle: '1', id: '1', extensionId: '' }
                })
            );

            const onDidShutdown = createEventHandler(jupyterSession, 'onDidShutdown');
            const onDidDispose = createEventHandler(jupyterSession, 'onDidDispose');
            let disposeSignalled = false;
            jupyterSession.disposed.connect(() => (disposeSignalled = true));
            when(session.shutdown()).thenResolve();
            when(session.dispose()).thenReturn();

            await jupyterSession.disposeAsync();

            // Never shutdown sessions started from Notebooks.
            verify(session.shutdown()).never();
            verify(session.dispose()).once();
            assert.strictEqual(onDidShutdown.count, 0);
            assert.strictEqual(onDidDispose.count, 1);
            assert.strictEqual(jupyterSession.status, 'dead');
            assert.strictEqual(jupyterSession.isDisposed, true);
            assert.strictEqual(disposeSignalled, true);
        });
        test('Existing Remote session connected with Notebook should not be shutdown when disposing the session', async () => {
            createJupyterSession(
                Uri.file('test.ipynb'),
                LiveRemoteKernelConnectionMetadata.create({
                    id: '',
                    kernelModel: {} as any,
                    baseUrl: '',
                    serverProviderHandle: { handle: '1', id: '1', extensionId: '' }
                })
            );

            const onDidShutdown = createEventHandler(jupyterSession, 'onDidShutdown');
            const onDidDispose = createEventHandler(jupyterSession, 'onDidDispose');
            let disposeSignalled = false;
            jupyterSession.disposed.connect(() => (disposeSignalled = true));
            when(session.shutdown()).thenResolve();
            when(session.dispose()).thenReturn();

            await jupyterSession.disposeAsync();

            // Never shutdown live sessions connected from Notebooks.
            verify(session.shutdown()).never();
            verify(session.dispose()).once();
            assert.strictEqual(onDidShutdown.count, 0);
            assert.strictEqual(onDidDispose.count, 1);
            assert.strictEqual(jupyterSession.status, 'dead');
            assert.strictEqual(jupyterSession.isDisposed, true);
            assert.strictEqual(disposeSignalled, true);
        });
        test('Local sessions should be shutdown when disposing the session', async () => {
            createJupyterSession(
                Uri.file('test.ipynb'),
                LocalKernelSpecConnectionMetadata.create({
                    id: '',
                    kernelSpec: {} as any,
                    interpreter: {} as any
                })
            );

            const onDidShutdown = createEventHandler(jupyterSession, 'onDidShutdown');
            const onDidDispose = createEventHandler(jupyterSession, 'onDidDispose');
            let disposeSignalled = false;
            jupyterSession.disposed.connect(() => (disposeSignalled = true));
            when(session.shutdown()).thenResolve();
            when(session.dispose()).thenReturn();

            await jupyterSession.disposeAsync();

            // always kill the sessions.
            verify(session.shutdown()).once();
            verify(session.dispose()).once();
            assert.strictEqual(onDidShutdown.count, 1);
            assert.strictEqual(onDidDispose.count, 1);
            assert.strictEqual(jupyterSession.status, 'dead');
            assert.strictEqual(jupyterSession.isDisposed, true);
            assert.strictEqual(disposeSignalled, true);
        });
    });
    suite(`Wait for session idle`, () => {
        ['local', 'remote'].forEach((connectionType) => {
            suite(connectionType, () => {
                const token = new CancellationTokenSource();
                setup(async () => {
                    const kernelConnection =
                        connectionType === 'local'
                            ? LocalKernelSpecConnectionMetadata.create({
                                  id: '',
                                  kernelSpec: {} as any,
                                  interpreter: {} as any
                              })
                            : RemoteKernelSpecConnectionMetadata.create({
                                  id: '',
                                  kernelSpec: {} as any,
                                  baseUrl: '',
                                  serverProviderHandle: { handle: '1', id: '1', extensionId: '' }
                              });
                    createJupyterSession(Uri.file('test.ipynb'), kernelConnection);
                });
                suiteTeardown(() => token.dispose());
                test('Will timeout', async () => {
                    when(kernel.status).thenReturn('unknown');
                    clock = fakeTimers.install();
                    disposables.push(new Disposable(() => clock.uninstall()));

                    const promise = jupyterSession.waitForIdle(100, token.token);
                    promise.catch(noop);
                    await clock.runAllAsync();

                    await assert.isRejected(promise, DataScience.jupyterLaunchTimedOut);
                });
                test('Will succeed', async () => {
                    when(kernel.status).thenReturn('idle');

                    await jupyterSession.waitForIdle(100, token.token);

                    verify(kernel.status).atLeast(1);
                });
            });
        });
    });
    suite('Local Sessions', async () => {
        suite('Executing user code', async () => {
            setup(() => {
                createJupyterSession(
                    Uri.file('test.ipynb'),
                    LocalKernelSpecConnectionMetadata.create({
                        id: '',
                        kernelSpec: {} as any,
                        interpreter: {} as any
                    })
                );
            });

            async function executeUserCode() {
                const future =
                    mock<Kernel.IFuture<KernelMessage.IShellControlMessage, KernelMessage.IShellControlMessage>>();
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                when(future.done).thenReturn(Promise.resolve(undefined as any));
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                when(kernel.requestExecute(anything(), anything(), anything())).thenReturn(instance(future) as any);
                when(kernel.requestExecute(anything())).thenReturn(instance(future) as any);

                const result = jupyterSession.kernel!.requestExecute({
                    code: '',
                    allow_stdin: false,
                    silent: false
                });

                assert.isOk(result);
                await result!.done;
            }

            test('Restart should just restart the kernel', async () => {
                when(session.isDisposed).thenReturn(false);
                const sessionServerSettings: ServerConnection.ISettings = mock<ServerConnection.ISettings>();
                when(session.serverSettings).thenReturn(instance(sessionServerSettings));

                await executeUserCode();
                await jupyterSession.restart();

                // We should not kill session.
                verify(session.shutdown()).never();
                verify(session.dispose()).never();
                // Confirm kernel is restarted.
                verify(kernel.restart()).once();

                verify(
                    kernelService.ensureKernelIsUsable(anything(), anything(), anything(), anything(), anything())
                ).once();
            });
            test('Restart should fail if user cancels from installing missing dependencies', async () => {
                when(session.isDisposed).thenReturn(false);
                const sessionServerSettings: ServerConnection.ISettings = mock<ServerConnection.ISettings>();
                when(session.serverSettings).thenReturn(instance(sessionServerSettings));
                when(
                    kernelService.ensureKernelIsUsable(anything(), anything(), anything(), anything(), anything())
                ).thenReject(new Error('Do not install missing dependencies'));

                await assert.isRejected(jupyterSession.restart(), 'Do not install missing dependencies');

                // We should not kill session.
                verify(session.shutdown()).never();
                verify(session.dispose()).never();
                // Confirm kernel was not restarted.
                verify(kernel.restart()).never();
                verify(
                    kernelService.ensureKernelIsUsable(anything(), anything(), anything(), anything(), anything())
                ).once();
            });
        });
    });
});
