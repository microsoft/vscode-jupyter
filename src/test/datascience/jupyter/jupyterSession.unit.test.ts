// Copyright (c) Microsoft Corporation.
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
import { SessionConnection } from '@jupyterlab/services/lib/session/default';
import { ISignal } from '@lumino/signaling';
import { assert } from 'chai';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { CancellationTokenSource, Uri } from 'vscode';

import { ReadWrite, Resource } from '../../../platform/common/types';
import { createDeferred, Deferred } from '../../../platform/common/utils/async';
import { DataScience } from '../../../platform/common/utils/localize';
import { noop } from '../../../platform/common/utils/misc';
import {
    IJupyterConnection,
    ISessionWithSocket,
    KernelConnectionMetadata,
    LiveKernelModel
} from '../../../kernels/types';
import { MockOutputChannel } from '../../mockClasses';
import { JupyterKernelService } from '../../../kernels/jupyter/jupyterKernelService.node';
import { JupyterSession } from '../../../kernels/jupyter/session/jupyterSession';
import { DisplayOptions } from '../../../kernels/displayOptions';
import { FileSystem } from '../../../platform/common/platform/fileSystem.node';
import { BackingFileCreator } from '../../../kernels/jupyter/session/backingFileCreator.node';
import * as path from '../../../platform/vscode-path/path';
import { JupyterRequestCreator } from '../../../kernels/jupyter/session/jupyterRequestCreator.node';
import { Signal } from '@lumino/signaling';
import { JupyterInvalidKernelError } from '../../../kernels/errors/jupyterInvalidKernelError';

/* eslint-disable , @typescript-eslint/no-explicit-any */
suite('DataScience - JupyterSession', () => {
    type IKernelChangedArgs = IChangedArgs<Kernel.IKernelConnection | null, Kernel.IKernelConnection | null, 'kernel'>;
    let jupyterSession: JupyterSession;
    let connection: IJupyterConnection;
    let mockKernelSpec: ReadWrite<KernelConnectionMetadata>;
    let sessionManager: SessionManager;
    let contentsManager: ContentsManager;
    let specManager: KernelSpecManager;
    let session: ISessionWithSocket;
    let kernel: Kernel.IKernelConnection;
    let statusChangedSignal: ISignal<ISessionWithSocket, Kernel.Status>;
    let kernelChangedSignal: ISignal<ISessionWithSocket, IKernelChangedArgs>;
    let restartCount = 0;
    const newActiveRemoteKernel: LiveKernelModel = {
        argv: [],
        display_name: 'new kernel',
        language: 'python',
        name: 'newkernel',
        executable: 'path',
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
            unhandledMessage: {
                connect: noop,
                disconnect: noop
            },
            kernel: {
                status: 'idle',
                restart: () => (restartCount = restartCount + 1),
                registerCommTarget: noop,
                statusChanged: instance(mock<ISignal<Kernel.IKernelConnection, Kernel.Status>>()),
                connectionStatusChanged: instance(mock<ISignal<Kernel.IKernelConnection, Kernel.ConnectionStatus>>())
            },
            shutdown: () => Promise.resolve(),
            isRemoteSession: false
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        id: 'liveKernel'
    };
    function createJupyterSession(resource: Resource = undefined) {
        connection = mock<IJupyterConnection>();
        mockKernelSpec = {
            id: 'xyz',
            kind: 'startUsingLocalKernelSpec',
            kernelSpec: {
                argv: [],
                display_name: '',
                name: '',
                executable: ''
            }
        };
        session = mock<ISessionWithSocket>();
        kernel = mock<Kernel.IKernelConnection>();
        when(session.kernel).thenReturn(instance(kernel));
        statusChangedSignal = mock<ISignal<ISessionWithSocket, Kernel.Status>>();
        const sessionDisposed = new Signal<ISessionWithSocket, void>(instance(session));
        kernelChangedSignal = mock<ISignal<ISessionWithSocket, IKernelChangedArgs>>();
        const ioPubSignal =
            mock<ISignal<ISessionWithSocket, KernelMessage.IIOPubMessage<KernelMessage.IOPubMessageType>>>();
        when(session.disposed).thenReturn(sessionDisposed);
        when(session.statusChanged).thenReturn(instance(statusChangedSignal));
        when(session.kernelChanged).thenReturn(instance(kernelChangedSignal));
        when(session.iopubMessage).thenReturn(instance(ioPubSignal));
        when(session.unhandledMessage).thenReturn(instance(ioPubSignal));
        when(session.kernel).thenReturn(instance(kernel));
        when(session.isDisposed).thenReturn(false);
        when(kernel.status).thenReturn('idle');
        when(kernel.statusChanged).thenReturn(instance(mock<ISignal<Kernel.IKernelConnection, Kernel.Status>>()));
        when(kernel.connectionStatusChanged).thenReturn(
            instance(mock<ISignal<Kernel.IKernelConnection, Kernel.ConnectionStatus>>())
        );
        when(connection.rootDirectory).thenReturn(Uri.file(''));
        when(connection.localLaunch).thenReturn(false);
        const channel = new MockOutputChannel('JUPYTER');
        const kernelService = mock(JupyterKernelService);
        when(kernelService.ensureKernelIsUsable(anything(), anything(), anything(), anything())).thenResolve();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (instance(session) as any).then = undefined;
        sessionManager = mock(SessionManager);
        contentsManager = mock(ContentsManager);
        specManager = mock(KernelSpecManager);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        when(sessionManager.connectTo(anything())).thenReturn(newActiveRemoteKernel.model as any);
        const fs = mock<FileSystem>();
        const tmpFile = path.join('tmp', 'tempfile.json');
        const backingFileCreator = new BackingFileCreator();
        const requestCreator = new JupyterRequestCreator();
        when(fs.createTemporaryLocalFile(anything())).thenResolve({ dispose: noop, filePath: tmpFile });
        when(fs.delete(anything())).thenResolve();
        when(fs.createDirectory(anything())).thenResolve();
        jupyterSession = new JupyterSession(
            resource,
            instance(connection),
            mockKernelSpec,
            instance(specManager),
            instance(sessionManager),
            instance(contentsManager),
            channel,
            Uri.file(''),
            1,
            instance(kernelService),
            1,
            backingFileCreator,
            requestCreator,
            'jupyterExtension'
        );
    }
    setup(() => createJupyterSession());
    async function connect(
        kind: 'startUsingLocalKernelSpec' | 'connectToLiveRemoteKernel' = 'startUsingLocalKernelSpec'
    ) {
        const nbFile = 'file path';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        when(contentsManager.newUntitled(anything())).thenResolve({ path: nbFile } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        when(contentsManager.rename(anything(), anything())).thenResolve({ path: nbFile } as any);
        when(contentsManager.delete(anything())).thenResolve();
        when(sessionManager.startNew(anything(), anything())).thenResolve(instance(session));
        const specOrModel = { name: 'some name', id: 'xyz', model: 'xxx' } as any;
        (mockKernelSpec as any).kernelModel = specOrModel;
        (mockKernelSpec as any).kernelSpec = specOrModel;
        mockKernelSpec.kind = kind;

        const token = new CancellationTokenSource();
        try {
            await jupyterSession.connect({ ui: new DisplayOptions(false), token: token.token });
        } finally {
            token.dispose();
        }
    }
    teardown(async () => jupyterSession.dispose().catch(noop));

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
                    kind: 'startUsingLocalKernelSpec',
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
                    kind: 'connectToLiveRemoteKernel',
                    kernelModel: {} as any,
                    baseUrl: '',
                    serverId: ''
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
                    kind: 'startUsingLocalKernelSpec',
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
                    kind: 'connectToLiveRemoteKernel',
                    kernelModel: {} as any,
                    baseUrl: '',
                    serverId: ''
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
            const token = new CancellationTokenSource();
            suiteTeardown(() => token.dispose());
            test('Will timeout', async () => {
                when(kernel.status).thenReturn('unknown');

                const promise = jupyterSession.waitForIdle(100, token.token);

                await assert.isRejected(promise, DataScience.jupyterLaunchTimedOut());
            });
            test('Will succeed', async () => {
                when(kernel.status).thenReturn('idle');

                await jupyterSession.waitForIdle(100, token.token);

                verify(kernel.status).atLeast(1);
            });
        });
        suite('Local Sessions', async () => {
            let newSession: Session.ISessionConnection;
            let newKernelConnection: Kernel.IKernelConnection;
            let newStatusChangedSignal: ISignal<Session.ISessionConnection, Kernel.Status>;
            let newKernelChangedSignal: ISignal<Session.ISessionConnection, IKernelChangedArgs>;
            let newSessionCreated: Deferred<void>;
            let sessionDisposed: Signal<Session.ISessionConnection, void>;
            setup(async () => {
                newSession = mock(SessionConnection);
                sessionDisposed = new Signal<Session.ISessionConnection, void>(instance(newSession));
                when(newSession.disposed).thenReturn(sessionDisposed);
                newKernelConnection = mock<Kernel.IKernelConnection>();
                newStatusChangedSignal = mock<ISignal<Session.ISessionConnection, Kernel.Status>>();
                newKernelChangedSignal = mock<ISignal<Session.ISessionConnection, IKernelChangedArgs>>();
                const newIoPubSignal =
                    mock<
                        ISignal<Session.ISessionConnection, KernelMessage.IIOPubMessage<KernelMessage.IOPubMessageType>>
                    >();
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
                when(newKernelConnection.statusChanged).thenReturn(
                    instance(mock<ISignal<Kernel.IKernelConnection, Kernel.Status>>())
                );
                when(newKernelConnection.connectionStatusChanged).thenReturn(
                    instance(mock<ISignal<Kernel.IKernelConnection, Kernel.ConnectionStatus>>())
                );
                when(sessionManager.startNew(anything(), anything())).thenCall(() => {
                    newSessionCreated.resolve();
                    return Promise.resolve(instance(newSession));
                });
            });
            teardown(() => {
                verify(sessionManager.connectTo(anything())).never();
            });
            suite('Executing user code', async () => {
                setup(executeUserCode);

                async function executeUserCode() {
                    const future =
                        mock<Kernel.IFuture<KernelMessage.IShellControlMessage, KernelMessage.IShellControlMessage>>();
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
                    const oldSessionDispose = createDeferred();
                    when(connection.localLaunch).thenReturn(true);
                    when(session.isRemoteSession).thenReturn(false);
                    when(session.isDisposed).thenReturn(false);
                    when(session.shutdown()).thenCall(() => {
                        oldSessionShutDown.resolve();
                        return Promise.resolve();
                    });
                    when(session.dispose()).thenCall(() => {
                        oldSessionDispose.resolve();
                        return Promise.resolve();
                    });
                    const sessionServerSettings: ServerConnection.ISettings = mock<ServerConnection.ISettings>();
                    when(session.serverSettings).thenReturn(instance(sessionServerSettings));

                    await jupyterSession.restart();

                    // We should kill session and switch to new session, starting a new restart session.
                    await Promise.all([oldSessionShutDown.promise, oldSessionDispose.promise]);
                    verify(session.shutdown()).once();
                    verify(session.dispose()).once();
                    // Confirm kernel isn't restarted.
                    verify(kernel.restart()).never();
                });
                test('Restart should fail if new session dies while waiting for it to be idle', async () => {
                    when(connection.localLaunch).thenReturn(true);
                    when(session.isRemoteSession).thenReturn(false);
                    when(session.isDisposed).thenReturn(false);
                    when(session.shutdown()).thenResolve();
                    when(session.dispose()).thenResolve();
                    const sessionServerSettings: ServerConnection.ISettings = mock<ServerConnection.ISettings>();
                    when(session.serverSettings).thenReturn(instance(sessionServerSettings));

                    const promise = jupyterSession.restart();
                    // Mark the new session as disposed
                    when(newSession.isDisposed).thenReturn(true);
                    // Ensure the we trigger the event indicating the session got disposed.
                    // We don't know when the event handler will get bound, hence trigger the event every 100ms.
                    const timer = setInterval(() => sessionDisposed.emit(), 100);
                    try {
                        await assert.isRejected(promise, new JupyterInvalidKernelError(mockKernelSpec).message);
                    } finally {
                        clearInterval(timer);
                    }
                });
            });
        });
    });

    suite('Remote Sessions', () => {
        let remoteSession: ISessionWithSocket;
        let remoteKernel: Kernel.IKernelConnection;
        let remoteSessionInstance: ISessionWithSocket;
        suite('Switching kernels', () => {
            setup(async () => {
                remoteSession = mock<ISessionWithSocket>();
                remoteKernel = mock<Kernel.IKernelConnection>();
                remoteSessionInstance = instance(remoteSession);
                remoteSessionInstance.isRemoteSession = false;
                when(remoteSession.kernel).thenReturn(instance(remoteKernel));
                when(remoteKernel.registerCommTarget(anything(), anything())).thenReturn();
                const connectionStatusChanged = mock<ISignal<Kernel.IKernelConnection, Kernel.ConnectionStatus>>();
                when(remoteKernel.connectionStatusChanged).thenReturn(instance(connectionStatusChanged));
                when(sessionManager.startNew(anything(), anything())).thenCall(() => {
                    return Promise.resolve(instance(remoteSession));
                });

                const signal = mock<ISignal<ISessionWithSocket, Kernel.Status>>();
                when(remoteSession.statusChanged).thenReturn(instance(signal));
                when(remoteSession.unhandledMessage).thenReturn(
                    instance(mock<ISignal<ISessionWithSocket, KernelMessage.IMessage<KernelMessage.MessageType>>>())
                );
                when(remoteSession.iopubMessage).thenReturn(
                    instance(
                        mock<ISignal<ISessionWithSocket, KernelMessage.IIOPubMessage<KernelMessage.IOPubMessageType>>>()
                    )
                );

                await connect('connectToLiveRemoteKernel');
            });
            test('Restart should restart the new remote kernel', async () => {
                when(remoteKernel.restart()).thenResolve();
                restartCount = 0;

                await jupyterSession.restart();

                assert.isTrue((newActiveRemoteKernel.model as any).isRemoteSession);
                // We should restart the kernel, not a new session.
                verify(sessionManager.startNew(anything(), anything())).never();
                assert.equal(restartCount, 1, 'Did not restart the kernel');
                verify(remoteSession.shutdown()).never();
                verify(remoteSession.dispose()).never();
            });
        });
    });
});
