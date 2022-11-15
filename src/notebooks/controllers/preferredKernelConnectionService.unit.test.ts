// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import { anything, instance, mock, when } from 'ts-mockito';
import { CancellationTokenSource, NotebookDocument, Disposable, EventEmitter, Uri } from 'vscode';
import { ContributedKernelFinderKind, IContributedKernelFinder } from '../../kernels/internalTypes';
import { PreferredRemoteKernelIdProvider } from '../../kernels/jupyter/preferredRemoteKernelIdProvider';
import {
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
import { EnvironmentType } from '../../platform/pythonEnvironments/info';
import { uriEquals } from '../../test/datascience/helpers';
import { TestNotebookDocument } from '../../test/datascience/notebook/executionHelper';
import { PreferredKernelConnectionService } from './preferredKernelConnectionService';

suite('Preferred Kernel Connection', () => {
    let preferredService: PreferredKernelConnectionService;
    let serviceContainer: ServiceContainer;
    let kernelFinder: IKernelFinder;
    let remoteKernelFinder: IContributedKernelFinder<RemoteKernelConnectionMetadata>;
    let localKernelSpecFinder: IContributedKernelFinder<LocalKernelConnectionMetadata>;
    let localPythonEnvFinder: IContributedKernelFinder<PythonKernelConnectionMetadata>;
    let disposables: IDisposable[] = [];
    let notebookMetadata: NotebookMetadata;
    let notebook: NotebookDocument;
    let preferredRemoteKernelProvider: PreferredRemoteKernelIdProvider;
    let cancellation: CancellationTokenSource;
    let onDidChangeRemoteKernels: EventEmitter<void>;
    let onDidChangeLocalKernels: EventEmitter<void>;
    let onDidChangePythonKernels: EventEmitter<void>;
    let interpreterService: IInterpreterService;
    const remoteLiveKernelConnection1 = LiveRemoteKernelConnectionMetadata.create({
        baseUrl: '',
        id: 'liveRemote1',
        kernelModel: instance(mock<LiveKernelModel>()),
        serverId: 'remoteServerId1'
    });
    const remoteLiveKernelConnection2 = LiveRemoteKernelConnectionMetadata.create({
        baseUrl: '',
        id: 'liveRemote2',
        kernelModel: instance(mock<LiveKernelModel>()),
        serverId: 'remoteServerId2'
    });
    const remoteJavaKernelSpec = RemoteKernelSpecConnectionMetadata.create({
        baseUrl: '',
        id: 'liveRemote2',
        kernelSpec: {
            argv: [],
            display_name: 'Java KernelSpec',
            executable: '',
            name: 'javaName',
            language: 'java'
        },
        serverId: 'remoteServerId2'
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
    const venvPythonKernel = PythonKernelConnectionMetadata.create({
        id: 'venvPython',
        kernelSpec: {
            argv: [],
            display_name: 'Venv Python',
            executable: '',
            name: 'venvName',
            language: 'python'
        },
        interpreter: {
            id: 'venv',
            sysPrefix: '',
            uri: Uri.file('venv')
        }
    });
    const condaPythonKernel = PythonKernelConnectionMetadata.create({
        id: 'condaPython',
        kernelSpec: {
            argv: [],
            display_name: 'Conda Python',
            executable: '',
            name: 'condaName',
            language: 'python'
        },
        interpreter: {
            id: 'conda',
            sysPrefix: '',
            uri: Uri.file('conda'),
            envType: EnvironmentType.Conda
        }
    });
    setup(() => {
        serviceContainer = mock<ServiceContainer>();
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

        onDidChangeRemoteKernels = new EventEmitter<void>();
        onDidChangeLocalKernels = new EventEmitter<void>();
        onDidChangePythonKernels = new EventEmitter<void>();
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

        preferredService = new PreferredKernelConnectionService();
        disposables.push(preferredService);
    });
    teardown(() => disposeAllDisposables(disposables));
    suite('Live Remote Kernels (exact match)', () => {
        test('No exact match for notebook when there is live kernel associated with the notebook but the live kernel no longer exists', async () => {
            when(preferredRemoteKernelProvider.getPreferredRemoteKernelId(uriEquals(notebook.uri))).thenResolve(
                remoteLiveKernelConnection2.id
            );
            when(remoteKernelFinder.status).thenReturn('idle');
            when(remoteKernelFinder.kernels).thenReturn([]);

            const exactKernel = await preferredService.findExactRemoteKernelConnection(notebook, cancellation.token);

            assert.isUndefined(exactKernel);
        });
        test('No exact match for notebook when there is live kernel associated with the notebook but the live kernel no longer exists, even if we have a matching kernelSpec', async () => {
            when(preferredRemoteKernelProvider.getPreferredRemoteKernelId(uriEquals(notebook.uri))).thenResolve(
                remoteLiveKernelConnection2.id
            );
            when(remoteKernelFinder.status).thenReturn('idle');
            when(remoteKernelFinder.kernels).thenReturn([remoteJavaKernelSpec]);
            notebookMetadata.kernelspec!.name = remoteJavaKernelSpec.kernelSpec.name;

            const exactKernel = await preferredService.findExactRemoteKernelConnection(notebook, cancellation.token);

            assert.isUndefined(exactKernel);
        });
        test('Find exact match for notebook when there is live kernel associated with the notebook', async () => {
            when(preferredRemoteKernelProvider.getPreferredRemoteKernelId(uriEquals(notebook.uri))).thenResolve(
                remoteLiveKernelConnection2.id
            );
            when(remoteKernelFinder.status).thenReturn('idle');
            when(remoteKernelFinder.kernels).thenReturn([remoteLiveKernelConnection1, remoteLiveKernelConnection2]);

            const exactKernel = await preferredService.findExactRemoteKernelConnection(notebook, cancellation.token);

            assert.strictEqual(exactKernel, remoteLiveKernelConnection2);
        });
        test('Find exact match for notebook when there is live kernel associated with the notebook and finding kernels takes a while', async () => {
            when(preferredRemoteKernelProvider.getPreferredRemoteKernelId(uriEquals(notebook.uri))).thenResolve(
                remoteLiveKernelConnection2.id
            );
            when(remoteKernelFinder.status).thenReturn('discovering');
            when(remoteKernelFinder.kernels).thenReturn([remoteLiveKernelConnection1]);

            const promise = preferredService.findExactRemoteKernelConnection(notebook, cancellation.token);

            // Ensure we now find the kernel.
            when(remoteKernelFinder.kernels).thenReturn([remoteLiveKernelConnection1, remoteLiveKernelConnection2]);
            onDidChangeRemoteKernels.fire();

            assert.strictEqual(await promise, remoteLiveKernelConnection2);
        });
        test('Do not find an exact match for notebook when there is live kernel associated with the notebook and we do not find a matching kernel even after waiting for kernels finding to finish', async () => {
            when(preferredRemoteKernelProvider.getPreferredRemoteKernelId(uriEquals(notebook.uri))).thenResolve(
                remoteLiveKernelConnection2.id
            );
            when(remoteKernelFinder.status).thenReturn('discovering');
            when(remoteKernelFinder.kernels).thenReturn([remoteLiveKernelConnection1]);

            const promise = preferredService.findExactRemoteKernelConnection(notebook, cancellation.token);

            // Ensure we now find the kernel.
            when(remoteKernelFinder.status).thenReturn('idle');
            onDidChangeRemoteKernels.fire();

            assert.isUndefined(await promise);
        });
    });
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
        test('No kernel matches from remotes', async () => {
            when(preferredRemoteKernelProvider.getPreferredRemoteKernelId(uriEquals(notebook.uri))).thenResolve(
                remoteLiveKernelConnection2.id
            );
            when(remoteKernelFinder.status).thenReturn('idle');
            when(remoteKernelFinder.kernels).thenReturn([remoteLiveKernelConnection1, remoteJavaKernelSpec]);

            const exactKernel = await preferredService.findExactRemoteKernelConnection(notebook, cancellation.token);

            assert.isUndefined(exactKernel);
        });
    });
    suite('Local Kernel Specs (exact match)', () => {
        test('No exact match for notebook when there are no kernels', async () => {
            when(localKernelSpecFinder.status).thenReturn('idle');
            when(localKernelSpecFinder.kernels).thenReturn([]);

            const exactKernel = await preferredService.findExactLocalKernelSpecConnection(notebook, cancellation.token);

            assert.isUndefined(exactKernel);
        });
        test('No exact match for notebook when kernel spec name does not match (even if language matches)', async () => {
            when(localKernelSpecFinder.status).thenReturn('idle');
            when(localKernelSpecFinder.kernels).thenReturn([localJavaKernelSpec]);
            notebookMetadata.language_info!.name = localJavaKernelSpec.kernelSpec.language!;

            const exactKernel = await preferredService.findExactLocalKernelSpecConnection(notebook, cancellation.token);

            assert.isUndefined(exactKernel);
        });
        test('Find exact match for notebook when kernel spec name matches', async () => {
            when(localKernelSpecFinder.status).thenReturn('idle');
            when(localKernelSpecFinder.kernels).thenReturn([localJavaKernelSpec]);
            notebookMetadata.kernelspec!.name = localJavaKernelSpec.kernelSpec.name;

            const exactKernel = await preferredService.findExactLocalKernelSpecConnection(notebook, cancellation.token);

            assert.strictEqual(exactKernel, localJavaKernelSpec);
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
    suite('Local Python Env (exact match)', () => {
        test('No exact match for notebook when there are no kernels', async () => {
            when(localPythonEnvFinder.status).thenReturn('idle');
            when(localPythonEnvFinder.kernels).thenReturn([]);

            const exactKernel = await preferredService.findExactPythonKernelConnection(notebook, cancellation.token);

            assert.isUndefined(exactKernel);
        });
        test('No exact match for notebook when interpreter hash does not match', async () => {
            when(localPythonEnvFinder.status).thenReturn('idle');
            when(localPythonEnvFinder.kernels).thenReturn([venvPythonKernel, condaPythonKernel]);
            notebookMetadata.vscode = { interpreter: { hash: 'xyz' } };

            const exactKernel = await preferredService.findExactPythonKernelConnection(notebook, cancellation.token);

            assert.isUndefined(exactKernel);
        });
        test('Find exact match for notebook when we find an exact matching interpreter', async () => {
            when(localPythonEnvFinder.status).thenReturn('idle');
            when(localPythonEnvFinder.kernels).thenReturn([venvPythonKernel, condaPythonKernel]);
            const condaInterpreterHash = '#Conda Interpreter Hash';
            when(interpreterService.getInterpreterHash(condaPythonKernel.interpreter.id)).thenReturn(
                condaInterpreterHash
            );
            notebookMetadata.vscode = { interpreter: { hash: condaInterpreterHash } };

            const exactKernel = await preferredService.findExactPythonKernelConnection(notebook, cancellation.token);

            assert.strictEqual(exactKernel, condaPythonKernel);
        });
        test('Find exact match for notebook when the matching interpreter is discovered a little later', async () => {
            when(localPythonEnvFinder.status).thenReturn('discovering');
            when(localPythonEnvFinder.kernels).thenReturn([venvPythonKernel]);
            const condaInterpreterHash = '#Conda Interpreter Hash';
            when(interpreterService.getInterpreterHash(condaPythonKernel.interpreter.id)).thenReturn(
                condaInterpreterHash
            );
            notebookMetadata.vscode = { interpreter: { hash: condaInterpreterHash } };

            const promise = preferredService.findExactPythonKernelConnection(notebook, cancellation.token);

            // We discovery the conda env a little later.
            when(localPythonEnvFinder.kernels).thenReturn([venvPythonKernel, condaPythonKernel]);
            onDidChangePythonKernels.fire();

            assert.strictEqual(await promise, condaPythonKernel);
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
        test('Matches active Interpreter for notebook when interpreter hash does not match', async () => {
            when(localPythonEnvFinder.status).thenReturn('idle');
            when(localPythonEnvFinder.kernels).thenReturn([venvPythonKernel, condaPythonKernel]);
            when(interpreterService.getActiveInterpreter(anything())).thenResolve(condaPythonKernel.interpreter);

            const preferredKernel = await preferredService.findPreferredPythonKernelConnection(
                notebook,
                instance(localPythonEnvFinder),
                cancellation.token
            );

            assert.strictEqual(preferredKernel, condaPythonKernel);
        });
        test('Match active interpreter after completion of python interpreter discovery', async () => {
            when(localPythonEnvFinder.status).thenReturn('discovering');
            when(localPythonEnvFinder.kernels).thenReturn([venvPythonKernel]);
            const condaInterpreterHash = '#Conda Interpreter Hash';
            when(interpreterService.getInterpreterHash(condaPythonKernel.interpreter.id)).thenReturn(
                condaInterpreterHash
            );
            notebookMetadata.vscode = { interpreter: { hash: condaInterpreterHash } };

            const promise = preferredService.findExactPythonKernelConnection(notebook, cancellation.token);

            // We discovery the conda env a little later.
            when(interpreterService.getActiveInterpreter(anything())).thenResolve(condaPythonKernel.interpreter);
            when(localPythonEnvFinder.kernels).thenReturn([venvPythonKernel, condaPythonKernel]);
            when(localPythonEnvFinder.status).thenReturn('idle');
            onDidChangePythonKernels.fire();

            assert.strictEqual(await promise, condaPythonKernel);
        });
    });
});
