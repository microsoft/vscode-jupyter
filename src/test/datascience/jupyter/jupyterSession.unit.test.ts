// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import {
    ContentsManager,
    Kernel,
    KernelMessage,
    ServerConnection,
    Session,
    SessionManager
} from '@jupyterlab/services';
import { DefaultKernel } from '@jupyterlab/services/lib/kernel/default';
import { DefaultSession } from '@jupyterlab/services/lib/session/default';
import { ISignal, Signal } from '@phosphor/commands/node_modules/@phosphor/signaling';
import { assert } from 'chai';
import * as sinon from 'sinon';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import * as typemoq from 'typemoq';
import { Uri } from 'vscode';

import { traceInfo } from '../../../client/common/logger';
import { Resource } from '../../../client/common/types';
import { createDeferred, Deferred } from '../../../client/common/utils/async';
import { DataScience } from '../../../client/common/utils/localize';
import { noop } from '../../../client/common/utils/misc';
import { JupyterSession } from '../../../client/datascience/jupyter/jupyterSession';
import { JupyterKernelService } from '../../../client/datascience/jupyter/kernels/jupyterKernelService';
import { KernelConnectionMetadata, LiveKernelModel } from '../../../client/datascience/jupyter/kernels/types';
import { IJupyterConnection, IJupyterKernelSpec, ISessionWithSocket } from '../../../client/datascience/types';
import { MockOutputChannel } from '../../mockClasses';

/* eslint-disable , @typescript-eslint/no-explicit-any */
suite('DataScience - JupyterSession', () => {
    interface IKernelChangedArgs {
        /**
         * The old kernel.
         */
        oldValue: Kernel.IKernelConnection | null;
        /**
         * The new kernel.
         */
        newValue: Kernel.IKernelConnection | null;
    }

    let jupyterSession: JupyterSession;
    let restartSessionCreatedEvent: Deferred<void>;
    let restartSessionUsedEvent: Deferred<void>;
    let connection: IJupyterConnection;
    let serverSettings: typemoq.IMock<ServerConnection.ISettings>;
    let mockKernelSpec: typemoq.IMock<KernelConnectionMetadata>;
    let sessionManager: SessionManager;
    let contentsManager: ContentsManager;
    let session: ISessionWithSocket;
    let kernel: Kernel.IKernelConnection;
    let statusChangedSignal: ISignal<ISessionWithSocket, Kernel.Status>;
    let kernelChangedSignal: ISignal<ISessionWithSocket, IKernelChangedArgs>;

    function createJupyterSession(resource: Resource = undefined) {
        restartSessionCreatedEvent = createDeferred();
        restartSessionUsedEvent = createDeferred();
        connection = mock<IJupyterConnection>();
        serverSettings = typemoq.Mock.ofType<ServerConnection.ISettings>();
        mockKernelSpec = typemoq.Mock.ofType<KernelConnectionMetadata>();
        session = mock<ISessionWithSocket>();
        kernel = mock(DefaultKernel);
        when(session.kernel).thenReturn(instance(kernel));
        statusChangedSignal = mock(Signal);
        kernelChangedSignal = mock(Signal);
        const ioPubSignal = mock(Signal);
        when(session.statusChanged).thenReturn(instance(statusChangedSignal));
        when(session.kernelChanged).thenReturn(instance(kernelChangedSignal));
        when(session.iopubMessage).thenReturn(instance(ioPubSignal));
        when(session.kernel).thenReturn(instance(kernel));
        when(session.isDisposed).thenReturn(false);
        when(kernel.status).thenReturn('idle');
        when(connection.rootDirectory).thenReturn('');
        const channel = new MockOutputChannel('JUPYTER');
        const kernelService = mock(JupyterKernelService);
        when(kernelService.ensureKernelIsUsable(anything(), anything(), anything())).thenResolve();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (instance(session) as any).then = undefined;
        sessionManager = mock(SessionManager);
        contentsManager = mock(ContentsManager);
        jupyterSession = new JupyterSession(
            resource,
            instance(connection),
            serverSettings.object,
            mockKernelSpec.object,
            instance(sessionManager),
            instance(contentsManager),
            channel,
            () => {
                restartSessionCreatedEvent.resolve();
            },
            () => {
                restartSessionUsedEvent.resolve();
            },
            '',
            60_000,
            instance(kernelService)
        );
    }
    setup(() => createJupyterSession());

    async function connect() {
        const nbFile = 'file path';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        when(contentsManager.newUntitled(anything())).thenResolve({ path: nbFile } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        when(contentsManager.rename(anything(), anything())).thenResolve({ path: nbFile } as any);
        when(contentsManager.delete(anything())).thenResolve();
        when(sessionManager.startNew(anything())).thenResolve(instance(session));
        const specOrModel = { name: 'some name', id: undefined } as any;
        mockKernelSpec.setup((k: any) => k.kernelModel).returns(() => specOrModel);
        mockKernelSpec.setup((k: any) => k.kernelSpec).returns(() => specOrModel);
        mockKernelSpec.setup((k) => k.kind).returns(() => 'startUsingKernelSpec');

        await jupyterSession.connect(100);
    }

    test('Start a session when connecting', async () => {
        await connect();

        assert.isTrue(jupyterSession.isConnected);
        verify(sessionManager.startNew(anything())).once();
        verify(contentsManager.newUntitled(anything())).once();
    });

    test('Shutdown when disposing', async () => {
        const shutdown = sinon.stub(jupyterSession, 'shutdown');
        shutdown.resolves();

        await jupyterSession.dispose();

        assert.isTrue(shutdown.calledOnce);
    });

    suite('After connecting', () => {
        setup(connect);
        test('Interrupting will result in kernel being interrupted', async () => {
            when(kernel.interrupt()).thenResolve();

            await jupyterSession.interrupt(1000);

            verify(kernel.interrupt()).once();
        });
        suite('Shutdown', () => {
            test('Remote session with Interactive and starting a new session', async () => {
                // Create jupyter session for Interactive window
                createJupyterSession(Uri.file('test.py'));
                await connect();

                when(connection.localLaunch).thenReturn(false);
                when(sessionManager.refreshRunning()).thenResolve();
                when(session.isRemoteSession).thenReturn(true);
                when(session.kernelConnectionMetadata).thenReturn({
                    id: '',
                    kind: 'startUsingKernelSpec',
                    kernelSpec: {} as any
                });
                when(session.shutdown()).thenResolve();
                when(session.dispose()).thenReturn();

                await jupyterSession.shutdown();

                verify(sessionManager.refreshRunning()).never();
                verify(contentsManager.delete(anything())).once();
                // Shutdown sessions started for Interactive window.
                verify(session.shutdown()).once();
                verify(session.dispose()).once();
            });
            test('Remote session with Interactive and connecting to existing session', async () => {
                // Create jupyter session for Interactive window
                createJupyterSession(Uri.file('test.py'));
                await connect();

                when(connection.localLaunch).thenReturn(false);
                when(sessionManager.refreshRunning()).thenResolve();
                when(session.isRemoteSession).thenReturn(true);
                when(session.kernelConnectionMetadata).thenReturn({
                    id: '',
                    kind: 'connectToLiveKernel',
                    kernelModel: {} as any
                });
                when(session.shutdown()).thenResolve();
                when(session.dispose()).thenReturn();

                await jupyterSession.shutdown();

                verify(sessionManager.refreshRunning()).never();
                verify(contentsManager.delete(anything())).once();
                // Never shutdown live sessions connected from Interactive window.
                verify(session.shutdown()).never();
                verify(session.dispose()).once();
            });
            test('Remote session with Notebook and starting a new session', async () => {
                // Create jupyter session for Notebooks
                createJupyterSession(Uri.file('test.ipynb'));
                await connect();

                when(connection.localLaunch).thenReturn(false);
                when(sessionManager.refreshRunning()).thenResolve();
                when(session.isRemoteSession).thenReturn(true);
                when(session.kernelConnectionMetadata).thenReturn({
                    id: '',
                    kind: 'startUsingKernelSpec',
                    kernelSpec: {} as any
                });
                when(session.shutdown()).thenResolve();
                when(session.dispose()).thenReturn();

                await jupyterSession.shutdown();

                verify(sessionManager.refreshRunning()).never();
                verify(contentsManager.delete(anything())).once();
                // Never shutdown sessions started from Notebooks.
                verify(session.shutdown()).never();
                verify(session.dispose()).once();
            });
            test('Remote session with Notebook and connecting to existing session', async () => {
                // Create jupyter session for Notebooks
                createJupyterSession(Uri.file('test.ipynb'));
                await connect();

                when(connection.localLaunch).thenReturn(false);
                when(sessionManager.refreshRunning()).thenResolve();
                when(session.isRemoteSession).thenReturn(true);
                when(session.kernelConnectionMetadata).thenReturn({
                    id: '',
                    kind: 'connectToLiveKernel',
                    kernelModel: {} as any
                });
                when(session.shutdown()).thenResolve();
                when(session.dispose()).thenReturn();

                await jupyterSession.shutdown();

                verify(sessionManager.refreshRunning()).never();
                verify(contentsManager.delete(anything())).once();
                // Never shutdown live sessions connected from Notebooks.
                verify(session.shutdown()).never();
                verify(session.dispose()).once();
            });
            test('Local session', async () => {
                when(connection.localLaunch).thenReturn(true);
                when(session.isRemoteSession).thenReturn(false);
                when(session.shutdown()).thenResolve();
                when(session.dispose()).thenReturn();
                await jupyterSession.shutdown();

                verify(sessionManager.refreshRunning()).never();
                verify(contentsManager.delete(anything())).once();
                // always kill the sessions.
                verify(session.shutdown()).once();
                verify(session.dispose()).once();
            });
        });
        suite('Wait for session idle', () => {
            test('Will timeout', async () => {
                when(kernel.status).thenReturn('unknown');

                const promise = jupyterSession.waitForIdle(100);

                await assert.isRejected(promise, DataScience.jupyterLaunchTimedOut());
            });
            test('Will succeed', async () => {
                when(kernel.status).thenReturn('idle');

                await jupyterSession.waitForIdle(100);

                verify(kernel.status).atLeast(1);
            });
        });
        suite('Remote Sessions', async () => {
            let restartCount = 0;
            const newActiveRemoteKernel: LiveKernelModel = {
                argv: [],
                display_name: 'new kernel',
                language: 'python',
                name: 'newkernel',
                path: 'path',
                lastActivityTime: new Date(),
                numberOfConnections: 1,
                session: {
                    statusChanged: {
                        connect: noop,
                        disconnect: noop
                    },
                    kernelChanged: {
                        connect: noop,
                        disconnect: noop
                    },
                    iopubMessage: {
                        connect: noop,
                        disconnect: noop
                    },
                    kernel: {
                        status: 'idle',
                        restart: () => (restartCount = restartCount + 1),
                        registerCommTarget: noop
                    },
                    shutdown: () => Promise.resolve(),
                    isRemoteSession: false
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any,
                id: 'liveKernel'
            };
            let remoteSession: ISessionWithSocket;
            let remoteKernel: Kernel.IKernelConnection;
            let remoteSessionInstance: ISessionWithSocket;
            setup(() => {
                remoteSession = mock<ISessionWithSocket>();
                remoteKernel = mock(DefaultKernel);
                remoteSessionInstance = instance(remoteSession);
                remoteSessionInstance.isRemoteSession = false;
                when(remoteSession.kernel).thenReturn(instance(remoteKernel));
                when(remoteKernel.registerCommTarget(anything(), anything())).thenReturn();
                when(sessionManager.startNew(anything())).thenCall(() => {
                    return Promise.resolve(instance(remoteSession));
                });
            });
            suite('Switching kernels', () => {
                setup(async () => {
                    const signal = mock(Signal);
                    when(remoteSession.statusChanged).thenReturn(instance(signal));
                    verify(sessionManager.startNew(anything())).once();
                    when(sessionManager.connectTo(newActiveRemoteKernel.session)).thenReturn(
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        newActiveRemoteKernel.session as any
                    );

                    assert.isFalse(remoteSessionInstance.isRemoteSession);
                    await jupyterSession.changeKernel(
                        undefined,
                        { kernelModel: newActiveRemoteKernel, kind: 'connectToLiveKernel', id: '0' },
                        10000
                    );
                });
                test('Will shutdown to old session', async () => {
                    verify(session.shutdown()).once();
                });
                test('Will connect to existing session', async () => {
                    verify(sessionManager.connectTo(newActiveRemoteKernel.session)).once();
                });
                test('Will flag new session as being remote', async () => {
                    // Confirm the new session is flagged as remote
                    assert.isTrue(newActiveRemoteKernel.session.isRemoteSession);
                });
                test('Will not create a new session', async () => {
                    verify(sessionManager.startNew(anything())).once();
                });
                test('Restart should restart the new remote kernel', async () => {
                    when(remoteKernel.restart()).thenResolve();

                    await jupyterSession.restart(0);

                    // We should restart the kernel, not the session.
                    assert.equal(restartCount, 1, 'Did not restart the kernel');
                    verify(remoteSession.shutdown()).never();
                    verify(remoteSession.dispose()).never();
                });
            });
        });
        suite('Local Sessions', async () => {
            let newSession: Session.ISession;
            let newKernelConnection: Kernel.IKernelConnection;
            let newStatusChangedSignal: ISignal<Session.ISession, Kernel.Status>;
            let newKernelChangedSignal: ISignal<Session.ISession, IKernelChangedArgs>;
            let newSessionCreated: Deferred<void>;
            setup(async () => {
                newSession = mock(DefaultSession);
                newKernelConnection = mock(DefaultKernel);
                newStatusChangedSignal = mock<ISignal<Session.ISession, Kernel.Status>>();
                newKernelChangedSignal = mock<ISignal<Session.ISession, IKernelChangedArgs>>();
                const newIoPubSignal = mock<
                    ISignal<Session.ISession, KernelMessage.IIOPubMessage<KernelMessage.IOPubMessageType>>
                >();
                restartSessionCreatedEvent = createDeferred();
                restartSessionUsedEvent = createDeferred();
                when(newSession.statusChanged).thenReturn(instance(newStatusChangedSignal));
                when(newSession.kernelChanged).thenReturn(instance(newKernelChangedSignal));
                when(newSession.iopubMessage).thenReturn(instance(newIoPubSignal));
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (instance(newSession) as any).then = undefined;
                newSessionCreated = createDeferred();
                when(session.isRemoteSession).thenReturn(false);
                when(newKernelConnection.id).thenReturn('restartId');
                when(newKernelConnection.clientId).thenReturn('restartClientId');
                when(newKernelConnection.status).thenReturn('idle');
                when(newSession.kernel).thenReturn(instance(newKernelConnection));
                when(sessionManager.startNew(anything())).thenCall(() => {
                    newSessionCreated.resolve();
                    return Promise.resolve(instance(newSession));
                });
            });
            teardown(() => {
                verify(sessionManager.connectTo(anything())).never();
            });
            test('Switching kernels will kill current session and start a new one', async () => {
                verify(sessionManager.startNew(anything())).once();

                const newKernel: IJupyterKernelSpec = {
                    argv: [],
                    display_name: 'new kernel',
                    language: 'python',
                    name: 'newkernel',
                    path: 'path',
                    env: undefined
                };

                await jupyterSession.changeKernel(
                    undefined,
                    { kernelSpec: newKernel, kind: 'startUsingKernelSpec', id: '1' },
                    10000
                );

                // Wait untill a new session has been started.
                await newSessionCreated.promise;
                // One original, one new session.
                verify(sessionManager.startNew(anything())).twice();
            });
            suite('Executing user code', async () => {
                setup(executeUserCode);

                async function executeUserCode() {
                    const future = mock<
                        Kernel.IFuture<KernelMessage.IShellControlMessage, KernelMessage.IShellControlMessage>
                    >();
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    when(future.done).thenReturn(Promise.resolve(undefined as any));
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    when(kernel.requestExecute(anything(), anything(), anything())).thenReturn(instance(future) as any);

                    const result = jupyterSession.requestExecute({ code: '', allow_stdin: false, silent: false });

                    assert.isOk(result);
                    await result!.done;
                }

                test('Restart should create a new session & kill old session', async () => {
                    const oldSessionShutDown = createDeferred();
                    when(connection.localLaunch).thenReturn(true);
                    when(session.isRemoteSession).thenReturn(false);
                    when(session.isDisposed).thenReturn(false);
                    when(session.shutdown()).thenCall(() => {
                        oldSessionShutDown.resolve();
                        return Promise.resolve();
                    });
                    when(session.dispose()).thenCall(() => {
                        traceInfo('Shutting down');
                        return Promise.resolve();
                    });
                    const sessionServerSettings: ServerConnection.ISettings = mock<ServerConnection.ISettings>();
                    when(session.serverSettings).thenReturn(instance(sessionServerSettings));

                    await jupyterSession.restart(0);

                    // We should kill session and switch to new session, startig a new restart session.
                    await restartSessionCreatedEvent.promise;
                    await oldSessionShutDown.promise;
                    verify(session.shutdown()).once();
                    verify(session.dispose()).once();
                    // Confirm kernel isn't restarted.
                    verify(kernel.restart()).never();
                });
            });
        });
    });
});
