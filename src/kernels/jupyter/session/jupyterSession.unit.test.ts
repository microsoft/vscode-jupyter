// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IChangedArgs } from '@jupyterlab/coreutils';
import * as fakeTimers from '@sinonjs/fake-timers';
import {
    ContentsManager,
    Kernel,
    KernelMessage,
    KernelSpecManager,
    ServerConnection,
    Session,
    SessionManager
} from '@jupyterlab/services';
import { ISignal, Signal } from '@lumino/signaling';
import { assert } from 'chai';
import { anything, capture, instance, mock, verify, when } from 'ts-mockito';
import { CancellationTokenSource, Disposable, Uri } from 'vscode';
import { IDisposable, ReadWrite, Resource } from '../../../platform/common/types';
import { createDeferred, Deferred } from '../../../platform/common/utils/async';
import { DataScience } from '../../../platform/common/utils/localize';
import { noop } from '../../../platform/common/utils/misc';
import {
    IJupyterConnection,
    IKernelSocket,
    INewSessionWithSocket,
    ISessionWithSocket,
    KernelConnectionMetadata,
    LiveRemoteKernelConnectionMetadata,
    LocalKernelSpecConnectionMetadata,
    RemoteKernelSpecConnectionMetadata
} from '../../../kernels/types';
import { JupyterKernelService } from '../../../kernels/jupyter/session/jupyterKernelService.node';
import { JupyterSessionWrapper, OldJupyterSession } from '../../../kernels/jupyter/session/jupyterSession';
import { DisplayOptions } from '../../../kernels/displayOptions';
import { FileSystem } from '../../../platform/common/platform/fileSystem.node';
import { BackingFileCreator } from '../../../kernels/jupyter/session/backingFileCreator.node';
import * as path from '../../../platform/vscode-path/path';
import { JupyterRequestCreator } from '../../../kernels/jupyter/session/jupyterRequestCreator.node';
import { JupyterInvalidKernelError } from '../../../kernels/errors/jupyterInvalidKernelError';
import { MockOutputChannel } from '../../../test/mockClasses';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { resolvableInstance } from '../../../test/datascience/helpers';

/* eslint-disable , @typescript-eslint/no-explicit-any */
suite('Old JupyterSession', () => {
    const disposables: IDisposable[] = [];
    type IKernelChangedArgs = IChangedArgs<Kernel.IKernelConnection | null, Kernel.IKernelConnection | null, 'kernel'>;
    let jupyterSession: OldJupyterSession;
    let connection: IJupyterConnection;
    let mockKernelSpec: ReadWrite<KernelConnectionMetadata>;
    let sessionManager: SessionManager;
    let contentsManager: ContentsManager;
    let specManager: KernelSpecManager;
    let session: ISessionWithSocket;
    let kernel: Kernel.IKernelConnection;
    let statusChangedSignal: ISignal<ISessionWithSocket, Kernel.Status>;
    let kernelChangedSignal: ISignal<ISessionWithSocket, IKernelChangedArgs>;
    let token: CancellationTokenSource;
    function createJupyterSession(resource: Resource = undefined, kernelConnection?: KernelConnectionMetadata) {
        connection = mock<IJupyterConnection>();
        when(connection.mappedRemoteNotebookDir).thenReturn(undefined);
        token = new CancellationTokenSource();
        disposables.push(token);

        mockKernelSpec =
            kernelConnection ||
            LocalKernelSpecConnectionMetadata.create({
                id: 'xyz',
                kernelSpec: {
                    argv: [],
                    display_name: '',
                    name: '',
                    executable: ''
                }
            });
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
        when(session.propertyChanged).thenReturn(new Signal<ISessionWithSocket, 'path'>(instance(session)));
        when(session.connectionStatusChanged).thenReturn(
            new Signal<ISessionWithSocket, Kernel.ConnectionStatus>(instance(session))
        );
        when(session.anyMessage).thenReturn(new Signal<ISessionWithSocket, Kernel.IAnyMessageArgs>(instance(session)));
        when(session.kernel).thenReturn(instance(kernel));
        when(session.isDisposed).thenReturn(false);
        when(kernel.status).thenReturn('idle');
        when(kernel.statusChanged).thenReturn(instance(mock<ISignal<Kernel.IKernelConnection, Kernel.Status>>()));
        when(kernel.iopubMessage).thenReturn(
            instance(
                mock<ISignal<Kernel.IKernelConnection, KernelMessage.IIOPubMessage<KernelMessage.IOPubMessageType>>>()
            )
        );
        // when(kernel.anyMessage).thenReturn(instance(mock<ISignal<Kernel.IKernelConnection, Kernel.IAnyMessageArgs>>()));
        when(kernel.anyMessage).thenReturn({ connect: noop, disconnect: noop } as any);
        when(kernel.unhandledMessage).thenReturn(
            instance(mock<ISignal<Kernel.IKernelConnection, KernelMessage.IMessage<KernelMessage.MessageType>>>())
        );
        when(kernel.disposed).thenReturn(instance(mock<ISignal<Kernel.IKernelConnection, void>>()));
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
        when(sessionManager.connectTo(anything())).thenReturn(instance(session));
        const fs = mock<FileSystem>();
        const tmpFile = path.join('tmp', 'tempfile.json');
        const backingFileCreator = new BackingFileCreator();
        const requestCreator = new JupyterRequestCreator();
        when(fs.createTemporaryLocalFile(anything())).thenResolve({ dispose: noop, filePath: tmpFile });
        when(fs.delete(anything())).thenResolve();
        when(fs.createDirectory(anything())).thenResolve();
        jupyterSession = new OldJupyterSession(
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
            backingFileCreator,
            requestCreator,
            'jupyterExtension'
        );
    }
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
    teardown(async () => {
        await jupyterSession.dispose().catch(noop);
        disposeAllDisposables(disposables);
    });

    suite('Start', () => {
        setup(() => createJupyterSession());

        test('Start a session when connecting', async () => {
            await connect();

            assert.isTrue(jupyterSession.isConnected);
            verify(sessionManager.startNew(anything(), anything())).once();
        });
    });
    suite('After connecting', () => {
        setup(() => {
            createJupyterSession();
            return connect();
        });
        suite('Shutdown', () => {
            test('Remote session with Interactive and starting a new session', async () => {
                // Create jupyter session for Interactive window
                createJupyterSession(Uri.file('test.py'));
                await connect();

                when(connection.localLaunch).thenReturn(false);
                when(sessionManager.refreshRunning()).thenResolve();
                when(session.isRemoteSession).thenReturn(true);
                when(session.kernelConnectionMetadata).thenReturn(
                    LocalKernelSpecConnectionMetadata.create({
                        id: '',
                        kernelSpec: {} as any
                    })
                );
                when(session.shutdown()).thenResolve();
                when(session.dispose()).thenReturn();

                await jupyterSession.dispose();

                verify(sessionManager.refreshRunning()).never();
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
                when(session.kernelConnectionMetadata).thenReturn(
                    LiveRemoteKernelConnectionMetadata.create({
                        id: '',
                        kernelModel: {} as any,
                        baseUrl: '',
                        serverId: ''
                    })
                );
                when(session.shutdown()).thenResolve();
                when(session.dispose()).thenReturn();

                await jupyterSession.dispose();

                verify(sessionManager.refreshRunning()).never();
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
                when(session.kernelConnectionMetadata).thenReturn(
                    LocalKernelSpecConnectionMetadata.create({
                        id: '',
                        kernelSpec: {} as any
                    })
                );
                when(session.shutdown()).thenResolve();
                when(session.dispose()).thenReturn();

                await jupyterSession.dispose();

                verify(sessionManager.refreshRunning()).never();
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
                when(session.kernelConnectionMetadata).thenReturn(
                    LiveRemoteKernelConnectionMetadata.create({
                        id: '',
                        kernelModel: {} as any,
                        baseUrl: '',
                        serverId: ''
                    })
                );
                when(session.shutdown()).thenResolve();
                when(session.dispose()).thenReturn();

                await jupyterSession.dispose();

                verify(sessionManager.refreshRunning()).never();
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

                await assert.isRejected(promise, DataScience.jupyterLaunchTimedOut);
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
                newSession = mock<Session.ISessionConnection>();
                sessionDisposed = new Signal<Session.ISessionConnection, void>(instance(newSession));
                when(newSession.disposed).thenReturn(sessionDisposed);
                when(newSession.isDisposed).thenReturn(false);
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
                when(newSession.propertyChanged).thenReturn(
                    new Signal<Session.ISessionConnection, 'path'>(instance(newSession))
                );
                when(newSession.connectionStatusChanged).thenReturn(
                    new Signal<Session.ISessionConnection, Kernel.ConnectionStatus>(instance(newSession))
                );
                when(newSession.anyMessage).thenReturn(
                    new Signal<Session.ISessionConnection, Kernel.IAnyMessageArgs>(instance(newSession))
                );
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (instance(newSession) as any).then = undefined;
                newSessionCreated = createDeferred();
                when(session.isRemoteSession).thenReturn(false);
                when(newKernelConnection.id).thenReturn('restartId');
                when(newKernelConnection.clientId).thenReturn('restartClientId');
                when(newKernelConnection.status).thenReturn('idle');
                when(newKernelConnection.disposed).thenReturn({ connect: noop, disconnect: noop } as any);
                when(newKernelConnection.statusChanged).thenReturn({ connect: noop, disconnect: noop } as any);
                when(newKernelConnection.connectionStatusChanged).thenReturn({
                    connect: noop,
                    disconnect: noop
                } as any);
                when(newKernelConnection.anyMessage).thenReturn({ connect: noop, disconnect: noop } as any);
                when(newKernelConnection.iopubMessage).thenReturn({ connect: noop, disconnect: noop } as any);
                when(newKernelConnection.unhandledMessage).thenReturn({ connect: noop, disconnect: noop } as any);
                when(newSession.kernel).thenReturn(instance(newKernelConnection));
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

                    const result = jupyterSession.kernel!.requestExecute({
                        code: '',
                        allow_stdin: false,
                        silent: false
                    });

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
                createJupyterSession();

                remoteSession = mock<ISessionWithSocket>();
                remoteKernel = mock<Kernel.IKernelConnection>();
                remoteSessionInstance = instance(remoteSession);
                remoteSessionInstance.isRemoteSession = false;
                when(remoteSession.kernel).thenReturn(instance(remoteKernel));
                when(remoteSession.disposed).thenReturn(new Signal<ISessionWithSocket, void>(instance(remoteSession)));
                when(remoteSession.propertyChanged).thenReturn(
                    new Signal<ISessionWithSocket, 'path'>(instance(remoteSession))
                );
                when(remoteSession.connectionStatusChanged).thenReturn(
                    new Signal<ISessionWithSocket, Kernel.ConnectionStatus>(instance(remoteSession))
                );
                when(remoteSession.anyMessage).thenReturn(
                    new Signal<ISessionWithSocket, Kernel.IAnyMessageArgs>(instance(remoteSession))
                );
                when(remoteSession.kernelChanged).thenReturn(
                    new Signal<
                        ISessionWithSocket,
                        IChangedArgs<Kernel.IKernelConnection | null, Kernel.IKernelConnection | null, 'kernel'>
                    >(instance(remoteSession))
                );

                when(remoteKernel.registerCommTarget(anything(), anything())).thenReturn();
                const connectionStatusChanged = mock<ISignal<Kernel.IKernelConnection, Kernel.ConnectionStatus>>();
                when(remoteKernel.connectionStatusChanged).thenReturn(instance(connectionStatusChanged));
                when(sessionManager.startNew(anything(), anything())).thenCall(() => {
                    return resolvableInstance(remoteSession);
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

                await jupyterSession.restart();

                // We should restart the kernel, not a new session.
                verify(sessionManager.startNew(anything(), anything())).never();
                verify(kernel.restart()).once();
                verify(remoteSession.shutdown()).never();
                verify(remoteSession.dispose()).never();
            });
        });
        suite('Session Path and Names', () => {
            async function testSessionOptions(resource: Uri) {
                const remoteKernelSpec = RemoteKernelSpecConnectionMetadata.create({
                    baseUrl: 'http://localhost:8888',
                    id: '1',
                    kernelSpec: {
                        argv: [],
                        display_name: 'Python 3',
                        name: 'python3',
                        language: 'python',
                        executable: ''
                    },
                    serverId: '1'
                });
                createJupyterSession(resource, remoteKernelSpec);

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

                const nbFile = 'file path';
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                when(contentsManager.newUntitled(anything())).thenResolve({ path: nbFile } as any);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                when(contentsManager.rename(anything(), anything())).thenResolve({ path: nbFile } as any);
                when(contentsManager.delete(anything())).thenResolve();
                when(sessionManager.startNew(anything(), anything())).thenResolve(instance(session));
            }

            test('Create Session with Jupyter style names (notebook)', async () => {
                const resource = Uri.file('/foo/bar/baz/abc.ipynb');
                await testSessionOptions(resource);
                when(connection.mappedRemoteNotebookDir).thenReturn('/foo/bar');

                await jupyterSession.connect({ ui: new DisplayOptions(false), token: token.token });

                verify(contentsManager.newUntitled(anything())).never();
                verify(contentsManager.rename(anything(), anything())).never();
                verify(contentsManager.delete(anything())).never();

                const options = capture(sessionManager.startNew).first()[0];
                assert.strictEqual(options.name, 'abc.ipynb');
                assert.strictEqual(options.path, 'baz/abc.ipynb');
                assert.strictEqual(options.type, 'notebook');
                assert.deepStrictEqual(options.kernel, { name: 'python3' });
            });
            test('Create Session with Jupyter style names (interactive window with backing python file)', async () => {
                const resource = Uri.file('/foo/bar/abc.py');
                await testSessionOptions(resource);
                when(connection.mappedRemoteNotebookDir).thenReturn('/foo/bar');

                await jupyterSession.connect({ ui: new DisplayOptions(false), token: token.token });

                verify(contentsManager.newUntitled(anything())).never();
                verify(contentsManager.rename(anything(), anything())).never();
                verify(contentsManager.delete(anything())).never();

                const options = capture(sessionManager.startNew).first()[0];
                assert.strictEqual(options.name, 'abc.py');
                assert.strictEqual(options.path, 'abc.py');
                assert.strictEqual(options.type, 'console');
                assert.deepStrictEqual(options.kernel, { name: 'python3' });
            });
            test('Create Session with Jupyter style names (interactive window without backing files)', async () => {
                const resource = Uri.file('/Interactive-5.interactive');
                await testSessionOptions(resource);
                when(connection.mappedRemoteNotebookDir).thenReturn('/foo/bar');

                await jupyterSession.connect({ ui: new DisplayOptions(false), token: token.token });

                verify(contentsManager.newUntitled(anything())).never();
                verify(contentsManager.rename(anything(), anything())).never();
                verify(contentsManager.delete(anything())).never();

                const options = capture(sessionManager.startNew).first()[0];
                assert.include(options.name, 'Interactive-5');
                assert.include(options.name, '.interactive');
                assert.include(options.path, 'Interactive-5');
                assert.include(options.path, '.interactive');
                assert.strictEqual(options.type, 'console');
                assert.deepStrictEqual(options.kernel, { name: 'python3' });
            });
            test('Create Session with unique names (notebook, even with a mapping local path)', async () => {
                const resource = Uri.file('/foo/bar/baz/abc.ipynb');
                await testSessionOptions(resource);
                when(connection.mappedRemoteNotebookDir).thenReturn('/user/hello');

                await jupyterSession.connect({ ui: new DisplayOptions(false), token: token.token });

                verify(contentsManager.newUntitled(anything())).never();
                verify(contentsManager.rename(anything(), anything())).never();
                verify(contentsManager.delete(anything())).never();

                const options = capture(sessionManager.startNew).first()[0];
                assert.notInclude(options.name, 'abc.ipynb');
                assert.notInclude(options.path, 'baz/abc.ipynb');
                assert.ok(options.name.startsWith('abc'), `Starts with abc ${options.name}`);
                assert.include(options.path, 'abc-jvsc-');
                assert.strictEqual(options.type, 'notebook');
                assert.deepStrictEqual(options.kernel, { name: 'python3' });
            });
            test('Create Session with unique names (notebook)', async () => {
                const resource = Uri.file('/foo/bar/baz/abc.ipynb');
                await testSessionOptions(resource);

                await jupyterSession.connect({ ui: new DisplayOptions(false), token: token.token });

                verify(contentsManager.newUntitled(anything())).never();
                verify(contentsManager.rename(anything(), anything())).never();
                verify(contentsManager.delete(anything())).never();

                const options = capture(sessionManager.startNew).first()[0];
                assert.notInclude(options.name, 'abc.ipynb');
                assert.notInclude(options.path, 'baz/abc.ipynb');
                assert.strictEqual(options.type, 'notebook');
                assert.deepStrictEqual(options.kernel, { name: 'python3' });
            });
            test('Create Session with unique names (interactive window with backing python file)', async () => {
                const resource = Uri.file('/foo/bar/abc.py');
                await testSessionOptions(resource);

                await jupyterSession.connect({ ui: new DisplayOptions(false), token: token.token });

                verify(contentsManager.newUntitled(anything())).never();
                verify(contentsManager.rename(anything(), anything())).never();
                verify(contentsManager.delete(anything())).never();

                const options = capture(sessionManager.startNew).first()[0];
                assert.ok(options.name.startsWith('abc'), `Starts with abc ${options.name}`);
                assert.include(options.path, 'abc.py-jvsc-');
                assert.strictEqual(options.type, 'console');
                assert.deepStrictEqual(options.kernel, { name: 'python3' });
            });
            test('Create Session with unique names (interactive window without backing files)', async () => {
                const resource = Uri.file('/Interactive-5.interactive');
                await testSessionOptions(resource);

                await jupyterSession.connect({ ui: new DisplayOptions(false), token: token.token });

                verify(contentsManager.newUntitled(anything())).never();
                verify(contentsManager.rename(anything(), anything())).never();
                verify(contentsManager.delete(anything())).never();

                const options = capture(sessionManager.startNew).first()[0];
                assert.ok(options.name.startsWith('Interactive-5-'), `Starts with Interactive-5 ${options.name}`);
                assert.include(options.path, 'Interactive-5.interactive-jvsc');
                assert.strictEqual(options.type, 'console');
                assert.deepStrictEqual(options.kernel, { name: 'python3' });
            });
        });
    });
});

suite('JupyterSession', () => {
    const disposables: IDisposable[] = [];
    let jupyterSession: JupyterSessionWrapper;
    let connection: IJupyterConnection;
    let session: INewSessionWithSocket;
    let kernel: Kernel.IKernelConnection;
    let token: CancellationTokenSource;
    let clock: fakeTimers.InstalledClock;
    let sessionDisposed: Signal<INewSessionWithSocket, void>;
    let sessionPropertyChanged: Signal<INewSessionWithSocket, 'path'>;
    let sessionIOPubMessage: Signal<INewSessionWithSocket, KernelMessage.IIOPubMessage>;
    let sessionKernelChanged: Signal<
        INewSessionWithSocket,
        IChangedArgs<Kernel.IKernelConnection | null, Kernel.IKernelConnection | null, 'kernel'>
    >;
    let sessionUnhandledMessage: Signal<INewSessionWithSocket, KernelMessage.IMessage>;
    let sessionConnectionStatusChanged: Signal<INewSessionWithSocket, Kernel.ConnectionStatus>;
    let sessionAnyMessage: Signal<INewSessionWithSocket, Kernel.IAnyMessageArgs>;
    function createJupyterSession(resource: Resource = undefined, kernelConnectionMetadata: KernelConnectionMetadata) {
        connection = mock<IJupyterConnection>();
        when(connection.mappedRemoteNotebookDir).thenReturn(undefined);
        token = new CancellationTokenSource();
        disposables.push(token);

        session = mock<INewSessionWithSocket>();
        kernel = mock<Kernel.IKernelConnection>();
        when(session.shutdown()).thenResolve();
        when(session.dispose()).thenReturn();
        when(session.kernel).thenReturn(instance(kernel));
        sessionDisposed = new Signal<INewSessionWithSocket, void>(instance(session));
        sessionPropertyChanged = new Signal<INewSessionWithSocket, 'path'>(instance(session));
        sessionIOPubMessage = new Signal<INewSessionWithSocket, KernelMessage.IIOPubMessage>(instance(session));
        sessionKernelChanged = new Signal<
            INewSessionWithSocket,
            IChangedArgs<Kernel.IKernelConnection | null, Kernel.IKernelConnection | null, 'kernel'>
        >(instance(session));
        sessionUnhandledMessage = new Signal<INewSessionWithSocket, KernelMessage.IMessage>(instance(session));
        sessionConnectionStatusChanged = new Signal<INewSessionWithSocket, Kernel.ConnectionStatus>(instance(session));
        sessionAnyMessage = new Signal<INewSessionWithSocket, Kernel.IAnyMessageArgs>(instance(session));
        when(session.disposed).thenReturn(sessionDisposed);
        when(session.propertyChanged).thenReturn(sessionPropertyChanged);
        when(session.iopubMessage).thenReturn(sessionIOPubMessage);
        when(session.kernelChanged).thenReturn(sessionKernelChanged);
        when(session.statusChanged).thenReturn(new Signal<INewSessionWithSocket, Kernel.Status>(instance(session)));
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
        when(connection.localLaunch).thenReturn(false);
        const kernelService = mock(JupyterKernelService);
        when(kernelService.ensureKernelIsUsable(anything(), anything(), anything(), anything())).thenResolve();
        resolvableInstance(session);
        const requestCreator = mock<JupyterRequestCreator>();
        when(requestCreator.getWebsocket(anything())).thenReturn(instance(mock<IKernelSocket>()));
        jupyterSession = new JupyterSessionWrapper(
            instance(session),
            resource,
            kernelConnectionMetadata,
            Uri.file(''),
            instance(requestCreator),
            instance(connection)
        );
        disposables.push(new Disposable(() => clock.uninstall()));
    }
    teardown(async () => {
        await jupyterSession.dispose().catch(noop);
        disposeAllDisposables(disposables);
    });

    suite('Shutting down of sessions when disposing a session', () => {
        test('New Remote sessions started with Interactive should be shutdown when disposing the session', async () => {
            createJupyterSession(
                Uri.file('test.py'),
                RemoteKernelSpecConnectionMetadata.create({
                    id: '',
                    kernelSpec: {} as any,
                    baseUrl: '',
                    serverId: ''
                })
            );

            when(connection.localLaunch).thenReturn(false);
            when(session.shutdown()).thenResolve();
            when(session.dispose()).thenReturn();

            await jupyterSession.dispose();

            // Shutdown sessions started for Interactive window.
            verify(session.shutdown()).once();
            verify(session.dispose()).once();
        });
        test('Existing Remote session connected with Interactive should not be shutdown when disposing the session', async () => {
            createJupyterSession(
                Uri.file('test.py'),
                LiveRemoteKernelConnectionMetadata.create({
                    id: '',
                    kernelModel: {} as any,
                    baseUrl: '',
                    serverId: ''
                })
            );

            when(connection.localLaunch).thenReturn(false);
            when(session.shutdown()).thenResolve();
            when(session.dispose()).thenReturn();

            await jupyterSession.dispose();

            // Never shutdown live sessions connected from Interactive window.
            verify(session.shutdown()).never();
            verify(session.dispose()).once();
        });
        test('New Remote sessions started with Notebook should not be shutdown when disposing the session', async () => {
            createJupyterSession(
                Uri.file('test.ipynb'),
                RemoteKernelSpecConnectionMetadata.create({
                    id: '',
                    kernelSpec: {} as any,
                    baseUrl: '',
                    serverId: ''
                })
            );

            when(connection.localLaunch).thenReturn(false);
            when(session.shutdown()).thenResolve();
            when(session.dispose()).thenReturn();

            await jupyterSession.dispose();

            // Never shutdown sessions started from Notebooks.
            verify(session.shutdown()).never();
            verify(session.dispose()).once();
        });
        test('Existing Remote session connected with Notebook should not be shutdown when disposing the session', async () => {
            createJupyterSession(
                Uri.file('test.ipynb'),
                LiveRemoteKernelConnectionMetadata.create({
                    id: '',
                    kernelModel: {} as any,
                    baseUrl: '',
                    serverId: ''
                })
            );

            when(connection.localLaunch).thenReturn(false);
            when(session.shutdown()).thenResolve();
            when(session.dispose()).thenReturn();

            await jupyterSession.dispose();

            // Never shutdown live sessions connected from Notebooks.
            verify(session.shutdown()).never();
            verify(session.dispose()).once();
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

            when(connection.localLaunch).thenReturn(true);
            when(session.shutdown()).thenResolve();
            when(session.dispose()).thenReturn();

            await jupyterSession.dispose();

            // always kill the sessions.
            verify(session.shutdown()).once();
            verify(session.dispose()).once();
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
                                  serverId: ''
                              });
                    createJupyterSession(Uri.file('test.ipynb'), kernelConnection);
                });
                suiteTeardown(() => token.dispose());
                test('Will timeout', async () => {
                    when(kernel.status).thenReturn('unknown');
                    clock = fakeTimers.install();

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
                clock.uninstall();
            });

            async function executeUserCode() {
                const future =
                    mock<Kernel.IFuture<KernelMessage.IShellControlMessage, KernelMessage.IShellControlMessage>>();
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                when(future.done).thenReturn(Promise.resolve(undefined as any));
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                when(kernel.requestExecute(anything(), anything(), anything())).thenReturn(instance(future) as any);

                const result = jupyterSession.kernel!.requestExecute({
                    code: '',
                    allow_stdin: false,
                    silent: false
                });

                assert.isOk(result);
                await result!.done;
            }

            test('Restart should just restart the kernel', async () => {
                when(connection.localLaunch).thenReturn(true);
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
            });
        });
    });
});
