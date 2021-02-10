// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { nbformat } from '@jupyterlab/coreutils';
import { assert, expect } from 'chai';
import * as sinon from 'sinon';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { CancellationToken } from 'vscode-jsonrpc';

import type { Kernel } from '@jupyterlab/services';
import { EventEmitter } from 'vscode';
import { PythonExtensionChecker } from '../../../../client/api/pythonApi';
import { ApplicationShell } from '../../../../client/common/application/applicationShell';
import { IApplicationShell } from '../../../../client/common/application/types';
import { ConfigurationService } from '../../../../client/common/configuration/service';
import { PYTHON_LANGUAGE } from '../../../../client/common/constants';
import { IDisposable, IPathUtils, Resource } from '../../../../client/common/types';
import * as localize from '../../../../client/common/utils/localize';
import { noop } from '../../../../client/common/utils/misc';
import { StopWatch } from '../../../../client/common/utils/stopWatch';
import { JupyterSessionManager } from '../../../../client/datascience/jupyter/jupyterSessionManager';
import { JupyterSessionManagerFactory } from '../../../../client/datascience/jupyter/jupyterSessionManagerFactory';
import { KernelDependencyService } from '../../../../client/datascience/jupyter/kernels/kernelDependencyService';
import { KernelSelectionProvider } from '../../../../client/datascience/jupyter/kernels/kernelSelections';
import { KernelSelector } from '../../../../client/datascience/jupyter/kernels/kernelSelector';
import { KernelService } from '../../../../client/datascience/jupyter/kernels/kernelService';
import { LiveKernelModel } from '../../../../client/datascience/jupyter/kernels/types';
import { IKernelFinder } from '../../../../client/datascience/kernel-launcher/types';
import {
    IJupyterSessionManager,
    IRawNotebookSupportedService,
    KernelInterpreterDependencyResponse
} from '../../../../client/datascience/types';
import { IInterpreterService } from '../../../../client/interpreter/contracts';
import { PythonEnvironment } from '../../../../client/pythonEnvironments/info';
import { PreferredRemoteKernelIdProvider } from '../../../../client/datascience/notebookStorage/preferredRemoteKernelIdProvider';
import { IInterpreterSelector } from '../../../../client/interpreter/configuration/types';
import { IFileSystem } from '../../../../client/common/platform/types';
import { IPythonExtensionChecker } from '../../../../client/api/types';
import {
    getQuickPickItemForActiveKernel,
    ActiveJupyterSessionKernelSelectionListProvider
} from '../../../../client/datascience/jupyter/kernels/providers/activeJupyterSessionKernelProvider';
import { InstalledJupyterKernelSelectionListProvider } from '../../../../client/datascience/jupyter/kernels/providers/installJupyterKernelProvider';
import { disposeAllDisposables } from '../../../../client/common/helpers';
import { InterpreterPackages } from '../../../../client/datascience/telemetry/interpreterPackages';

/* eslint-disable , @typescript-eslint/no-unused-expressions, @typescript-eslint/no-explicit-any */

suite('DataScience - KernelSelector', () => {
    let kernelSelectionProvider: KernelSelectionProvider;
    let kernelService: KernelService;
    let sessionManager: IJupyterSessionManager;
    let kernelSelector: KernelSelector;
    let interpreterService: IInterpreterService;
    let appShell: IApplicationShell;
    let dependencyService: KernelDependencyService;
    let kernelFinder: IKernelFinder;
    let jupyterSessionManagerFactory: JupyterSessionManagerFactory;
    const kernelSpec = {
        argv: [],
        display_name: 'Something',
        dispose: async () => noop(),
        language: PYTHON_LANGUAGE,
        name: 'SomeName',
        path: 'somePath',
        env: {}
    };
    const interpreter: PythonEnvironment = {
        displayName: 'Something',
        path: 'somePath',
        sysPrefix: '',
        sysVersion: '',
        version: { raw: '3.7.1.1', major: 3, minor: 7, patch: 1, build: ['1'], prerelease: [] }
    };
    const disposableRegistry: IDisposable[] = [];
    setup(() => {
        sessionManager = mock(JupyterSessionManager);
        kernelService = mock(KernelService);
        kernelSelectionProvider = mock(KernelSelectionProvider);
        appShell = mock(ApplicationShell);
        dependencyService = mock(KernelDependencyService);
        when(dependencyService.installMissingDependencies(anything(), anything())).thenResolve(
            KernelInterpreterDependencyResponse.ok
        );
        interpreterService = mock<IInterpreterService>();
        kernelFinder = mock<IKernelFinder>();
        jupyterSessionManagerFactory = mock(JupyterSessionManagerFactory);
        const dummySessionEvent = new EventEmitter<Kernel.IKernelConnection>();
        when(jupyterSessionManagerFactory.onRestartSessionCreated).thenReturn(dummySessionEvent.event);
        when(jupyterSessionManagerFactory.onRestartSessionUsed).thenReturn(dummySessionEvent.event);
        const configService = mock(ConfigurationService);
        const extensionChecker = mock(PythonExtensionChecker);
        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
        const preferredKernelIdProvider = mock(PreferredRemoteKernelIdProvider);
        when(preferredKernelIdProvider.getPreferredRemoteKernelId(anything())).thenResolve();
        when(preferredKernelIdProvider.storePreferredRemoteKernelId(anything(), anything())).thenResolve();
        kernelSelector = new KernelSelector(
            instance(kernelSelectionProvider),
            instance(appShell),
            instance(kernelService),
            instance(interpreterService),
            instance(dependencyService),
            instance(kernelFinder),
            instance(jupyterSessionManagerFactory),
            instance(configService),
            instance(extensionChecker),
            instance(preferredKernelIdProvider),
            instance(mock(InterpreterPackages))
        );
    });
    teardown(() => {
        sinon.restore();
        disposeAllDisposables(disposableRegistry);
    });
    suite('Select Remote Kernel', () => {
        test('Should display quick pick and return nothing when nothing is selected (remote sessions)', async () => {
            when(
                kernelSelectionProvider.getKernelSelectionsForRemoteSession(anything(), anything(), anything())
            ).thenResolve([]);
            when(appShell.showQuickPick(anything(), anything(), anything())).thenResolve();

            const kernel = await kernelSelector.selectRemoteKernel(undefined, new StopWatch(), async () =>
                instance(sessionManager)
            );

            assert.isUndefined(kernel);
            verify(
                kernelSelectionProvider.getKernelSelectionsForRemoteSession(anything(), anything(), anything())
            ).once();
            verify(appShell.showQuickPick(anything(), anything(), anything())).once();
        });
        test('Should display quick pick and return nothing when nothing is selected (local sessions)', async () => {
            when(kernelSelectionProvider.getKernelSelectionsForLocalSession(anything(), anything())).thenResolve([]);
            when(appShell.showQuickPick(anything(), anything(), anything())).thenResolve();

            const kernel = await kernelSelector.selectLocalKernel(undefined, 'jupyter', new StopWatch());

            assert.isUndefined(kernel);
            verify(kernelSelectionProvider.getKernelSelectionsForLocalSession(anything(), anything())).once();
            verify(appShell.showQuickPick(anything(), anything(), anything())).once();
        });
        test('Should return the selected remote kernelspec along with a matching interpreter', async () => {
            when(
                kernelSelectionProvider.getKernelSelectionsForRemoteSession(anything(), anything(), anything())
            ).thenResolve([]);
            when(kernelService.findMatchingInterpreter(kernelSpec, anything())).thenResolve(interpreter);
            when(appShell.showQuickPick(anything(), anything(), anything())).thenResolve({
                selection: { kernelSpec }
            } as any);

            const kernel = await kernelSelector.selectRemoteKernel(undefined, new StopWatch(), async () =>
                instance(sessionManager)
            );

            assert.deepEqual((kernel as any)?.kernelSpec, kernelSpec);
            assert.deepEqual(kernel?.interpreter, interpreter);
            verify(
                kernelSelectionProvider.getKernelSelectionsForRemoteSession(anything(), anything(), anything())
            ).once();
            verify(appShell.showQuickPick(anything(), anything(), anything())).once();
            verify(kernelService.findMatchingInterpreter(kernelSpec, anything())).once();
        });
    });
    suite('Hide kernels from Remote & Local Kernel', () => {
        setup(() => {
            sinon.restore();
        });
        teardown(() => sinon.restore());
        test('Should hide kernel from remote sessions', async () => {
            const kernelModels: LiveKernelModel[] = [
                {
                    lastActivityTime: new Date(),
                    name: '1one',
                    numberOfConnections: 1,
                    id: 'id1',
                    display_name: '1',
                    session: {} as any
                },
                {
                    lastActivityTime: new Date(),
                    name: '2two',
                    numberOfConnections: 1,
                    id: 'id2',
                    display_name: '2',
                    session: {} as any
                },
                {
                    lastActivityTime: new Date(),
                    name: '3three',
                    numberOfConnections: 1,
                    id: 'id3',
                    display_name: '3',
                    session: {} as any
                },
                {
                    lastActivityTime: new Date(),
                    name: '4four',
                    numberOfConnections: 1,
                    id: 'id4',
                    display_name: '4',
                    session: {} as any
                }
            ];
            const pathUtils = mock<IPathUtils>();
            when(pathUtils.getDisplayName(anything())).thenCall((v) => v);
            sinon.stub(InstalledJupyterKernelSelectionListProvider.prototype, 'getKernelSelections').resolves([]);
            const quickPickItems = kernelModels.map((item) =>
                getQuickPickItemForActiveKernel(item, instance(pathUtils))
            );
            sinon
                .stub(ActiveJupyterSessionKernelSelectionListProvider.prototype, 'getKernelSelections')
                .resolves(quickPickItems);
            const rawSupportedService = mock<IRawNotebookSupportedService>();
            when(rawSupportedService.supported()).thenResolve(true);
            const provider = new KernelSelectionProvider(
                instance(kernelService),
                instance(mock<IInterpreterSelector>()),
                instance(interpreterService),
                instance(mock<IFileSystem>()),
                instance(pathUtils),
                instance(kernelFinder),
                instance(mock<IPythonExtensionChecker>()),
                disposableRegistry,
                instance(jupyterSessionManagerFactory),
                instance(rawSupportedService)
            );
            when(appShell.showQuickPick(anything(), anything(), anything())).thenResolve(undefined);

            provider.addKernelToIgnoreList({ id: 'id2' } as any);
            provider.addKernelToIgnoreList({ clientId: 'id4' } as any);
            const suggestions = await provider.getKernelSelectionsForRemoteSession(undefined, async () =>
                instance(sessionManager)
            );

            assert.deepEqual(
                suggestions,
                quickPickItems.filter((item) => !['id2', 'id4'].includes(item.selection?.kernelModel?.id || ''))
            );
        });
    });
    suite('Select Local Kernel', () => {
        test('Should return the selected local kernelspec along with a matching interpreter', async () => {
            when(kernelSelectionProvider.getKernelSelectionsForLocalSession(anything(), anything())).thenResolve([]);
            when(kernelService.findMatchingInterpreter(kernelSpec, anything())).thenResolve(interpreter);
            when(appShell.showQuickPick(anything(), anything(), anything())).thenResolve({
                selection: { kernelSpec }
            } as any);

            const kernel = await kernelSelector.selectLocalKernel(undefined, 'jupyter', new StopWatch());

            assert.deepEqual((kernel as any)?.kernelSpec, kernelSpec);
            assert.deepEqual(kernel?.interpreter, interpreter);
            verify(kernelSelectionProvider.getKernelSelectionsForLocalSession(anything(), anything())).once();
            verify(appShell.showQuickPick(anything(), anything(), anything())).once();
        });
        test('If selected interpreter has ipykernel installed, then return matching kernelspec and interpreter', async () => {
            when(dependencyService.areDependenciesInstalled(interpreter, anything())).thenResolve(true);
            when(kernelFinder.findKernelSpec(undefined, interpreter, anything())).thenResolve(kernelSpec);
            when(kernelSelectionProvider.getKernelSelectionsForLocalSession(anything(), anything())).thenResolve([]);
            when(
                appShell.showInformationMessage(localize.DataScience.fallbackToUseActiveInterpreterAsKernel())
            ).thenResolve();
            when(appShell.showQuickPick(anything(), anything(), anything())).thenResolve({
                selection: { interpreter, kernelSpec }
            } as any);

            const kernel = await kernelSelector.selectLocalKernel(undefined, 'jupyter', new StopWatch());

            assert.deepEqual((kernel as any)?.kernelSpec, kernelSpec);
            verify(dependencyService.areDependenciesInstalled(interpreter, anything())).once();
            verify(kernelSelectionProvider.getKernelSelectionsForLocalSession(anything(), anything())).once();
            verify(appShell.showQuickPick(anything(), anything(), anything())).once();
            verify(kernelService.registerKernel(anything(), anything())).never();
            verify(
                appShell.showInformationMessage(localize.DataScience.fallbackToUseActiveInterpreterAsKernel())
            ).never();
            verify(
                appShell.showInformationMessage(localize.DataScience.fallBackToRegisterAndUseActiveInterpeterAsKernel())
            ).never();
        });
        test('If selected interpreter has ipykernel installed and there is no matching kernelSpec, then register a new kernel and return the new kernelspec and interpreter', async () => {
            when(dependencyService.areDependenciesInstalled(interpreter, anything())).thenResolve(true);
            when(kernelFinder.findKernelSpec(undefined, interpreter, anything())).thenResolve();
            when(kernelService.registerKernel(undefined, interpreter, anything(), anything())).thenResolve(kernelSpec);
            when(kernelSelectionProvider.getKernelSelectionsForLocalSession(anything(), anything())).thenResolve([]);
            when(
                appShell.showInformationMessage(localize.DataScience.fallBackToRegisterAndUseActiveInterpeterAsKernel())
            ).thenResolve();
            when(appShell.showQuickPick(anything(), anything(), anything())).thenResolve({
                selection: { interpreter, kernelSpec }
            } as any);

            const kernel = await kernelSelector.selectLocalKernel(undefined, 'jupyter', new StopWatch());

            assert.deepEqual((kernel as any)?.kernelSpec, kernelSpec);
            assert.deepEqual(kernel?.interpreter, interpreter);
            verify(dependencyService.areDependenciesInstalled(interpreter, anything())).once();
            verify(kernelSelectionProvider.getKernelSelectionsForLocalSession(anything(), anything())).twice(); // Once for caching.
            verify(appShell.showQuickPick(anything(), anything(), anything())).once();
            verify(
                appShell.showInformationMessage(localize.DataScience.fallbackToUseActiveInterpreterAsKernel())
            ).never();
            verify(
                appShell.showInformationMessage(localize.DataScience.fallBackToRegisterAndUseActiveInterpeterAsKernel())
            ).never();
        });
        test('If selected interpreter does not have ipykernel installed and there is no matching kernelspec, then register a new kernel and return the new kernelspec and interpreter', async () => {
            when(dependencyService.areDependenciesInstalled(interpreter, anything())).thenResolve(false);
            when(kernelService.registerKernel(undefined, interpreter, anything(), anything())).thenResolve(kernelSpec);
            when(kernelSelectionProvider.getKernelSelectionsForLocalSession(anything(), anything())).thenResolve([]);
            when(
                appShell.showInformationMessage(localize.DataScience.fallBackToRegisterAndUseActiveInterpeterAsKernel())
            ).thenResolve();
            when(appShell.showQuickPick(anything(), anything(), anything())).thenResolve({
                selection: { interpreter, kernelSpec }
            } as any);

            const kernel = await kernelSelector.selectLocalKernel(undefined, 'jupyter', new StopWatch());

            assert.deepEqual((kernel as any)?.kernelSpec, kernelSpec);
            verify(dependencyService.areDependenciesInstalled(interpreter, anything())).once();
            verify(kernelSelectionProvider.getKernelSelectionsForLocalSession(anything(), anything())).twice(); // once for caching.
            verify(appShell.showQuickPick(anything(), anything(), anything())).once();
            verify(appShell.showInformationMessage(anything(), anything(), anything())).never();
            verify(
                appShell.showInformationMessage(localize.DataScience.fallbackToUseActiveInterpreterAsKernel())
            ).never();
            verify(
                appShell.showInformationMessage(localize.DataScience.fallBackToRegisterAndUseActiveInterpeterAsKernel())
            ).never();
        });
        test('For a raw connection, if an interpreter is selected return it along with a default kernelspec', async () => {
            when(dependencyService.areDependenciesInstalled(interpreter, anything())).thenResolve(true);
            when(kernelSelectionProvider.getKernelSelectionsForLocalSession(anything(), anything())).thenResolve([]);
            when(appShell.showQuickPick(anything(), anything(), anything())).thenResolve({
                selection: { interpreter, kernelSpec: undefined }
            } as any);

            const kernel = await kernelSelector.selectLocalKernel(undefined, 'raw', new StopWatch());

            assert.deepEqual(kernel?.interpreter, interpreter);
            expect((kernel as any)?.kernelSpec, 'Should have kernelspec').to.not.be.undefined;
        });
        test('For a raw connection, if a kernel spec is selected return it with the interpreter', async () => {
            when(dependencyService.areDependenciesInstalled(interpreter, anything())).thenResolve(true);
            when(kernelService.findMatchingInterpreter(kernelSpec, anything())).thenResolve(interpreter);
            when(kernelSelectionProvider.getKernelSelectionsForLocalSession(anything(), anything())).thenResolve([]);
            when(appShell.showQuickPick(anything(), anything(), anything())).thenResolve({
                selection: { interpreter: undefined, kernelSpec }
            } as any);
            const kernel = await kernelSelector.selectLocalKernel(undefined, 'raw', new StopWatch());
            assert.deepEqual((kernel as any)?.kernelSpec, kernelSpec);
            assert.deepEqual(kernel?.interpreter, interpreter);
        });
    });
    // eslint-disable-next-line
    suite('Get a kernel for local sessions', () => {
        let nbMetadataKernelSpec: nbformat.IKernelspecMetadata = {} as any;
        let nbMetadata: nbformat.INotebookMetadata = {} as any;
        let selectLocalKernelStub: sinon.SinonStub<
            [Resource, 'raw' | 'jupyter' | 'noConnection', StopWatch, (CancellationToken | undefined)?, string?],
            Promise<any>
        >;
        setup(() => {
            nbMetadataKernelSpec = {
                display_name: interpreter.displayName!,
                name: kernelSpec.name
            };
            nbMetadata = {
                kernelspec: nbMetadataKernelSpec as any,
                orig_nbformat: 4,
                language_info: { name: PYTHON_LANGUAGE }
            };
            selectLocalKernelStub = sinon.stub(KernelSelector.prototype, 'selectLocalKernel');
            selectLocalKernelStub.resolves({ kernelSpec, interpreter });
        });
        teardown(() => sinon.restore());
        test('Raw kernel connection finds a valid kernel spec and interpreter', async () => {
            when(kernelFinder.findKernelSpec(anything(), anything(), anything())).thenResolve(kernelSpec);
            when(kernelService.findMatchingInterpreter(kernelSpec, anything())).thenResolve(interpreter);
            when(kernelSelectionProvider.getKernelSelectionsForLocalSession(anything(), anything())).thenResolve();

            const kernel = await kernelSelector.getPreferredKernelForLocalConnection(undefined, 'raw', nbMetadata);

            assert.deepEqual((kernel as any).kernelSpec, kernelSpec);
            assert.deepEqual(kernel?.interpreter, interpreter);
        });
        test('If metadata contains kernel information, then return a matching kernel and a matching interpreter', async () => {
            when(kernelFinder.findKernelSpec(anything(), nbMetadata, anything())).thenResolve(kernelSpec);
            when(kernelService.findMatchingInterpreter(kernelSpec, anything())).thenResolve(interpreter);
            when(kernelSelectionProvider.getKernelSelectionsForLocalSession(anything(), anything())).thenResolve();

            const kernel = await kernelSelector.getPreferredKernelForLocalConnection(undefined, 'jupyter', nbMetadata);

            assert.deepEqual((kernel as any).kernelSpec, kernelSpec);
            assert.deepEqual(kernel?.interpreter, interpreter);
            assert.isOk(selectLocalKernelStub.notCalled);
            verify(kernelService.findMatchingInterpreter(kernelSpec, anything())).once();
            verify(appShell.showQuickPick(anything(), anything(), anything())).never();
            verify(kernelService.registerKernel(anything(), anything(), anything())).never();
        });
        test('If metadata contains kernel information, then return a matching kernel', async () => {
            when(kernelFinder.findKernelSpec(undefined, nbMetadata, anything())).thenResolve(kernelSpec);
            when(kernelService.findMatchingInterpreter(kernelSpec, anything())).thenResolve(interpreter);
            when(kernelSelectionProvider.getKernelSelectionsForLocalSession(anything(), anything())).thenResolve();

            const kernel = await kernelSelector.getPreferredKernelForLocalConnection(undefined, 'jupyter', nbMetadata);

            assert.deepEqual((kernel as any).kernelSpec, kernelSpec);
            assert.isOk(kernel?.interpreter);
            assert.isOk(selectLocalKernelStub.notCalled);
            verify(kernelService.findMatchingInterpreter(kernelSpec, anything())).once();
            verify(appShell.showQuickPick(anything(), anything(), anything())).never();
            verify(kernelService.registerKernel(anything(), anything(), anything())).never();
        });
        test('If metadata contains kernel information, and there is matching kernelspec, then use current interpreter as a kernel', async () => {
            when(dependencyService.areDependenciesInstalled(interpreter, anything())).thenResolve(false);
            when(kernelFinder.findKernelSpec(undefined, nbMetadata, anything())).thenResolve(undefined);
            when(interpreterService.getActiveInterpreter(undefined)).thenResolve(interpreter);
            when(kernelService.registerKernel(anything(), anything(), anything(), anything())).thenResolve(kernelSpec);
            when(
                appShell.showInformationMessage(localize.DataScience.fallbackToUseActiveInterpreterAsKernel())
            ).thenResolve();
            when(
                appShell.showInformationMessage(
                    localize.DataScience.fallBackToRegisterAndUseActiveInterpeterAsKernel().format(
                        nbMetadata.kernelspec?.display_name!
                    )
                )
            ).thenResolve();
            when(kernelSelectionProvider.getKernelSelectionsForLocalSession(anything(), anything())).thenResolve();

            const kernel = await kernelSelector.getPreferredKernelForLocalConnection(undefined, 'jupyter', nbMetadata);

            assert.deepEqual((kernel as any)?.kernelSpec, kernelSpec);
            assert.deepEqual(kernel?.interpreter, interpreter);
            assert.isOk(selectLocalKernelStub.notCalled);
            verify(kernelService.updateKernelEnvironment(interpreter, anything(), anything())).never();
            verify(kernelService.findMatchingInterpreter(kernelSpec, anything())).never();
            verify(appShell.showQuickPick(anything(), anything(), anything())).never();
            verify(
                appShell.showInformationMessage(
                    localize.DataScience.fallBackToPromptToUseActiveInterpreterOrSelectAKernel()
                )
            ).never();
            verify(
                appShell.showInformationMessage(
                    localize.DataScience.fallBackToRegisterAndUseActiveInterpeterAsKernel().format(
                        nbMetadata.kernelspec?.display_name!
                    )
                )
            ).once();
        });
        test('If metadata is empty, then use active interpreter and find a kernel matching active interpreter', async () => {
            when(dependencyService.areDependenciesInstalled(interpreter, anything())).thenResolve(false);
            when(kernelFinder.findKernelSpec(undefined, nbMetadata, anything())).thenResolve(undefined);
            when(interpreterService.getActiveInterpreter(undefined)).thenResolve(interpreter);
            when(kernelService.searchAndRegisterKernel(undefined, interpreter, anything(), anything())).thenResolve(
                kernelSpec
            );
            when(kernelSelectionProvider.getKernelSelectionsForLocalSession(anything(), anything())).thenResolve();

            const kernel = await kernelSelector.getPreferredKernelForLocalConnection(undefined, 'jupyter', undefined);

            assert.deepEqual(kernel?.kernelSpec, kernelSpec);
            assert.deepEqual(kernel?.interpreter, interpreter);
            assert.isOk(selectLocalKernelStub.notCalled);
            verify(appShell.showInformationMessage(anything(), anything(), anything())).never();
            verify(kernelService.findMatchingInterpreter(kernelSpec, anything())).never();
            verify(appShell.showQuickPick(anything(), anything(), anything())).never();
            verify(kernelService.registerKernel(anything(), anything())).never();
        });
        test('Remote search works', async () => {
            when(dependencyService.areDependenciesInstalled(interpreter, anything())).thenResolve(false);
            when(kernelFinder.findKernelSpec(undefined, nbMetadata, anything())).thenResolve(undefined);
            when(kernelService.getKernelSpecs(anything(), anything())).thenResolve([
                {
                    name: 'bar',
                    display_name: 'foo',
                    language: 'c#',
                    path: '/foo/dotnet',
                    argv: [],
                    env: {}
                },
                {
                    name: 'python3',
                    display_name: 'foo',
                    language: 'python',
                    path: '/foo/python',
                    argv: [],
                    env: {}
                }
            ]);
            when(interpreterService.getActiveInterpreter(undefined)).thenResolve(interpreter);
            when(kernelService.searchAndRegisterKernel(undefined, interpreter, anything(), anything())).thenResolve(
                kernelSpec
            );
            when(kernelSelectionProvider.getKernelSelectionsForLocalSession(anything(), anything())).thenResolve();

            const kernel = await kernelSelector.getPreferredKernelForRemoteConnection(
                undefined,
                instance(sessionManager),
                undefined
            );

            assert.ok((kernel as any)?.kernelSpec, 'No kernel spec found for remote');
            assert.equal((kernel as any)?.kernelSpec?.display_name, 'foo', 'Did not find the python kernel spec');
            assert.deepEqual(kernel?.interpreter, interpreter);
            assert.isOk(selectLocalKernelStub.notCalled);
            verify(appShell.showInformationMessage(anything(), anything(), anything())).never();
            verify(kernelService.findMatchingInterpreter(kernelSpec, anything())).never();
            verify(appShell.showQuickPick(anything(), anything(), anything())).never();
            verify(kernelService.registerKernel(anything(), anything(), anything())).never();
        });
        test('Remote search prefers same name as long as it is python', async () => {
            when(dependencyService.areDependenciesInstalled(interpreter, anything())).thenResolve(false);
            when(kernelFinder.findKernelSpec(undefined, nbMetadata, anything())).thenResolve(undefined);
            when(kernelService.getKernelSpecs(anything(), anything())).thenResolve([
                {
                    name: 'bar',
                    display_name: 'foo',
                    language: 'CSharp',
                    path: '/foo/dotnet',
                    argv: [],
                    env: {}
                },
                {
                    name: 'foo',
                    display_name: 'zip',
                    language: 'Python',
                    path: '/foo/python',
                    argv: [],
                    env: undefined
                },
                {
                    name: 'foo',
                    display_name: 'foo',
                    language: 'Python',
                    path: '/foo/python',
                    argv: [],
                    env: undefined
                }
            ]);
            when(interpreterService.getActiveInterpreter(undefined)).thenResolve(interpreter);
            when(kernelService.searchAndRegisterKernel(undefined, interpreter, anything())).thenResolve(kernelSpec);
            when(kernelSelectionProvider.getKernelSelectionsForLocalSession(anything(), anything())).thenResolve();

            const kernel = await kernelSelector.getPreferredKernelForRemoteConnection(
                undefined,
                instance(sessionManager),
                {
                    orig_nbformat: 4,
                    kernelspec: { display_name: 'foo', name: 'foo' }
                }
            );

            assert.ok((kernel as any).kernelSpec, 'No kernel spec found for remote');
            assert.equal(
                (kernel as any).kernelSpec?.display_name,
                'foo',
                'Did not find the preferred python kernel spec'
            );
            assert.deepEqual(kernel?.interpreter, interpreter);
            assert.isOk(selectLocalKernelStub.notCalled);
            verify(appShell.showInformationMessage(anything(), anything(), anything())).never();
            verify(kernelService.findMatchingInterpreter(kernelSpec, anything())).never();
            verify(appShell.showQuickPick(anything(), anything(), anything())).never();
            verify(kernelService.registerKernel(anything(), anything())).never();
        });
        test('Remote search prefers same version', async () => {
            when(dependencyService.areDependenciesInstalled(interpreter, anything())).thenResolve(false);
            when(kernelFinder.findKernelSpec(undefined, nbMetadata, anything())).thenResolve(undefined);
            when(kernelService.getKernelSpecs(anything(), anything())).thenResolve([
                {
                    name: 'bar',
                    display_name: 'fod',
                    language: 'CSharp',
                    path: '/foo/dotnet',
                    argv: [],
                    env: {}
                },
                {
                    name: 'python2',
                    display_name: 'zip',
                    language: 'Python',
                    path: '/foo/python',
                    argv: [],
                    env: undefined
                },
                {
                    name: 'python3',
                    display_name: 'foo',
                    language: 'Python',
                    path: '/foo/python',
                    argv: [],
                    env: undefined
                }
            ]);
            when(interpreterService.getActiveInterpreter(undefined)).thenResolve(interpreter);
            when(kernelService.searchAndRegisterKernel(undefined, interpreter, anything())).thenResolve(kernelSpec);
            when(kernelSelectionProvider.getKernelSelectionsForLocalSession(anything(), anything())).thenResolve();

            const kernel = await kernelSelector.getPreferredKernelForRemoteConnection(
                undefined,
                instance(sessionManager),
                {
                    orig_nbformat: 4,
                    kernelspec: { display_name: 'foo', name: 'foo' }
                }
            );

            assert.ok((kernel as any).kernelSpec, 'No kernel spec found for remote');
            assert.equal(
                (kernel as any).kernelSpec?.display_name,
                'foo',
                'Did not find the preferred python kernel spec'
            );
            assert.deepEqual(kernel?.interpreter, interpreter);
            assert.isOk(selectLocalKernelStub.notCalled);
            verify(appShell.showInformationMessage(anything(), anything(), anything())).never();
            verify(kernelService.findMatchingInterpreter(kernelSpec, anything())).never();
            verify(appShell.showQuickPick(anything(), anything(), anything())).never();
            verify(kernelService.registerKernel(anything(), anything())).never();
        });
    });
});
