// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { IChangedArgs } from '@jupyterlab/coreutils';
import {
    ContentsManager,
    Kernel,
    KernelMessage,
    KernelSpecManager,
    ServerConnection,
    Session,
    SessionManager
} from '@jupyterlab/services';
import { KernelConnection } from '@jupyterlab/services/lib/kernel/default';
import { SessionConnection } from '@jupyterlab/services/lib/session/default';
import { ISignal } from '@lumino/signaling';
import { assert } from 'chai';
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
    type IKernelChangedArgs = IChangedArgs<Kernel.IKernelConnection | null, Kernel.IKernelConnection | null, 'kernel'>;
    let jupyterSession: JupyterSession;
    let restartSessionCreatedEvent: Deferred<void>;
    let restartSessionUsedEvent: Deferred<void>;
    let connection: IJupyterConnection;
    let mockKernelSpec: typemoq.IMock<KernelConnectionMetadata>;
    let sessionManager: SessionManager;
    let contentsManager: ContentsManager;
    let specManager: KernelSpecManager;
    let session: ISessionWithSocket;
    let kernel: Kernel.IKernelConnection;
    let statusChangedSignal: ISignal<ISessionWithSocket, Kernel.Status>;
    let kernelChangedSignal: ISignal<ISessionWithSocket, IKernelChangedArgs>;

    function createJupyterSession(resource: Resource = undefined) {
        restartSessionCreatedEvent = createDeferred();
        restartSessionUsedEvent = createDeferred();
        connection = mock<IJupyterConnection>();
        mockKernelSpec = typemoq.Mock.ofType<KernelConnectionMetadata>();
        session = mock<ISessionWithSocket>();
        kernel = mock(KernelConnection);
        when(session.kernel).thenReturn(instance(kernel));
        statusChangedSignal = mock<ISignal<ISessionWithSocket, Kernel.Status>>();
        kernelChangedSignal = mock<ISignal<ISessionWithSocket, IKernelChangedArgs>>();
        const ioPubSignal = mock<
            ISignal<ISessionWithSocket, KernelMessage.IIOPubMessage<KernelMessage.IOPubMessageType>>
        >();
        when(session.statusChanged).thenReturn(instance(statusChangedSignal));
        when(session.kernelChanged).thenReturn(instance(kernelChangedSignal));
        when(session.iopubMessage).thenReturn(instance(ioPubSignal));
        when(session.unhandledMessage).thenReturn(instance(ioPubSignal));
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
        specManager = mock(KernelSpecManager);
        jupyterSession = new JupyterSession(
            resource,
            instance(connection),
            mockKernelSpec.object,
            instance(specManager),
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
            instance(kernelService),
            1_000,
            1_000
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
        when(sessionManager.startNew(anything(), anything())).thenResolve(instance(session));
        const specOrModel = { name: 'some name', id: undefined } as any;
        mockKernelSpec.setup((k: any) => k.kernelModel).returns(() => specOrModel);
        mockKernelSpec.setup((k: any) => k.kernelSpec).returns(() => specOrModel);
        mockKernelSpec.setup((k) => k.kind).returns(() => 'startUsingKernelSpec');

        await jupyterSession.connect(100);
    }

    test('Start a session when connecting', async () => {
        await connect();

        assert.isTrue(jupyterSession.isConnected);
        verify(sessionManager.startNew(anything(), anything())).once();
        verify(contentsManager.newUntitled(anything())).once();
    });

    suite('After connecting', () => {
        setup(connect);
        test('Interrupting will result in kernel being interrupted', async () => {
            when(kernel.interrupt()).thenResolve();

            await jupyterSession.interrupt();

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

                await jupyterSession.dispose();

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

                await jupyterSession.dispose();

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

                await jupyterSession.dispose();

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

                await jupyterSession.dispose();

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
                await jupyterSession.dispose();

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
                model: {
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
                remoteKernel = mock(KernelConnection);
                remoteSessionInstance = instance(remoteSession);
                remoteSessionInstance.isRemoteSession = false;
                when(remoteSession.kernel).thenReturn(instance(remoteKernel));
                when(remoteKernel.registerCommTarget(anything(), anything())).thenReturn();
                when(sessionManager.startNew(anything(), anything())).thenCall(() => {
                    return Promise.resolve(instance(remoteSession));
                });
            });
            suite('Switching kernels', () => {
                setup(async () => {
                    const signal = mock<ISignal<ISessionWithSocket, Kernel.Status>>();
                    when(remoteSession.statusChanged).thenReturn(instance(signal));
                    verify(sessionManager.startNew(anything(), anything())).once();
                    when(sessionManager.connectTo(anything())).thenReturn(
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        newActiveRemoteKernel.model as any
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
                    verify(sessionManager.connectTo(anything())).once();
                });
                test('Will flag new session as being remote', async () => {
                    // Confirm the new session is flagged as remote
                    assert.isTrue((newActiveRemoteKernel.model as any).isRemoteSession);
                });
                test('Will not create a new session', async () => {
                    verify(sessionManager.startNew(anything(), anything())).once();
                });
                test('Restart should restart the new remote kernel', async () => {
                    when(remoteKernel.restart()).thenResolve();

                    await jupyterSession.restart();

                    // We should restart the kernel, not the session.
                    assert.equal(restartCount, 1, 'Did not restart the kernel');
                    verify(remoteSession.shutdown()).never();
                    verify(remoteSession.dispose()).never();
                });
            });
        });
        suite('Local Sessions', async () => {
            let newSession: Session.ISessionConnection;
            let newKernelConnection: Kernel.IKernelConnection;
            let newStatusChangedSignal: ISignal<Session.ISessionConnection, Kernel.Status>;
            let newKernelChangedSignal: ISignal<Session.ISessionConnection, IKernelChangedArgs>;
            let newSessionCreated: Deferred<void>;
            setup(async () => {
                newSession = mock(SessionConnection);
                newKernelConnection = mock(KernelConnection);
                newStatusChangedSignal = mock<ISignal<Session.ISessionConnection, Kernel.Status>>();
                newKernelChangedSignal = mock<ISignal<Session.ISessionConnection, IKernelChangedArgs>>();
                const newIoPubSignal = mock<
                    ISignal<Session.ISessionConnection, KernelMessage.IIOPubMessage<KernelMessage.IOPubMessageType>>
                >();
                restartSessionCreatedEvent = createDeferred();
                restartSessionUsedEvent = createDeferred();
                when(newSession.statusChanged).thenReturn(instance(newStatusChangedSignal));
                when(newSession.kernelChanged).thenReturn(instance(newKernelChangedSignal));
                when(newSession.iopubMessage).thenReturn(instance(newIoPubSignal));
                when(newSession.unhandledMessage).thenReturn(instance(newIoPubSignal));
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (instance(newSession) as any).then = undefined;
                newSessionCreated = createDeferred();
                when(session.isRemoteSession).thenReturn(false);
                when(newKernelConnection.id).thenReturn('restartId');
                when(newKernelConnection.clientId).thenReturn('restartClientId');
                when(newKernelConnection.status).thenReturn('idle');
                when(newSession.kernel).thenReturn(instance(newKernelConnection));
                when(sessionManager.startNew(anything(), anything())).thenCall(() => {
                    newSessionCreated.resolve();
                    return Promise.resolve(instance(newSession));
                });
            });
            teardown(() => {
                verify(sessionManager.connectTo(anything())).never();
            });
            test('Switching kernels will kill current session and start a new one', async () => {
                verify(sessionManager.startNew(anything(), anything())).once();

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
                verify(sessionManager.startNew(anything(), anything())).twice();
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

                    await jupyterSession.restart();

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
