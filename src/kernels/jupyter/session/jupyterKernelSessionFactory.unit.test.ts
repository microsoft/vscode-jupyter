// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sinon from 'sinon';
import { ISignal, Signal } from '@lumino/signaling';
import { IChangedArgs } from '@jupyterlab/coreutils';
import {
    ContentsManager,
    Kernel,
    KernelManager,
    KernelMessage,
    KernelSpecManager,
    ServerConnection,
    Session,
    SessionManager
} from '@jupyterlab/services';
import { mock, when, instance, verify, anything } from 'ts-mockito';
import { CancellationTokenSource, Disposable, Uri } from 'vscode';
import {
    IJupyterConnection,
    IKernelSocket,
    KernelSessionCreationOptions,
    LocalKernelSpecConnectionMetadata,
    RemoteKernelSpecConnectionMetadata
} from '../../types';
import { noop } from '../../../test/core';
import { assert } from 'chai';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import {
    IAsyncDisposable,
    IConfigurationService,
    IDisposable,
    IWatchableJupyterSettings
} from '../../../platform/common/types';
import { NewJupyterKernelSessionFactory } from './jupyterKernelSessionFactory';
import { IWorkspaceService } from '../../../platform/common/application/types';
import { JupyterConnection } from '../connection/jupyterConnection';
import {
    IJupyterServerProvider,
    IJupyterRequestCreator,
    IJupyterBackingFileCreator,
    IJupyterKernelService
} from '../types';
import { DisplayOptions } from '../../displayOptions';
import { JupyterLabHelper } from './jupyterSessionManager';
import { resolvableInstance } from '../../../test/datascience/helpers';
import { swallowExceptions } from '../../../platform/common/utils/misc';

suite('New Jupyter Kernel Session Factory', () => {
    const resource = Uri.parse('a.ipynb');
    let factory: NewJupyterKernelSessionFactory;
    let jupyterNotebookProvider: IJupyterServerProvider;
    let jupyterConnection: JupyterConnection;
    let asyncDisposables: IAsyncDisposable[];
    let workspaceService: IWorkspaceService;
    let requestCreator: IJupyterRequestCreator;
    let backingFileCreator: IJupyterBackingFileCreator;
    let kernelService: IJupyterKernelService;
    let configService: IConfigurationService;
    let settings: IWatchableJupyterSettings;
    let sessionManager: SessionManager;
    const kernelConnectionMetadata = LocalKernelSpecConnectionMetadata.create({
        id: '1234',
        kernelSpec: {} as any
    });
    let socket: IKernelSocket;
    const disposables: IDisposable[] = [];
    let token: CancellationTokenSource;
    let ui: DisplayOptions;
    const jupyterLaunchTimeout = 1_000;
    let connection: IJupyterConnection;

    const localPythonWithoutInterpreterKernelConnectionMetadata = LocalKernelSpecConnectionMetadata.create({
        id: '1234',
        kernelSpec: {
            argv: ['python', '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
            display_name: 'Python 3',
            executable: 'python',
            name: 'python3'
        }
    });
    const remoteKernelSpec = RemoteKernelSpecConnectionMetadata.create({
        id: '1234',
        kernelSpec: {
            argv: ['python', '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
            display_name: 'Python 3',
            executable: 'python',
            name: 'python3'
        },
        baseUrl: 'http://localhost:8888',
        serverId: '1234'
    });
    const localPythonWithInterpreterKernelConnectionMetadata = LocalKernelSpecConnectionMetadata.create({
        id: '1234',
        kernelSpec: {
            argv: ['python', '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
            display_name: 'Python 3',
            executable: 'python',
            name: 'python3'
        },
        interpreter: {
            id: '1234',
            sysPrefix: '',
            displayName: ''
        } as any
    });
    let serverSettings: ServerConnection.ISettings;
    setup(() => {
        jupyterNotebookProvider = mock<IJupyterServerProvider>();
        jupyterConnection = mock<JupyterConnection>();
        asyncDisposables = [] as any;
        workspaceService = mock<IWorkspaceService>();
        requestCreator = mock<IJupyterRequestCreator>();
        backingFileCreator = mock<IJupyterBackingFileCreator>();
        kernelService = mock<IJupyterKernelService>();
        configService = mock<IConfigurationService>();
        settings = mock<IWatchableJupyterSettings>();
        connection = mock<IJupyterConnection>();
        sessionManager = mock<SessionManager>();
        socket = mock<IKernelSocket>();
        serverSettings = mock<ServerConnection.ISettings>();

        token = new CancellationTokenSource();
        disposables.push(token);
        ui = new DisplayOptions(false);
        disposables.push(ui);

        when(settings.jupyterLaunchTimeout).thenReturn(jupyterLaunchTimeout);
        when(configService.getSettings(anything())).thenReturn(instance(settings));
        when(requestCreator.getWebsocket(anything())).thenReturn(instance(socket));

        when(workspaceService.computeWorkingDirectory(anything())).thenResolve('someDir');
        when(
            kernelService.ensureKernelIsUsable(anything(), kernelConnectionMetadata, ui, token.token, false)
        ).thenResolve();
        when(jupyterConnection.createConnectionInfo(anything())).thenResolve(resolvableInstance(connection));
        when(jupyterConnection.getServerConnectSettings(anything())).thenResolve(resolvableInstance(serverSettings));
        when(jupyterNotebookProvider.getOrStartServer(anything())).thenResolve(resolvableInstance(connection));

        when(connection.localLaunch).thenReturn(true);
        when(connection.baseUrl).thenReturn('http://localhost:8888');
        when(connection.hostName).thenReturn('localhost');
        when(connection.displayName).thenReturn('Hello World');
        when(connection.dispose()).thenReturn();
        when(connection.getAuthHeader).thenReturn();
        when(connection.getWebsocketProtocols).thenReturn();
        when(connection.mappedRemoteNotebookDir).thenReturn();
        when(connection.providerId).thenReturn('_builtin.something');
        when(connection.rootDirectory).thenReturn(Uri.file('someDir'));
        when(connection.token).thenReturn('1234');

        const stub: JupyterLabHelper = {
            contentsManager: instance(mock<ContentsManager>()),
            kernelManager: instance(mock<KernelManager>()),
            kernelSpecManager: instance(mock<KernelSpecManager>()),
            dispose: () => Promise.resolve(),
            getKernelSpecs: () => Promise.resolve([]),
            getRunningKernels: () => Promise.resolve([]),
            getRunningSessions: () => Promise.resolve([]),
            sessionManager: instance(sessionManager)
        } as unknown as JupyterLabHelper;
        sinon.stub(JupyterLabHelper, 'create').callsFake(() => stub);

        factory = new NewJupyterKernelSessionFactory(
            instance(jupyterNotebookProvider),
            instance(jupyterConnection),
            asyncDisposables as any,
            instance(workspaceService),
            instance(requestCreator),
            instance(backingFileCreator),
            instance(kernelService),
            instance(configService)
        );
    });
    teardown(async () => {
        sinon.restore();
        disposeAllDisposables(disposables);
        await Promise.all(asyncDisposables.map((d) => swallowExceptions(() => d.dispose().catch(noop))));
    });
    function createSession() {
        const session = mock<Session.ISessionConnection>();
        const kernel = mock<Kernel.IKernelConnection>();
        when(session.shutdown()).thenResolve();
        when(session.dispose()).thenReturn();
        when(session.kernel).thenReturn(instance(kernel));
        const sessionDisposed = new Signal<Session.ISessionConnection, void>(instance(session));
        const sessionPropertyChanged = new Signal<Session.ISessionConnection, 'path'>(instance(session));
        const sessionIOPubMessage = new Signal<Session.ISessionConnection, KernelMessage.IIOPubMessage>(
            instance(session)
        );
        const sessionKernelChanged = new Signal<
            Session.ISessionConnection,
            IChangedArgs<Kernel.IKernelConnection | null, Kernel.IKernelConnection | null, 'kernel'>
        >(instance(session));
        const sessionUnhandledMessage = new Signal<Session.ISessionConnection, KernelMessage.IMessage>(
            instance(session)
        );
        const sessionConnectionStatusChanged = new Signal<Session.ISessionConnection, Kernel.ConnectionStatus>(
            instance(session)
        );
        const sessionAnyMessage = new Signal<Session.ISessionConnection, Kernel.IAnyMessageArgs>(instance(session));
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
        disposables.push(new Disposable(() => Signal.disconnectAll(instance(session))));
        disposables.push(new Disposable(() => Signal.disconnectAll(instance(kernel))));
        return { session, kernel };
    }
    test('Start new Local Session (Python without interpreter info)', async () => {
        const resource = Uri.parse('a.ipynb');
        const options: KernelSessionCreationOptions = {
            kernelConnection: localPythonWithoutInterpreterKernelConnectionMetadata,
            creator: 'jupyterExtension',
            resource,
            token: token.token,
            ui
        };
        const { session, kernel } = createSession();
        when(sessionManager.startNew(anything(), anything())).thenResolve(resolvableInstance(session));

        const wrapperSession = await factory.create(options);

        assert.ok(wrapperSession);

        verify(kernelService.ensureKernelIsUsable(anything(), anything(), anything(), anything(), false)).never();
        verify(jupyterNotebookProvider.getOrStartServer(anything())).once();
        verify(sessionManager.startNew(anything(), anything())).once();
        verify(workspaceService.computeWorkingDirectory(anything())).once();
        verify(jupyterConnection.createConnectionInfo(anything())).never();
        verify(jupyterConnection.getServerConnectSettings(anything())).once()

        when(kernel.status).thenReturn('idle');
        assert.strictEqual(wrapperSession.status, 'idle');
        when(kernel.status).thenReturn('busy');
        assert.strictEqual(wrapperSession.status, 'busy');
    });
    test('Start new Local Session (Python with interpreter info)', async () => {
        const resource = Uri.parse('a.ipynb');
        const options: KernelSessionCreationOptions = {
            kernelConnection: localPythonWithInterpreterKernelConnectionMetadata,
            creator: 'jupyterExtension',
            resource,
            token: token.token,
            ui
        };
        const { session, kernel } = createSession();
        when(sessionManager.startNew(anything(), anything())).thenResolve(resolvableInstance(session));

        const wrapperSession = await factory.create(options);

        assert.ok(wrapperSession);

        verify(kernelService.ensureKernelIsUsable(anything(), anything(), anything(), anything(), false)).once();
        verify(jupyterNotebookProvider.getOrStartServer(anything())).once();
        verify(sessionManager.startNew(anything(), anything())).once();

        when(kernel.status).thenReturn('idle');
        assert.strictEqual(wrapperSession.status, 'idle');
        when(kernel.status).thenReturn('busy');
        assert.strictEqual(wrapperSession.status, 'busy');
    });
    test('Fails to start new Local Session with error from Jupyter', async () => {
        const resource = Uri.parse('a.ipynb');
        const options: KernelSessionCreationOptions = {
            kernelConnection: localPythonWithInterpreterKernelConnectionMetadata,
            creator: 'jupyterExtension',
            resource,
            token: token.token,
            ui
        };
        when(sessionManager.startNew(anything(), anything())).thenReject(new Error('Kaboom'));

        const promise = factory.create(options);

        await assert.isRejected(promise, 'Kaboom');
    });
    test('Fails to start new Local Session if Kernel is undefined', async () => {
        const options: KernelSessionCreationOptions = {
            kernelConnection: localPythonWithInterpreterKernelConnectionMetadata,
            creator: 'jupyterExtension',
            resource,
            token: token.token,
            ui
        };

        const { session } = createSession();
        when(session.kernel).thenReturn(null);
        when(sessionManager.startNew(anything(), anything())).thenResolve(resolvableInstance(session));

        const promise = factory.create(options);

        await assert.isRejected(promise, 'No kernel created');
    });
    test('Start new remote Session', async () => {
        when(connection.localLaunch).thenReturn(false);
        const resource = Uri.parse('a.ipynb');
        const options: KernelSessionCreationOptions = {
            kernelConnection: remoteKernelSpec,
            creator: 'jupyterExtension',
            resource,
            token: token.token,
            ui
        };
        const { session, kernel } = createSession();
        when(sessionManager.startNew(anything(), anything())).thenResolve(resolvableInstance(session));

        const wrapperSession = await factory.create(options);

        assert.ok(wrapperSession);

        verify(kernelService.ensureKernelIsUsable(anything(), anything(), anything(), anything(), false)).never();
        verify(jupyterNotebookProvider.getOrStartServer(anything())).never();
        verify(workspaceService.computeWorkingDirectory(anything())).never();
        verify(sessionManager.startNew(anything(), anything())).once();
        verify(jupyterConnection.createConnectionInfo(anything())).once();
        verify(jupyterConnection.getServerConnectSettings(anything())).once()

        when(kernel.status).thenReturn('idle');
        assert.strictEqual(wrapperSession.status, 'idle');
        when(kernel.status).thenReturn('busy');
        assert.strictEqual(wrapperSession.status, 'busy');
    });
});
