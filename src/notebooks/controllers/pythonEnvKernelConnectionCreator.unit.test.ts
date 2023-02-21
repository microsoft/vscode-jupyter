// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import { anything, capture, deepEqual, instance, mock, verify, when } from 'ts-mockito';
import { CancellationTokenSource, Disposable, EventEmitter, NotebookDocument, Uri } from 'vscode';
import { ContributedKernelFinderKind, IContributedKernelFinder } from '../../kernels/internalTypes';
import {
    IJupyterKernelSpec,
    IKernelDependencyService,
    IKernelFinder,
    KernelInterpreterDependencyResponse,
    LocalKernelSpecConnectionMetadata,
    PythonKernelConnectionMetadata
} from '../../kernels/types';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { IDisposable } from '../../platform/common/types';
import { IInterpreterService } from '../../platform/interpreter/contracts';
import { ServiceContainer } from '../../platform/ioc/container';
import { EnvironmentType } from '../../platform/pythonEnvironments/info';
import { sleep } from '../../test/core';
import { TestNotebookDocument } from '../../test/datascience/notebook/executionHelper';
import { mockedVSCodeNamespaces } from '../../test/vscode-mock';
import { PythonEnvKernelConnectionCreator } from './pythonEnvKernelConnectionCreator';
import { IControllerRegistration, IVSCodeNotebookController } from './types';

suite('Python Environment Kernel Connection Creator', () => {
    let pythonEnvKernelConnectionCreator: PythonEnvKernelConnectionCreator;
    let kernelDependencyService: IKernelDependencyService;
    let kernelFinder: IKernelFinder;
    let localPythonEnvFinder: IContributedKernelFinder<PythonKernelConnectionMetadata>;
    let interpreterService: IInterpreterService;
    let onDidChangePythonKernels: EventEmitter<{
        added?: PythonKernelConnectionMetadata[];
        removed?: PythonKernelConnectionMetadata[];
        updated?: PythonKernelConnectionMetadata[];
    }>;
    const disposables: IDisposable[] = [];
    let notebook: NotebookDocument;
    let controllerRegistration: IControllerRegistration;
    let onControllerSelected: EventEmitter<{ notebook: NotebookDocument; controller: IVSCodeNotebookController }>;
    let cancellation: CancellationTokenSource;
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
    const newCondaPythonKernel = PythonKernelConnectionMetadata.create({
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
            uri: Uri.file('.conda/bin/python'),
            envType: EnvironmentType.Conda
        }
    });

    setup(() => {
        const serviceContainer = mock<ServiceContainer>();
        const iocStub = sinon.stub(ServiceContainer, 'instance').get(() => instance(serviceContainer));
        disposables.push(new Disposable(() => iocStub.restore()));

        cancellation = new CancellationTokenSource();
        disposables.push(cancellation);
        notebook = new TestNotebookDocument(undefined, 'jupyter-notebook');
        controllerRegistration = mock<IControllerRegistration>();
        kernelFinder = mock<IKernelFinder>();
        localPythonEnvFinder = mock<IContributedKernelFinder<PythonKernelConnectionMetadata>>();
        interpreterService = mock<IInterpreterService>();
        kernelDependencyService = mock<IKernelDependencyService>();
        onControllerSelected = new EventEmitter<{
            notebook: NotebookDocument;
            controller: IVSCodeNotebookController;
        }>();
        onDidChangePythonKernels = new EventEmitter<{
            added?: PythonKernelConnectionMetadata[];
            removed?: PythonKernelConnectionMetadata[];
            updated?: PythonKernelConnectionMetadata[];
        }>();
        disposables.push(onDidChangePythonKernels);
        disposables.push(onControllerSelected);
        when(controllerRegistration.onControllerSelected).thenReturn(onControllerSelected.event);
        when(serviceContainer.get<IKernelFinder>(IKernelFinder)).thenReturn(instance(kernelFinder));
        when(serviceContainer.get<IInterpreterService>(IInterpreterService)).thenReturn(instance(interpreterService));
        when(serviceContainer.get<IControllerRegistration>(IControllerRegistration)).thenReturn(
            instance(controllerRegistration)
        );
        when(serviceContainer.get<IKernelDependencyService>(IKernelDependencyService)).thenReturn(
            instance(kernelDependencyService)
        );
        when(localPythonEnvFinder.kind).thenReturn(ContributedKernelFinderKind.LocalPythonEnvironment);
        when(localPythonEnvFinder.onDidChangeKernels).thenReturn(onDidChangePythonKernels.event);
        when(kernelFinder.registered).thenReturn([instance(localPythonEnvFinder)]);

        pythonEnvKernelConnectionCreator = new PythonEnvKernelConnectionCreator(notebook, cancellation.token);
        disposables.push(pythonEnvKernelConnectionCreator);
    });
    teardown(() => disposeAllDisposables(disposables));
    test('Not does create a Python Env when Python extension fails to create it', async () => {
        when(mockedVSCodeNamespaces.commands.executeCommand('python.createEnvironment', anything())).thenResolve(
            undefined
        );

        const kernel = await pythonEnvKernelConnectionCreator.createPythonEnvFromKernelPicker();
        const connection = 'kernelConnection' in kernel ? kernel.kernelConnection : undefined;
        assert.isUndefined(connection);
    });
    test('Can cancel after creation of the Environment', async () => {
        const newCondaEnvPath = '<workspaceFolder>/.conda';
        when(mockedVSCodeNamespaces.commands.executeCommand('python.createEnvironment', anything())).thenResolve({
            path: newCondaEnvPath
        } as any);
        when(localPythonEnvFinder.kernels).thenReturn([venvPythonKernel]);
        when(localPythonEnvFinder.status).thenReturn('idle');
        when(interpreterService.getInterpreterDetails(deepEqual({ path: newCondaEnvPath }))).thenCall(() => {
            cancellation.cancel();
            return Promise.resolve(newCondaPythonKernel.interpreter);
        });

        const kernelPromise = pythonEnvKernelConnectionCreator.createPythonEnvFromKernelPicker();

        assert.isUndefined(await kernelPromise);
        verify(interpreterService.getInterpreterDetails(deepEqual({ path: newCondaEnvPath }))).once();
    });
    test('Installs missing dependencies and returns the kernel connection', async () => {
        const newCondaEnvPath = '<workspaceFolder>/.conda';
        when(mockedVSCodeNamespaces.commands.executeCommand('python.createEnvironment', anything())).thenResolve({
            path: newCondaEnvPath
        } as any);
        when(localPythonEnvFinder.kernels).thenReturn([venvPythonKernel, newCondaPythonKernel]);
        when(localPythonEnvFinder.status).thenReturn('idle');
        when(interpreterService.getInterpreterDetails(deepEqual({ path: newCondaEnvPath }))).thenResolve(
            newCondaPythonKernel.interpreter
        );
        when(kernelDependencyService.installMissingDependencies(anything())).thenResolve(
            KernelInterpreterDependencyResponse.ok
        );

        const kernel = await pythonEnvKernelConnectionCreator.createPythonEnvFromKernelPicker();
        const kernelConnection = 'kernelConnection' in kernel ? kernel.kernelConnection : undefined;
        if (!kernelConnection) {
            assert.fail('Kernel Connection not created');
        }
        assert.strictEqual(kernelConnection, newCondaPythonKernel);
        verify(interpreterService.getInterpreterDetails(deepEqual({ path: newCondaEnvPath }))).once();
        verify(kernelDependencyService.installMissingDependencies(anything())).once();
        const args = capture(kernelDependencyService.installMissingDependencies).first()[0];
        assert.strictEqual(args.cannotChangeKernels, true);
        assert.strictEqual(args.installWithoutPrompting, true);
        assert.strictEqual(args.kernelConnection, newCondaPythonKernel);
        assert.strictEqual(args.resource, notebook.uri);
        assert.strictEqual(args.ui.disableUI, false);
    });
    test('Abort creation if another controller is selected for the notebook', async () => {
        const newCondaEnvPath = '<workspaceFolder>/.conda';
        when(mockedVSCodeNamespaces.commands.executeCommand('python.createEnvironment', anything())).thenResolve({
            path: newCondaEnvPath
        } as any);
        when(localPythonEnvFinder.kernels).thenReturn([venvPythonKernel]);
        when(localPythonEnvFinder.status).thenReturn('idle');
        when(interpreterService.getInterpreterDetails(deepEqual({ path: newCondaEnvPath }))).thenCall(async () => {
            const differentController = mock<IVSCodeNotebookController>();
            const differentConnection = LocalKernelSpecConnectionMetadata.create({
                id: '1234',
                kernelSpec: instance(mock<IJupyterKernelSpec>())
            });
            when(differentController.connection).thenReturn(differentConnection);
            onControllerSelected.fire({ notebook, controller: differentController });
            await sleep(10);
            return Promise.resolve(newCondaPythonKernel.interpreter);
        });

        const kernelPromise = pythonEnvKernelConnectionCreator.createPythonEnvFromKernelPicker();

        assert.isUndefined(await kernelPromise);
        verify(interpreterService.getInterpreterDetails(deepEqual({ path: newCondaEnvPath }))).once();
    });
});
