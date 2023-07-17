// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import { anything, instance, mock, when } from 'ts-mockito';
import { CancellationTokenSource, NotebookDocument, Disposable, EventEmitter, Uri } from 'vscode';
import { ContributedKernelFinderKind, IContributedKernelFinder } from '../../kernels/internalTypes';
import { PreferredRemoteKernelIdProvider } from '../../kernels/jupyter/connection/preferredRemoteKernelIdProvider';
import {
    IJupyterConnection,
    IKernelFinder,
    LiveKernelModel,
    LiveRemoteKernelConnectionMetadata,
    LocalKernelConnectionMetadata,
    LocalKernelSpecConnectionMetadata,
    PythonKernelConnectionMetadata,
    RemoteKernelConnectionMetadata,
    RemoteKernelSpecConnectionMetadata
} from '../../kernels/types';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { IDisposable } from '../../platform/common/types';
import { NotebookMetadata } from '../../platform/common/utils';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { ServiceContainer } from '../../platform/ioc/container';
import { uriEquals } from '../../test/datascience/helpers';
import { TestNotebookDocument } from '../../test/datascience/notebook/executionHelper';
import { PreferredKernelConnectionService } from './preferredKernelConnectionService';
import { JupyterConnection } from '../../kernels/jupyter/connection/jupyterConnection';

suite('Preferred Kernel Connection', () => {
    let preferredService: PreferredKernelConnectionService;
    let serviceContainer: ServiceContainer;
    let jupyterConnection: JupyterConnection;
    let kernelFinder: IKernelFinder;
    let remoteKernelFinder: IContributedKernelFinder<RemoteKernelConnectionMetadata>;
    let localKernelSpecFinder: IContributedKernelFinder<LocalKernelConnectionMetadata>;
    let localPythonEnvFinder: IContributedKernelFinder<PythonKernelConnectionMetadata>;
    let disposables: IDisposable[] = [];
    let notebookMetadata: NotebookMetadata;
    let notebook: NotebookDocument;
    let preferredRemoteKernelProvider: PreferredRemoteKernelIdProvider;
    let cancellation: CancellationTokenSource;
    let onDidChangeRemoteKernels: EventEmitter<{
        added?: RemoteKernelConnectionMetadata[];
        removed?: RemoteKernelConnectionMetadata[];
        updated?: RemoteKernelConnectionMetadata[];
    }>;
    let onDidChangeLocalKernels: EventEmitter<{
        added?: LocalKernelConnectionMetadata[];
        removed?: LocalKernelConnectionMetadata[];
        updated?: LocalKernelConnectionMetadata[];
    }>;
    let onDidChangePythonKernels: EventEmitter<{
        added?: PythonKernelConnectionMetadata[];
        removed?: PythonKernelConnectionMetadata[];
        updated?: PythonKernelConnectionMetadata[];
    }>;
    let interpreterService: IInterpreterService;
    const serverProviderHandle1 = { handle: 'handle1', id: 'id1' };
    const serverProviderHandle2 = { handle: 'handle2', id: 'id2' };
    const remoteLiveKernelConnection1 = LiveRemoteKernelConnectionMetadata.create({
        baseUrl: '',
        id: 'liveRemote1',
        kernelModel: instance(mock<LiveKernelModel>()),
        serverId: 'remoteServerId1',
        serverProviderHandle: serverProviderHandle1
    });
    const remoteLiveKernelConnection2 = LiveRemoteKernelConnectionMetadata.create({
        baseUrl: '',
        id: 'liveRemote2',
        kernelModel: instance(mock<LiveKernelModel>()),
        serverId: 'remoteServerId2',
        serverProviderHandle: serverProviderHandle2
    });
    const remoteLiveJavaKernelConnection = LiveRemoteKernelConnectionMetadata.create({
        baseUrl: '',
        id: 'liveRemoteJava',
        kernelModel: {
            lastActivityTime: new Date(),
            model: {
                id: 'xyz',
                kernel: {
                    name: 'java',
                    id: 'xyz'
                },
                path: 'baz/sample.ipynb',
                name: 'sample.ipynb',
                type: 'notebook'
            },
            name: 'java',
            numberOfConnections: 1
        },
        serverId: 'remoteServerId2',
        serverProviderHandle: serverProviderHandle2
    });
    const remoteJavaKernelSpec = RemoteKernelSpecConnectionMetadata.create({
        baseUrl: '',
        id: 'remoteJavaKernelSpec',
        kernelSpec: {
            argv: [],
            display_name: 'Java KernelSpec',
            executable: '',
            name: 'javaName',
            language: 'java'
        },
        serverId: 'remoteServerId2',
        serverProviderHandle: serverProviderHandle2
    });
    const localJavaKernelSpec = LocalKernelSpecConnectionMetadata.create({
        id: 'localJava',
        kernelSpec: {
            argv: [],
            display_name: 'Java KernelSpec',
            executable: '',
            name: 'javaName',
            language: 'java'
        }
    });
    let connection: IJupyterConnection;
    setup(() => {
        serviceContainer = mock<ServiceContainer>();
        jupyterConnection = mock(JupyterConnection);
        connection = mock<IJupyterConnection>();
        const iocStub = sinon.stub(ServiceContainer, 'instance').get(() => instance(serviceContainer));
        disposables.push(new Disposable(() => iocStub.restore()));
        cancellation = new CancellationTokenSource();
        disposables.push(cancellation);
        notebookMetadata = {
            orig_nbformat: 4,
            kernelspec: {
                display_name: 'Kernel Spec',
                name: 'kernelSpecName'
            },
            language_info: {
                name: 'languageName'
            }
        };
        notebook = new TestNotebookDocument(undefined, 'jupyter-notebook', { custom: { metadata: notebookMetadata } });

        kernelFinder = mock<IKernelFinder>();
        preferredRemoteKernelProvider = mock<PreferredRemoteKernelIdProvider>();
        remoteKernelFinder = mock<IContributedKernelFinder<RemoteKernelConnectionMetadata>>();
        localKernelSpecFinder = mock<IContributedKernelFinder<LocalKernelConnectionMetadata>>();
        localPythonEnvFinder = mock<IContributedKernelFinder<PythonKernelConnectionMetadata>>();
        interpreterService = mock<IInterpreterService>();

        onDidChangeRemoteKernels = new EventEmitter<{
            added?: RemoteKernelConnectionMetadata[];
            removed?: RemoteKernelConnectionMetadata[];
            updated?: RemoteKernelConnectionMetadata[];
        }>();
        onDidChangeLocalKernels = new EventEmitter<{
            added?: LocalKernelConnectionMetadata[];
            removed?: LocalKernelConnectionMetadata[];
            updated?: LocalKernelConnectionMetadata[];
        }>();
        onDidChangePythonKernels = new EventEmitter<{
            added?: PythonKernelConnectionMetadata[];
            removed?: PythonKernelConnectionMetadata[];
            updated?: PythonKernelConnectionMetadata[];
        }>();
        disposables.push(onDidChangeRemoteKernels);
        disposables.push(onDidChangeLocalKernels);
        disposables.push(onDidChangePythonKernels);

        when(serviceContainer.get<PreferredRemoteKernelIdProvider>(PreferredRemoteKernelIdProvider)).thenReturn(
            instance(preferredRemoteKernelProvider)
        );
        when(serviceContainer.get<IKernelFinder>(IKernelFinder)).thenReturn(instance(kernelFinder));
        when(serviceContainer.get<IInterpreterService>(IInterpreterService)).thenReturn(instance(interpreterService));
        when(remoteKernelFinder.kind).thenReturn(ContributedKernelFinderKind.Remote);
        when(remoteKernelFinder.onDidChangeKernels).thenReturn(onDidChangeRemoteKernels.event);
        when(localKernelSpecFinder.kind).thenReturn(ContributedKernelFinderKind.LocalKernelSpec);
        when(localKernelSpecFinder.onDidChangeKernels).thenReturn(onDidChangeLocalKernels.event);
        when(localPythonEnvFinder.kind).thenReturn(ContributedKernelFinderKind.LocalPythonEnvironment);
        when(localPythonEnvFinder.onDidChangeKernels).thenReturn(onDidChangePythonKernels.event);
        when(interpreterService.getInterpreterHash(anything())).thenCall((id) => id);
        when(kernelFinder.registered).thenReturn([
            instance(remoteKernelFinder),
            instance(localKernelSpecFinder),
            instance(localPythonEnvFinder)
        ]);
        (instance(connection) as any).then = undefined;
        when(connection.mappedRemoteNotebookDir).thenReturn(undefined);
        when(jupyterConnection.createConnectionInfo(anything())).thenResolve(instance(connection));
        preferredService = new PreferredKernelConnectionService(instance(jupyterConnection));
        disposables.push(preferredService);
    });
    teardown(() => disposeAllDisposables(disposables));
    suite('Live Remote Kernels (preferred match)', () => {
        test('Find preferred kernel spec if there is no exact match for the live kernel connection (match kernel spec name)', async () => {
            when(preferredRemoteKernelProvider.getPreferredRemoteKernelId(uriEquals(notebook.uri))).thenResolve(
                remoteLiveKernelConnection2.id
            );
            when(remoteKernelFinder.status).thenReturn('idle');
            when(remoteKernelFinder.kernels).thenReturn([remoteLiveKernelConnection1, remoteJavaKernelSpec]);
            notebookMetadata.kernelspec!.name = remoteJavaKernelSpec.kernelSpec.name;

            const preferredKernel = await preferredService.findPreferredRemoteKernelConnection(
                notebook,
                instance(remoteKernelFinder),
                cancellation.token
            );

            assert.strictEqual(preferredKernel, remoteJavaKernelSpec);
        });
        test('Find preferred kernel spec if there is no exact match for the live kernel connection (match kernel spec language)', async () => {
            when(preferredRemoteKernelProvider.getPreferredRemoteKernelId(uriEquals(notebook.uri))).thenResolve(
                remoteLiveKernelConnection2.id
            );
            when(remoteKernelFinder.status).thenReturn('idle');
            when(remoteKernelFinder.kernels).thenReturn([remoteLiveKernelConnection1, remoteJavaKernelSpec]);
            notebookMetadata.language_info!.name = remoteJavaKernelSpec.kernelSpec.language!;

            const preferredKernel = await preferredService.findPreferredRemoteKernelConnection(
                notebook,
                instance(remoteKernelFinder),
                cancellation.token
            );

            assert.strictEqual(preferredKernel, remoteJavaKernelSpec);
        });
        test('Find existing session if there is an exact match for the notebook', async () => {
            when(connection.mappedRemoteNotebookDir).thenReturn('/foo/bar/');
            notebook = new TestNotebookDocument(Uri.file('/foo/bar/baz/sample.ipynb'), 'jupyter-notebook', {
                custom: { metadata: notebookMetadata }
            });

            when(preferredRemoteKernelProvider.getPreferredRemoteKernelId(uriEquals(notebook.uri))).thenResolve(
                undefined
            );
            when(remoteKernelFinder.status).thenReturn('idle');
            when(remoteKernelFinder.kernels).thenReturn([
                remoteLiveKernelConnection1,
                remoteLiveJavaKernelConnection,
                remoteJavaKernelSpec
            ]);
            notebookMetadata.language_info!.name = remoteJavaKernelSpec.kernelSpec.language!;

            const preferredKernel = await preferredService.findPreferredRemoteKernelConnection(
                notebook,
                instance(remoteKernelFinder),
                cancellation.token
            );

            assert.strictEqual(preferredKernel, remoteLiveJavaKernelConnection);
        });
    });
    suite('Local Kernel Specs (preferred match)', () => {
        test('No match for notebook when there are no kernels', async () => {
            when(localKernelSpecFinder.status).thenReturn('idle');
            when(localKernelSpecFinder.kernels).thenReturn([]);

            const preferredKernel = await preferredService.findPreferredLocalKernelSpecConnection(
                notebook,
                instance(localKernelSpecFinder),
                cancellation.token
            );

            assert.isUndefined(preferredKernel);
        });
        test('No matches for notebook when kernel spec name & languages do not match', async () => {
            when(localKernelSpecFinder.status).thenReturn('idle');
            when(localKernelSpecFinder.kernels).thenReturn([localJavaKernelSpec]);

            const preferredKernel = await preferredService.findPreferredLocalKernelSpecConnection(
                notebook,
                instance(localKernelSpecFinder),
                cancellation.token
            );

            assert.isUndefined(preferredKernel);
        });
        test('Find match for notebook when kernel spec name matches', async () => {
            when(localKernelSpecFinder.status).thenReturn('idle');
            when(localKernelSpecFinder.kernels).thenReturn([localJavaKernelSpec]);
            notebookMetadata.kernelspec!.name = localJavaKernelSpec.kernelSpec.name;

            const preferredKernel = await preferredService.findPreferredLocalKernelSpecConnection(
                notebook,
                instance(localKernelSpecFinder),
                cancellation.token
            );

            assert.strictEqual(preferredKernel, localJavaKernelSpec);
        });
        test('Find match for notebook when kernel spec language matches', async () => {
            when(localKernelSpecFinder.status).thenReturn('idle');
            when(localKernelSpecFinder.kernels).thenReturn([localJavaKernelSpec]);
            notebookMetadata.language_info!.name = localJavaKernelSpec.kernelSpec.language!;

            const preferredKernel = await preferredService.findPreferredLocalKernelSpecConnection(
                notebook,
                instance(localKernelSpecFinder),
                cancellation.token
            );

            assert.strictEqual(preferredKernel, localJavaKernelSpec);
        });
    });
    suite('Local Python Env (preferred match)', () => {
        test('No matches for notebook when there are no kernels', async () => {
            when(localPythonEnvFinder.status).thenReturn('idle');
            when(localPythonEnvFinder.kernels).thenReturn([]);

            const preferredKernel = await preferredService.findPreferredPythonKernelConnection(
                notebook,
                instance(localPythonEnvFinder),
                cancellation.token
            );

            assert.isUndefined(preferredKernel);
        });
    });
});
