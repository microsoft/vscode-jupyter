// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EventEmitter, NotebookController, NotebookDocument, NotebookExecution } from 'vscode';
import { IKernel, KernelConnectionMetadata } from '../../kernels/types';
import { dispose } from '../../platform/common/helpers';
import { IDisposable } from '../../platform/common/types';
import { RemoteKernelReconnectBusyIndicator } from './remoteKernelReconnectBusyIndicator';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { mockedVSCodeNamespaces } from '../../test/vscode-mock';
import { Status } from '@jupyterlab/services/lib/kernel/kernel';

suite('Remote Kernel Reconnect Busy Indicator', () => {
    let indicator: RemoteKernelReconnectBusyIndicator;
    const disposables: IDisposable[] = [];
    let kernel: IKernel;
    let controller: NotebookController;
    let kernelConnectionMetadata: KernelConnectionMetadata;
    let notebook: NotebookDocument;
    let onDidCloseNotebookDocument: EventEmitter<NotebookDocument>;
    let onStatusChanged: EventEmitter<Status>;
    let onDidChangeSelectedNotebooks: EventEmitter<{
        readonly notebook: NotebookDocument;
        readonly selected: boolean;
    }>;
    let execution: NotebookExecution;
    setup(() => {
        onDidCloseNotebookDocument = new EventEmitter<NotebookDocument>();
        notebook = mock<NotebookDocument>();
        kernelConnectionMetadata = mock<KernelConnectionMetadata>();
        kernel = mock<IKernel>();
        execution = mock<NotebookExecution>();
        controller = mock<NotebookController>();
        onStatusChanged = new EventEmitter<Status>();
        when(kernel.onStatusChanged).thenReturn(onStatusChanged.event);
        when(kernel.kernelConnectionMetadata).thenReturn(instance(kernelConnectionMetadata));
        onDidChangeSelectedNotebooks = new EventEmitter<{
            readonly notebook: NotebookDocument;
            readonly selected: boolean;
        }>();
        when(mockedVSCodeNamespaces.workspace.onDidCloseNotebookDocument).thenReturn(onDidCloseNotebookDocument.event);
        when(controller.onDidChangeSelectedNotebooks).thenReturn(onDidChangeSelectedNotebooks.event);
        when(controller.createNotebookExecution(anything())).thenReturn(instance(execution));

        indicator = new RemoteKernelReconnectBusyIndicator(instance(kernel), instance(controller), instance(notebook));
    });
    teardown(() => {
        dispose(disposables);
    });

    test('Not busy for Local Kernel Specs', async () => {
        when(kernel.status).thenReturn('busy');
        when(kernelConnectionMetadata.kind).thenReturn('startUsingLocalKernelSpec');

        indicator.initialize();

        verify(controller.createNotebookExecution(anything())).never();
    });
    test('Not busy for Local Python Envs', async () => {
        when(kernelConnectionMetadata.kind).thenReturn('startUsingPythonInterpreter');

        indicator.initialize();

        verify(controller.createNotebookExecution(anything())).never();
    });
    test('Not busy for Local Remote Kernel Specs', async () => {
        when(kernelConnectionMetadata.kind).thenReturn('startUsingRemoteKernelSpec');

        indicator.initialize();

        verify(controller.createNotebookExecution(anything())).never();
    });
    test('Not busy for Live Remote Kernel', async () => {
        when(kernel.status).thenReturn('idle');
        when(kernelConnectionMetadata.kind).thenReturn('connectToLiveRemoteKernel');

        indicator.initialize();

        verify(controller.createNotebookExecution(anything())).never();
    });
    (['busy', 'unknown'] as Status[]).forEach((status: Status) => {
        suite(`Initial kernel status is = ${status}`, () => {
            test('Busy for Remote Kernel', async () => {
                when(kernel.status).thenReturn(status);
                when(kernelConnectionMetadata.kind).thenReturn('connectToLiveRemoteKernel');

                indicator.initialize();

                verify(controller.createNotebookExecution(anything())).once();
                verify(execution.start()).once();
            });
            test('Dispose indicator when notebook is closed', async () => {
                when(kernel.status).thenReturn(status);
                when(kernelConnectionMetadata.kind).thenReturn('connectToLiveRemoteKernel');

                indicator.initialize();

                verify(controller.createNotebookExecution(anything())).once();
                verify(execution.start()).once();

                onDidCloseNotebookDocument.fire(instance(notebook));

                verify(execution.end()).once();
            });
            test('Do not dispose indicator when some random notebook is closed', async () => {
                when(kernel.status).thenReturn(status);
                when(kernelConnectionMetadata.kind).thenReturn('connectToLiveRemoteKernel');

                indicator.initialize();

                verify(controller.createNotebookExecution(anything())).once();
                verify(execution.start()).once();

                onDidCloseNotebookDocument.fire(instance(mock<NotebookDocument>()));

                verify(execution.end()).never();
            });
            test('Dispose indicator when controller is unselected', async () => {
                when(kernel.status).thenReturn(status);
                when(kernelConnectionMetadata.kind).thenReturn('connectToLiveRemoteKernel');

                indicator.initialize();

                verify(controller.createNotebookExecution(anything())).once();
                verify(execution.start()).once();

                onDidChangeSelectedNotebooks.fire({ notebook: instance(notebook), selected: false });

                verify(execution.end()).once();
            });
            test('Do not dispose indicator when a kernel is selected again for the same notebook', async () => {
                when(kernel.status).thenReturn(status);
                when(kernelConnectionMetadata.kind).thenReturn('connectToLiveRemoteKernel');

                indicator.initialize();

                verify(controller.createNotebookExecution(anything())).once();
                verify(execution.start()).once();

                onDidChangeSelectedNotebooks.fire({ notebook: instance(notebook), selected: true });

                verify(execution.end()).never();
            });
            (['autorestarting', 'dead', 'dead', 'idle', 'restarting', 'starting', 'terminating'] as Status[]).forEach(
                (validStatus: Status) => {
                    test(`Dispose indicator if jupyter kernel status changes to a valid status = ${validStatus}`, async () => {
                        when(kernel.status).thenReturn(status);
                        when(kernelConnectionMetadata.kind).thenReturn('connectToLiveRemoteKernel');

                        indicator.initialize();

                        verify(controller.createNotebookExecution(anything())).once();
                        verify(execution.start()).once();

                        onStatusChanged.fire(validStatus);

                        verify(execution.end()).once();
                    });
                }
            );
        });
    });
});
