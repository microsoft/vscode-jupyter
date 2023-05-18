// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fakeTimers from '@sinonjs/fake-timers';
import * as sinon from 'sinon';
import { assert } from 'chai';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { Disposable, EventEmitter, Uri } from 'vscode';
import { IContributedKernelFinder } from '../../kernels/internalTypes';
import { IJupyterServerUriEntry, IJupyterServerUriStorage } from '../../kernels/jupyter/types';
import {
    IJupyterKernelSpec,
    IKernelFinder,
    IKernelProvider,
    KernelConnectionMetadata,
    LocalKernelSpecConnectionMetadata,
    PythonKernelConnectionMetadata
} from '../../kernels/types';
import { IPythonExtensionChecker } from '../../platform/api/types';
import {
    IApplicationShell,
    ICommandManager,
    IDocumentManager,
    IVSCodeNotebook,
    IWorkspaceService
} from '../../platform/common/application/types';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { IBrowserService, IConfigurationService, IDisposable, IExtensionContext } from '../../platform/common/types';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { IServiceContainer } from '../../platform/ioc/types';
import { EnvironmentType, PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { NotebookCellLanguageService } from '../languages/cellLanguageService';
import { ConnectionDisplayDataProvider } from './connectionDisplayData';
import { ControllerRegistration } from './controllerRegistration';
import { PythonEnvironmentFilter } from '../../platform/interpreter/filter/filterService';
import { IVSCodeNotebookController } from './types';
import { VSCodeNotebookController } from './vscodeNotebookController';

suite('Controller Registration', () => {
    const activePythonEnv: PythonEnvironment = {
        id: 'activePythonEnv',
        sysPrefix: '',
        uri: Uri.file('activePythonEnv')
    };
    const activePythonConnection = PythonKernelConnectionMetadata.create({
        id: 'activePython',
        kernelSpec: {
            argv: [],
            display_name: 'activePython',
            executable: '',
            name: 'activePython'
        },
        interpreter: activePythonEnv
    });
    const condaPython: PythonEnvironment = {
        id: 'condaPython',
        sysPrefix: '',
        uri: Uri.file('condaPython'),
        envType: EnvironmentType.Conda
    };
    const condaPythonConnection = PythonKernelConnectionMetadata.create({
        id: 'condaKernel',
        kernelSpec: {
            argv: [],
            display_name: 'conda kernel',
            executable: '',
            name: 'conda kernel'
        },
        interpreter: condaPython
    });
    const javaKernelSpec: IJupyterKernelSpec = {
        name: 'java',
        display_name: 'java',
        language: 'java',
        argv: [],
        env: {},
        executable: ''
    };
    const javaKernelConnection = LocalKernelSpecConnectionMetadata.create({
        id: 'java',
        kernelSpec: javaKernelSpec
    });
    let clock: fakeTimers.InstalledClock;
    const disposables: IDisposable[] = [];
    let vscNotebook: IVSCodeNotebook;
    let kernelFinder: IKernelFinder;
    let extensionChecker: IPythonExtensionChecker;
    let interpreters: IInterpreterService;
    let registration: ControllerRegistration;
    let serverUriStorage: IJupyterServerUriStorage;
    let kernelFilter: PythonEnvironmentFilter;
    let onDidChangeKernels: EventEmitter<void>;
    let onDidChangeKernelsInContributedLocalKernelFinder: EventEmitter<{
        added?: KernelConnectionMetadata[] | undefined;
        updated?: KernelConnectionMetadata[] | undefined;
        removed?: KernelConnectionMetadata[] | undefined;
    }>;
    let onDidChangeKernelsInContributedPythonKernelFinder: EventEmitter<{
        added?: KernelConnectionMetadata[] | undefined;
        updated?: KernelConnectionMetadata[] | undefined;
        removed?: KernelConnectionMetadata[] | undefined;
    }>;
    let onDidChangeRegistrations: EventEmitter<{
        added: IContributedKernelFinder<KernelConnectionMetadata>[];
        removed: IContributedKernelFinder<KernelConnectionMetadata>[];
    }>;
    let onDidChangeFilter: EventEmitter<void>;
    let onDidChangeUri: EventEmitter<void>;
    let onDidRemoveUris: EventEmitter<IJupyterServerUriEntry[]>;
    let onDidChangeInterpreter: EventEmitter<PythonEnvironment | undefined>;
    let onDidChangeInterpreters: EventEmitter<PythonEnvironment[]>;
    let contributedLocalKernelFinder: IContributedKernelFinder;
    let contributedPythonKernelFinder: IContributedKernelFinder;
    let configService: IConfigurationService;
    let commandManager: ICommandManager;
    let context: IExtensionContext;
    let kernelProvider: IKernelProvider;
    let languageService: NotebookCellLanguageService;
    let workspace: IWorkspaceService;
    let documentManager: IDocumentManager;
    let appShell: IApplicationShell;
    let browser: IBrowserService;
    let serviceContainer: IServiceContainer;
    let displayDataProvider: ConnectionDisplayDataProvider;
    let addOrUpdateCalled = false;
    setup(() => {
        vscNotebook = mock<IVSCodeNotebook>();
        kernelFinder = mock<IKernelFinder>();
        extensionChecker = mock<IPythonExtensionChecker>();
        interpreters = mock<IInterpreterService>();
        serverUriStorage = mock<IJupyterServerUriStorage>();
        kernelFilter = mock<PythonEnvironmentFilter>();
        contributedLocalKernelFinder = mock<IContributedKernelFinder>();
        contributedPythonKernelFinder = mock<IContributedKernelFinder>();
        configService = mock<IConfigurationService>();
        commandManager = mock<ICommandManager>();
        context = mock<IExtensionContext>();
        kernelProvider = mock<IKernelProvider>();
        languageService = mock<NotebookCellLanguageService>();
        workspace = mock<IWorkspaceService>();
        documentManager = mock<IDocumentManager>();
        appShell = mock<IApplicationShell>();
        browser = mock<IBrowserService>();
        serviceContainer = mock<IServiceContainer>();
        displayDataProvider = mock<ConnectionDisplayDataProvider>();
        onDidChangeKernels = new EventEmitter<void>();
        disposables.push(onDidChangeKernels);
        when(serviceContainer.get<ICommandManager>(ICommandManager)).thenReturn(instance(commandManager));
        when(serviceContainer.get<IConfigurationService>(IConfigurationService)).thenReturn(instance(configService));
        when(serviceContainer.get<IApplicationShell>(IApplicationShell)).thenReturn(instance(appShell));
        when(serviceContainer.get<IBrowserService>(IBrowserService)).thenReturn(instance(browser));
        when(serviceContainer.get<IWorkspaceService>(IWorkspaceService)).thenReturn(instance(workspace));
        when(serviceContainer.get<IDocumentManager>(IDocumentManager)).thenReturn(instance(documentManager));
        when(serviceContainer.get<ConnectionDisplayDataProvider>(ConnectionDisplayDataProvider)).thenReturn(
            instance(displayDataProvider)
        );
        when(serviceContainer.get<NotebookCellLanguageService>(NotebookCellLanguageService)).thenReturn(
            instance(languageService)
        );
        when(serviceContainer.get<IExtensionContext>(IExtensionContext)).thenReturn(instance(context));
        when(serviceContainer.get<IKernelProvider>(IKernelProvider)).thenReturn(instance(kernelProvider));
        addOrUpdateCalled = false;

        onDidChangeRegistrations = new EventEmitter<{
            added: IContributedKernelFinder<KernelConnectionMetadata>[];
            removed: IContributedKernelFinder<KernelConnectionMetadata>[];
        }>();
        disposables.push(onDidChangeRegistrations);
        onDidChangeFilter = new EventEmitter<void>();
        disposables.push(onDidChangeFilter);
        onDidChangeUri = new EventEmitter<void>();
        disposables.push(onDidChangeUri);
        onDidRemoveUris = new EventEmitter<IJupyterServerUriEntry[]>();
        disposables.push(onDidRemoveUris);
        onDidChangeInterpreter = new EventEmitter<PythonEnvironment | undefined>();
        disposables.push(onDidChangeInterpreter);
        onDidChangeInterpreters = new EventEmitter<PythonEnvironment[]>();
        disposables.push(onDidChangeInterpreters);
        onDidChangeKernelsInContributedLocalKernelFinder = new EventEmitter<{
            added?: KernelConnectionMetadata[] | undefined;
            updated?: KernelConnectionMetadata[] | undefined;
            removed?: KernelConnectionMetadata[] | undefined;
        }>();
        disposables.push(onDidChangeKernelsInContributedLocalKernelFinder);
        onDidChangeKernelsInContributedPythonKernelFinder = new EventEmitter<{
            added?: KernelConnectionMetadata[] | undefined;
            updated?: KernelConnectionMetadata[] | undefined;
            removed?: KernelConnectionMetadata[] | undefined;
        }>();
        disposables.push(onDidChangeKernelsInContributedPythonKernelFinder);

        when(kernelFinder.onDidChangeKernels).thenReturn(onDidChangeKernels.event);
        when(kernelFinder.onDidChangeRegistrations).thenReturn(onDidChangeRegistrations.event);
        when(kernelFilter.onDidChange).thenReturn(onDidChangeFilter.event);
        when(serverUriStorage.onDidChange).thenReturn(onDidChangeUri.event);
        when(serverUriStorage.onDidRemove).thenReturn(onDidRemoveUris.event);
        when(interpreters.onDidChangeInterpreter).thenReturn(onDidChangeInterpreter.event);
        when(interpreters.onDidChangeInterpreters).thenReturn(onDidChangeInterpreters.event);
        when(contributedLocalKernelFinder.onDidChangeKernels).thenReturn(
            onDidChangeKernelsInContributedLocalKernelFinder.event
        );
        when(contributedPythonKernelFinder.onDidChangeKernels).thenReturn(
            onDidChangeKernelsInContributedPythonKernelFinder.event
        );
        onDidChangeKernelsInContributedPythonKernelFinder;
        when(kernelFinder.registered).thenReturn([
            instance(contributedLocalKernelFinder),
            instance(contributedPythonKernelFinder)
        ]);
        when(kernelFinder.kernels).thenReturn([]);
        when(interpreters.resolvedEnvironments).thenReturn([activePythonEnv]);
        when(kernelFilter.isPythonEnvironmentExcluded(anything())).thenReturn(false);
        when(vscNotebook.notebookDocuments).thenReturn([]);
        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
        when(interpreters.getActiveInterpreter(anything())).thenResolve(activePythonEnv);

        clock = fakeTimers.install();
        disposables.push(new Disposable(() => clock.uninstall()));
    });
    teardown(() => {
        sinon.restore();
        disposeAllDisposables(disposables);
    });

    [true, false].forEach((web) => {
        suite(`${web ? 'Web' : 'Desktop'}`, () => {
            setup(() => {
                registration = new ControllerRegistration(
                    instance(vscNotebook),
                    disposables,
                    instance(kernelFilter),
                    instance(workspace),
                    instance(extensionChecker),
                    instance(serviceContainer),
                    instance(serverUriStorage),
                    instance(kernelFinder)
                );
            });
            test('No controllers created if there are no kernels', async () => {
                when(interpreters.getActiveInterpreter(anything())).thenResolve(undefined);
                registration.addOrUpdate = () => {
                    addOrUpdateCalled = true;
                    return [];
                };
                const stubCtor = sinon.stub(VSCodeNotebookController, 'create');

                registration.activate();
                await clock.runAllAsync();
                await registration.loaded;

                assert.isFalse(addOrUpdateCalled, 'addOrUpdate should not be called');
                assert.isFalse(stubCtor.called, 'VSCodeNotebookController should not be called');
            });
            test('No controllers created if there are no kernels and even if we have an active interpreter', async function () {
                if (web) {
                    return this.skip();
                }
                when(interpreters.getActiveInterpreter(anything())).thenResolve(activePythonEnv);
                registration.addOrUpdate = () => {
                    addOrUpdateCalled = true;
                    return [];
                };
                const stubCtor = sinon.stub(VSCodeNotebookController, 'create');

                registration.activate();
                await clock.runAllAsync();
                await registration.loaded;

                assert.isFalse(addOrUpdateCalled, 'addOrUpdate should not be called');
                assert.isFalse(stubCtor.called, 'VSCodeNotebookController should not be called');
            });
            test('Create controller for discovered kernels', async function () {
                if (web) {
                    return this.skip();
                }
                when(interpreters.getActiveInterpreter(anything())).thenResolve(undefined);
                when(kernelFinder.kernels).thenReturn([
                    activePythonConnection,
                    condaPythonConnection,
                    javaKernelConnection
                ]);
                const controller = mock<IVSCodeNotebookController>();
                (instance(controller) as any).then = undefined;
                when(controller.connection).thenReturn(instance(mock<KernelConnectionMetadata>()));
                registration.addOrUpdate = () => {
                    addOrUpdateCalled = true;
                    return [instance(controller)];
                };
                const stubCtor = sinon.stub(VSCodeNotebookController, 'create');

                registration.activate();
                await clock.runAllAsync();
                await registration.loaded;

                assert.isFalse(addOrUpdateCalled, 'addOrUpdate should not be called');
                assert.equal(stubCtor.callCount, 3);
                assert.deepEqual(stubCtor.args[0][0], activePythonConnection);
                assert.deepEqual(stubCtor.args[1][0], condaPythonConnection);
                assert.deepEqual(stubCtor.args[2][0], javaKernelConnection);
            });
            test('Disposed controller for if associated kernel connection no longer exists', async function () {
                if (web) {
                    return this.skip();
                }
                when(interpreters.getActiveInterpreter(anything())).thenResolve(undefined);
                when(kernelFinder.kernels).thenReturn([
                    activePythonConnection,
                    condaPythonConnection,
                    javaKernelConnection
                ]);
                // const controller = mock<IVSCodeNotebookController>();
                // (instance(controller) as any).then = undefined;
                // when(controller.connection).thenReturn(instance(mock<KernelConnectionMetadata>()));
                // registration.addOrUpdate = () => {
                //     addOrUpdateCalled = true;
                //     return [instance(controller)];
                // };

                const activeInterpreterController = mock<VSCodeNotebookController>();
                when(activeInterpreterController.connection).thenReturn(activePythonConnection);
                const condaController = mock<VSCodeNotebookController>();
                when(condaController.connection).thenReturn(condaPythonConnection);
                const javaController = mock<VSCodeNotebookController>();
                when(javaController.connection).thenReturn(javaKernelConnection);

                const stubCtor = sinon.stub(VSCodeNotebookController, 'create');
                stubCtor.callsFake(
                    (
                        connection: KernelConnectionMetadata,
                        id,
                        _arg2,
                        _arg3,
                        _arg4,
                        _arg5,
                        _arg6,
                        _arg7,
                        _arg8,
                        _arg9,
                        _arg10,
                        _arg11,
                        _arg12,
                        _arg13,
                        _arg14,
                        _arg15,
                        _arg16
                    ) => {
                        if (connection === activePythonConnection) {
                            when(activeInterpreterController.id).thenReturn(id);
                            return instance(activeInterpreterController);
                        } else if (connection === condaPythonConnection) {
                            when(condaController.id).thenReturn(id);
                            return instance(condaController);
                        } else if (connection === javaKernelConnection) {
                            when(javaController.id).thenReturn(id);
                            return instance(javaController);
                        }
                        throw new Error('Unexpected connection');
                    }
                );

                registration.activate();
                await clock.runAllAsync();
                await registration.loaded;

                assert.isFalse(addOrUpdateCalled, 'addOrUpdate should not be called');
                assert.equal(stubCtor.callCount, 6);

                // Trigger a change even though nothing has changed.
                onDidChangeKernels.fire();
                await clock.runAllAsync();
                await registration.loaded;

                // We should see no difference in the controllers.
                assert.isFalse(addOrUpdateCalled, 'addOrUpdate should not be called');
                assert.equal(stubCtor.callCount, 6);
                verify(activeInterpreterController.dispose()).never();
                verify(condaController.dispose()).never();
                verify(javaController.dispose()).never();

                // Trigger a change and ensure one of the kernel is no longer available.
                when(kernelFinder.kernels).thenReturn([activePythonConnection, javaKernelConnection]);
                onDidChangeKernels.fire();
                await clock.runAllAsync();
                await registration.loaded;

                verify(activeInterpreterController.dispose()).never();
                verify(condaController.dispose()).atLeast(1);
                verify(javaController.dispose()).never();
            });
            test('Disposed controller for if associated kernel is removed', async function () {
                if (web) {
                    return this.skip();
                }
                when(interpreters.getActiveInterpreter(anything())).thenResolve(undefined);
                when(kernelFinder.kernels).thenReturn([
                    activePythonConnection,
                    condaPythonConnection,
                    javaKernelConnection
                ]);
                const controller = mock<IVSCodeNotebookController>();
                (instance(controller) as any).then = undefined;
                when(controller.connection).thenReturn(instance(mock<KernelConnectionMetadata>()));

                const activeInterpreterController = mock<VSCodeNotebookController>();
                when(activeInterpreterController.connection).thenReturn(activePythonConnection);
                const condaController = mock<VSCodeNotebookController>();
                when(condaController.connection).thenReturn(condaPythonConnection);
                const javaController = mock<VSCodeNotebookController>();
                when(javaController.connection).thenReturn(javaKernelConnection);

                const stubCtor = sinon.stub(VSCodeNotebookController, 'create');
                stubCtor.callsFake(
                    (
                        connection: KernelConnectionMetadata,
                        id,
                        _arg2,
                        _arg3,
                        _arg4,
                        _arg5,
                        _arg6,
                        _arg7,
                        _arg8,
                        _arg9,
                        _arg10,
                        _arg11,
                        _arg12,
                        _arg13,
                        _arg14,
                        _arg15,
                        _arg16
                    ) => {
                        if (connection === activePythonConnection) {
                            when(activeInterpreterController.id).thenReturn(id);
                            return instance(activeInterpreterController);
                        } else if (connection === condaPythonConnection) {
                            when(condaController.id).thenReturn(id);
                            return instance(condaController);
                        } else if (connection === javaKernelConnection) {
                            when(javaController.id).thenReturn(id);
                            return instance(javaController);
                        }
                        throw new Error('Unexpected connection');
                    }
                );

                registration.activate();
                await clock.runAllAsync();
                await registration.loaded;

                assert.isFalse(addOrUpdateCalled, 'addOrUpdate should not be called');
                assert.equal(stubCtor.callCount, 6);

                // when(registration.canControllerBeDisposed(anything())).thenReturn(true);

                // Trigger a change even though nothing has changed.
                onDidChangeKernels.fire();
                await clock.runAllAsync();
                await registration.loaded;

                // We should see no difference in the controllers.
                assert.isFalse(addOrUpdateCalled, 'addOrUpdate should not be called');
                assert.equal(stubCtor.callCount, 6);
                verify(activeInterpreterController.dispose()).never();
                verify(condaController.dispose()).never();
                verify(javaController.dispose()).never();

                // Remove a connection from a finder.
                onDidChangeKernelsInContributedLocalKernelFinder.fire({ removed: [javaKernelConnection] });
                await clock.runAllAsync();

                verify(activeInterpreterController.dispose()).never();
                verify(condaController.dispose()).never();
                verify(javaController.dispose()).atLeast(1);

                // Now remove the conda connection.
                onDidChangeKernelsInContributedPythonKernelFinder.fire({ removed: [condaPythonConnection] });
                await clock.runAllAsync();

                verify(activeInterpreterController.dispose()).never();
                verify(condaController.dispose()).atLeast(1);
                verify(javaController.dispose()).atLeast(1);
            });
        });
    });
});
