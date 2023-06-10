// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { anything, deepEqual, instance, mock, verify, when } from 'ts-mockito';
import { NotebookDocument, Uri } from 'vscode';
import { DisplayOptions } from '../../kernels/displayOptions';
import { KernelDeadError } from '../../kernels/errors/kernelDeadError';
import { IDataScienceErrorHandler } from '../../kernels/errors/types';
import { getDisplayNameOrNameOfKernelConnection } from '../../kernels/helpers';
import { ITrustedKernelPaths } from '../../kernels/raw/finder/types';
import {
    IKernel,
    IKernelSession,
    IKernelController,
    IKernelProvider,
    KernelInterpreterDependencyResponse,
    PythonKernelConnectionMetadata
} from '../../kernels/types';
import { IApplicationShell, ICommandManager } from '../../platform/common/application/types';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { IDisposable } from '../../platform/common/types';
import { DataScience } from '../../platform/common/utils/localize';
import { IServiceContainer } from '../../platform/ioc/types';
import { createKernelController, TestNotebookDocument } from '../../test/datascience/notebook/executionHelper';
import { KernelConnector } from './kernelConnector';

suite('Kernel Connector', () => {
    const pythonConnection = PythonKernelConnectionMetadata.create({
        interpreter: {
            id: 'id',
            sysPrefix: '',
            uri: Uri.file('python')
        },
        kernelSpec: {
            argv: ['python'],
            display_name: '',
            executable: '',
            language: 'python',
            name: 'python'
        }
    });
    let serviceContainer: IServiceContainer;
    let kernelProvider: IKernelProvider;
    let trustedKernels: ITrustedKernelPaths;
    let notebook: NotebookDocument;
    const disposables: IDisposable[] = [];
    let controller: IKernelController;
    let kernel: IKernel;
    let errorHandler: IDataScienceErrorHandler;
    let kernelSession: IKernelSession;
    let appShell: IApplicationShell;
    let commandManager: ICommandManager;
    let pythonKernelSpec = PythonKernelConnectionMetadata.create({
        interpreter: {
            id: 'id',
            sysPrefix: '',
            uri: Uri.file('python')
        },
        kernelSpec: {
            argv: [],
            display_name: 'python',
            executable: '',
            name: 'python'
        }
    });
    setup(() => {
        serviceContainer = mock<IServiceContainer>();
        kernelProvider = mock<IKernelProvider>();
        trustedKernels = mock<ITrustedKernelPaths>();
        errorHandler = mock<IDataScienceErrorHandler>();
        kernelSession = mock<IKernelSession>();
        appShell = mock<IApplicationShell>();
        commandManager = mock<ICommandManager>();
        kernel = mock<IKernel>();
        (instance(kernel) as any).then = undefined;
        notebook = new TestNotebookDocument();
        (instance(kernelSession) as any).then = undefined;

        when(kernel.dispose()).thenResolve();
        when(kernel.start(anything())).thenResolve(instance(kernelSession));
        when(kernel.kernelConnectionMetadata).thenReturn(pythonKernelSpec);
        when(trustedKernels.isTrusted(anything())).thenReturn(true);
        when(serviceContainer.get<IKernelProvider>(IKernelProvider)).thenReturn(instance(kernelProvider));
        when(serviceContainer.get<ITrustedKernelPaths>(ITrustedKernelPaths)).thenReturn(instance(trustedKernels));
        when(serviceContainer.get<IApplicationShell>(IApplicationShell)).thenReturn(instance(appShell));
        when(serviceContainer.get<ICommandManager>(ICommandManager)).thenReturn(instance(commandManager));
        when(serviceContainer.get<IDataScienceErrorHandler>(IDataScienceErrorHandler)).thenReturn(
            instance(errorHandler)
        );
        when(kernelProvider.getOrCreate(anything(), anything())).thenReturn(instance(kernel));
        controller = createKernelController(pythonConnection.id);
    });
    teardown(() => disposeAllDisposables(disposables));
    test('Can start a kernel', async () => {
        when(kernel.status).thenReturn('idle');

        await KernelConnector.connectToNotebookKernel(
            pythonConnection,
            instance(serviceContainer),
            {
                controller,
                notebook,
                resource: notebook.uri
            },
            new DisplayOptions(false),
            disposables,
            'jupyterExtension'
        );
    });
    test('Throws an error if we fail to start the kernel', async () => {
        when(kernel.status).thenReturn('idle');
        when(kernel.start(anything())).thenThrow(new Error('Failed to Start Kernel'));
        when(errorHandler.handleKernelError(anything(), anything(), anything(), anything(), anything())).thenResolve(
            KernelInterpreterDependencyResponse.failed
        );
        const result = KernelConnector.connectToNotebookKernel(
            pythonConnection,
            instance(serviceContainer),
            {
                controller,
                notebook,
                resource: notebook.uri
            },
            new DisplayOptions(false),
            disposables,
            'jupyterExtension'
        );

        await assert.isRejected(result, 'Failed to Start Kernel');
    });
    test('Display modal dialog for dead kernel and verify kernel is restart when the kernel is dead (user choses to restart)', async () => {
        when(kernel.status).thenReturn('dead');
        when(kernel.restart()).thenResolve();
        when(errorHandler.handleKernelError(anything(), anything(), anything(), anything(), anything())).thenResolve(
            KernelInterpreterDependencyResponse.failed
        );
        when(appShell.showErrorMessage(anything(), anything(), anything(), anything())).thenReturn(
            Promise.resolve(DataScience.restartKernel)
        );
        await KernelConnector.connectToNotebookKernel(
            pythonConnection,
            instance(serviceContainer),
            {
                controller,
                notebook,
                resource: notebook.uri
            },
            new DisplayOptions(false),
            disposables,
            'jupyterExtension'
        );

        verify(kernel.restart()).once();
        verify(
            appShell.showErrorMessage(
                DataScience.cannotRunCellKernelIsDead(getDisplayNameOrNameOfKernelConnection(pythonKernelSpec)),
                deepEqual({ modal: true }),
                anything(),
                anything()
            )
        ).once();
    });
    test('Display modal dialog for dead kernel and verify kernel is not restarted when the kernel is dead (user does not restart)', async () => {
        when(kernel.status).thenReturn('dead');
        when(kernel.restart()).thenResolve();
        when(errorHandler.handleKernelError(anything(), anything(), anything(), anything(), anything())).thenResolve(
            KernelInterpreterDependencyResponse.failed
        );
        when(appShell.showErrorMessage(anything(), anything(), anything(), anything())).thenResolve();
        const result = KernelConnector.connectToNotebookKernel(
            pythonConnection,
            instance(serviceContainer),
            {
                controller,
                notebook,
                resource: notebook.uri
            },
            new DisplayOptions(false),
            disposables,
            'jupyterExtension'
        );

        await assert.isRejected(result, new KernelDeadError(pythonKernelSpec).message);
        verify(kernel.restart()).never();
        verify(
            appShell.showErrorMessage(
                DataScience.cannotRunCellKernelIsDead(getDisplayNameOrNameOfKernelConnection(pythonKernelSpec)),
                deepEqual({ modal: true }),
                anything(),
                anything()
            )
        ).once();
    });
});
