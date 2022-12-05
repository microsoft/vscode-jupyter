// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fakeTimers from '@sinonjs/fake-timers';
import { anything, deepEqual, instance, mock, verify, when } from 'ts-mockito';
import { Disposable, EventEmitter, Uri } from 'vscode';
import { IContributedKernelFinder } from '../../kernels/internalTypes';
import { IJupyterServerUriEntry, IJupyterServerUriStorage } from '../../kernels/jupyter/types';
import {
    IJupyterKernelSpec,
    IKernelFinder,
    KernelConnectionMetadata,
    LocalKernelSpecConnectionMetadata,
    PythonKernelConnectionMetadata
} from '../../kernels/types';
import { IPythonExtensionChecker } from '../../platform/api/types';
import { IVSCodeNotebook } from '../../platform/common/application/types';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { IDisposable, IFeaturesManager } from '../../platform/common/types';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { EnvironmentType, PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { ControllerLoader } from './controllerLoader';
import { KernelFilterService } from './kernelFilter/kernelFilterService';
import { IControllerRegistration, IVSCodeNotebookController, IVSCodeNotebookControllerUpdateEvent } from './types';

suite('Controller Loader', () => {
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
    let registration: IControllerRegistration;
    let featureManager: IFeaturesManager;
    let serverUriStorage: IJupyterServerUriStorage;
    let kernelFilter: KernelFilterService;
    let controllerLoader: ControllerLoader;
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
    let onDidChangeConnectionType: EventEmitter<void>;
    let onDidChangeUri: EventEmitter<void>;
    let onDidRemoveUris: EventEmitter<IJupyterServerUriEntry[]>;
    let onDidChangeInterpreter: EventEmitter<void>;
    let onDidChangeInterpreters: EventEmitter<void>;
    let onDidChangeControllers: EventEmitter<IVSCodeNotebookControllerUpdateEvent>;
    let contributedLocalKernelFinder: IContributedKernelFinder;
    let contributedPythonKernelFinder: IContributedKernelFinder;
    setup(() => {
        vscNotebook = mock<IVSCodeNotebook>();
        kernelFinder = mock<IKernelFinder>();
        extensionChecker = mock<IPythonExtensionChecker>();
        interpreters = mock<IInterpreterService>();
        registration = mock<IControllerRegistration>();
        featureManager = mock<IFeaturesManager>();
        serverUriStorage = mock<IJupyterServerUriStorage>();
        kernelFilter = mock<KernelFilterService>();
        contributedLocalKernelFinder = mock<IContributedKernelFinder>();
        contributedPythonKernelFinder = mock<IContributedKernelFinder>();

        onDidChangeKernels = new EventEmitter<void>();
        disposables.push(onDidChangeKernels);
        onDidChangeRegistrations = new EventEmitter<{
            added: IContributedKernelFinder<KernelConnectionMetadata>[];
            removed: IContributedKernelFinder<KernelConnectionMetadata>[];
        }>();
        disposables.push(onDidChangeRegistrations);
        onDidChangeFilter = new EventEmitter<void>();
        disposables.push(onDidChangeFilter);
        onDidChangeConnectionType = new EventEmitter<void>();
        disposables.push(onDidChangeConnectionType);
        onDidChangeUri = new EventEmitter<void>();
        disposables.push(onDidChangeUri);
        onDidRemoveUris = new EventEmitter<IJupyterServerUriEntry[]>();
        disposables.push(onDidRemoveUris);
        onDidChangeInterpreter = new EventEmitter<void>();
        disposables.push(onDidChangeInterpreter);
        onDidChangeInterpreters = new EventEmitter<void>();
        disposables.push(onDidChangeInterpreters);
        onDidChangeControllers = new EventEmitter<IVSCodeNotebookControllerUpdateEvent>();
        disposables.push(onDidChangeControllers);
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
        when(serverUriStorage.onDidChangeConnectionType).thenReturn(onDidChangeConnectionType.event);
        when(serverUriStorage.onDidChangeUri).thenReturn(onDidChangeUri.event);
        when(serverUriStorage.onDidRemoveUris).thenReturn(onDidRemoveUris.event);
        when(interpreters.onDidChangeInterpreter).thenReturn(onDidChangeInterpreter.event);
        when(interpreters.onDidChangeInterpreters).thenReturn(onDidChangeInterpreters.event);
        when(registration.onDidChange).thenReturn(onDidChangeControllers.event);
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
        when(interpreters.environments).thenReturn([]);
        when(interpreters.resolvedEnvironments).thenReturn([activePythonEnv]);
        when(kernelFilter.isKernelHidden(anything())).thenReturn(false);
        when(vscNotebook.notebookDocuments).thenReturn([]);
        when(registration.registered).thenReturn([]);
        when(featureManager.features).thenReturn({ kernelPickerType: 'Insiders' });
        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
        when(interpreters.getActiveInterpreter(anything())).thenResolve(activePythonEnv);
        when(registration.addOrUpdate(anything(), anything())).thenReturn([]);
        when(registration.trackActiveInterpreterControllers(anything())).thenReturn();

        clock = fakeTimers.install();
        disposables.push(new Disposable(() => clock.uninstall()));
    });
    teardown(()=> disposeAllDisposables(disposables));
    [true, false].forEach((web) => {
        suite(`${web ? 'Web' : 'Desktop'}`, () => {
            setup(() => {
                controllerLoader = new ControllerLoader(
                    instance(vscNotebook),
                    disposables,
                    instance(kernelFinder),
                    instance(extensionChecker),
                    instance(interpreters),
                    instance(registration),
                    instance(featureManager),
                    instance(serverUriStorage),
                    instance(kernelFilter),
                    web
                );
            });
            test('No controllers created if there are no kernels', async () => {
                when(interpreters.getActiveInterpreter(anything())).thenResolve(undefined);

                controllerLoader.activate();
                await clock.runAllAsync();
                await controllerLoader.loaded;

                verify(registration.addOrUpdate(anything(), anything())).never();
                verify(registration.batchAdd(anything(), anything())).never();
            });
            test('No controllers created if there are no kernels and even if we have an active interpreter', async function () {
                if (web) {
                    return this.skip();
                }
                when(featureManager.features).thenReturn({ kernelPickerType: 'Insiders' });
                when(interpreters.getActiveInterpreter(anything())).thenResolve(activePythonEnv);

                controllerLoader.activate();
                await clock.runAllAsync();
                await controllerLoader.loaded;

                verify(registration.addOrUpdate(anything(), anything())).never();
                verify(registration.batchAdd(anything(), anything())).never();
            });
            test('Create controller for active interpreter with older kernel picker', async function () {
                if (web) {
                    return this.skip();
                }
                when(featureManager.features).thenReturn({ kernelPickerType: 'Stable' });
                when(interpreters.getActiveInterpreter(anything())).thenResolve(activePythonEnv);
                when(serverUriStorage.isLocalLaunch).thenReturn(true);
                const controller = mock<IVSCodeNotebookController>();
                (instance(controller) as any).then = undefined;
                when(controller.connection).thenReturn(instance(mock<KernelConnectionMetadata>()));
                when(registration.addOrUpdate(anything(), anything())).thenReturn([instance(controller)]);

                controllerLoader.activate();
                await clock.runAllAsync();
                await controllerLoader.loaded;

                verify(registration.addOrUpdate(anything(), anything())).once();
                verify(registration.batchAdd(anything(), anything())).never();
            });
            test('Create controller for discovered kernels', async function () {
                if (web) {
                    return this.skip();
                }
                when(featureManager.features).thenReturn({ kernelPickerType: 'Stable' });
                when(featureManager.features).thenReturn({ kernelPickerType: 'Insiders' });
                when(interpreters.getActiveInterpreter(anything())).thenResolve(undefined);
                when(kernelFinder.kernels).thenReturn([
                    activePythonConnection,
                    condaPythonConnection,
                    javaKernelConnection
                ]);
                when(serverUriStorage.isLocalLaunch).thenReturn(true);
                const controller = mock<IVSCodeNotebookController>();
                (instance(controller) as any).then = undefined;
                when(controller.connection).thenReturn(instance(mock<KernelConnectionMetadata>()));
                when(registration.addOrUpdate(anything(), anything())).thenReturn([instance(controller)]);

                controllerLoader.activate();
                await clock.runAllAsync();
                await controllerLoader.loaded;

                verify(registration.addOrUpdate(anything(), anything())).never();
                verify(
                    registration.batchAdd(
                        deepEqual([activePythonConnection, condaPythonConnection, javaKernelConnection]),
                        deepEqual(['jupyter-notebook', 'interactive'])
                    )
                ).once();
            });
            test('Disposed controller for if associated kernel connection no longer exists', async function () {
                if (web) {
                    return this.skip();
                }
                when(featureManager.features).thenReturn({ kernelPickerType: 'Stable' });
                when(featureManager.features).thenReturn({ kernelPickerType: 'Insiders' });
                when(interpreters.getActiveInterpreter(anything())).thenResolve(undefined);
                when(kernelFinder.kernels).thenReturn([
                    activePythonConnection,
                    condaPythonConnection,
                    javaKernelConnection
                ]);
                when(serverUriStorage.isLocalLaunch).thenReturn(true);
                const controller = mock<IVSCodeNotebookController>();
                (instance(controller) as any).then = undefined;
                when(controller.connection).thenReturn(instance(mock<KernelConnectionMetadata>()));
                when(registration.addOrUpdate(anything(), anything())).thenReturn([instance(controller)]);

                controllerLoader.activate();
                await clock.runAllAsync();
                await controllerLoader.loaded;

                verify(registration.addOrUpdate(anything(), anything())).never();
                verify(
                    registration.batchAdd(
                        deepEqual([activePythonConnection, condaPythonConnection, javaKernelConnection]),
                        deepEqual(['jupyter-notebook', 'interactive'])
                    )
                ).once();

                const activeInterpreterController = mock<IVSCodeNotebookController>();
                when(activeInterpreterController.connection).thenReturn(activePythonConnection);
                const condaController = mock<IVSCodeNotebookController>();
                when(condaController.connection).thenReturn(condaPythonConnection);
                const javaController = mock<IVSCodeNotebookController>();
                when(javaController.connection).thenReturn(javaKernelConnection);
                when(registration.registered).thenReturn([
                    instance(activeInterpreterController),
                    instance(condaController),
                    instance(javaController)
                ]);
                when(registration.canControllerBeDisposed(anything())).thenReturn(true);

                // Trigger a change even though nothing has changed.
                onDidChangeKernels.fire();
                await clock.runAllAsync();
                await controllerLoader.loaded;

                // We should see no difference in the controllers.
                verify(registration.addOrUpdate(anything(), anything())).never();
                verify(
                    registration.batchAdd(
                        deepEqual([activePythonConnection, condaPythonConnection, javaKernelConnection]),
                        deepEqual(['jupyter-notebook', 'interactive'])
                    )
                ).atLeast(1);
                verify(activeInterpreterController.dispose()).never();
                verify(condaController.dispose()).never();
                verify(javaController.dispose()).never();

                // Trigger a change and ensure one of the kernel is no longer available.
                when(kernelFinder.kernels).thenReturn([activePythonConnection, javaKernelConnection]);
                onDidChangeKernels.fire();
                await clock.runAllAsync();
                await controllerLoader.loaded;

                verify(activeInterpreterController.dispose()).never();
                verify(condaController.dispose()).once();
                verify(javaController.dispose()).never();
            });
            test('Disposed controller for if associated kernel is removed', async function () {
                if (web) {
                    return this.skip();
                }
                when(featureManager.features).thenReturn({ kernelPickerType: 'Stable' });
                when(featureManager.features).thenReturn({ kernelPickerType: 'Insiders' });
                when(interpreters.getActiveInterpreter(anything())).thenResolve(undefined);
                when(kernelFinder.kernels).thenReturn([
                    activePythonConnection,
                    condaPythonConnection,
                    javaKernelConnection
                ]);
                when(serverUriStorage.isLocalLaunch).thenReturn(true);
                const controller = mock<IVSCodeNotebookController>();
                (instance(controller) as any).then = undefined;
                when(controller.connection).thenReturn(instance(mock<KernelConnectionMetadata>()));
                when(registration.addOrUpdate(anything(), anything())).thenReturn([instance(controller)]);

                controllerLoader.activate();
                await clock.runAllAsync();
                await controllerLoader.loaded;

                verify(registration.addOrUpdate(anything(), anything())).never();
                verify(
                    registration.batchAdd(
                        deepEqual([activePythonConnection, condaPythonConnection, javaKernelConnection]),
                        deepEqual(['jupyter-notebook', 'interactive'])
                    )
                ).once();

                const activeInterpreterController = mock<IVSCodeNotebookController>();
                when(activeInterpreterController.connection).thenReturn(activePythonConnection);
                const condaController = mock<IVSCodeNotebookController>();
                when(condaController.connection).thenReturn(condaPythonConnection);
                const javaController = mock<IVSCodeNotebookController>();
                when(javaController.connection).thenReturn(javaKernelConnection);
                when(registration.registered).thenReturn([
                    instance(activeInterpreterController),
                    instance(condaController),
                    instance(javaController)
                ]);
                when(registration.canControllerBeDisposed(anything())).thenReturn(true);

                // Trigger a change even though nothing has changed.
                onDidChangeKernels.fire();
                await clock.runAllAsync();
                await controllerLoader.loaded;

                // We should see no difference in the controllers.
                verify(registration.addOrUpdate(anything(), anything())).never();
                verify(
                    registration.batchAdd(
                        deepEqual([activePythonConnection, condaPythonConnection, javaKernelConnection]),
                        deepEqual(['jupyter-notebook', 'interactive'])
                    )
                ).atLeast(1);
                verify(activeInterpreterController.dispose()).never();
                verify(condaController.dispose()).never();
                verify(javaController.dispose()).never();

                // Remove a connection from a finder.
                onDidChangeKernelsInContributedLocalKernelFinder.fire({ removed: [javaKernelConnection] });
                await clock.runAllAsync();

                verify(activeInterpreterController.dispose()).never();
                verify(condaController.dispose()).never();
                verify(javaController.dispose()).once();

                // Now remove the conda connection.
                onDidChangeKernelsInContributedPythonKernelFinder.fire({ removed: [condaPythonConnection] });
                await clock.runAllAsync();

                verify(activeInterpreterController.dispose()).never();
                verify(condaController.dispose()).once();
                verify(javaController.dispose()).once();
            });
        });
    });
});
