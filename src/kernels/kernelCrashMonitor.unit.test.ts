// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fakeTimers from '@sinonjs/fake-timers';
import { KernelMessage } from '@jupyterlab/services';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { Disposable, EventEmitter, NotebookCell } from 'vscode';
import { dispose } from '../platform/common/utils/lifecycle';
import { IDisposable } from '../platform/common/types';
import { createKernelController, TestNotebookDocument } from '../test/datascience/notebook/executionHelper';
import { KernelCrashMonitor } from './kernelCrashMonitor';
import {
    IKernel,
    IKernelSession,
    IKernelController,
    IKernelProvider,
    INotebookKernelExecution,
    LocalKernelSpecConnectionMetadata,
    RemoteKernelSpecConnectionMetadata
} from './types';
import { assert } from 'chai';
import { DataScience } from '../platform/common/utils/localize';
import { createOutputWithErrorMessageForDisplay } from '../platform/errors/errorUtils';
import { getDisplayNameOrNameOfKernelConnection } from './helpers';
import { mockedVSCodeNamespaces } from '../test/vscode-mock';

suite('Kernel Crash Monitor', () => {
    let kernelProvider: IKernelProvider;
    let disposables: IDisposable[] = [];
    let kernel: IKernel;
    let kernelCrashMonitor: KernelCrashMonitor;
    let onKernelStatusChanged: EventEmitter<{
        status: KernelMessage.Status;
        kernel: IKernel;
    }>;
    let onDidStartKernel: EventEmitter<IKernel>;
    let kernelExecution: INotebookKernelExecution;
    let onPreExecute: EventEmitter<NotebookCell>;
    let cell: NotebookCell;
    let kernelSession: IKernelSession;
    let notebook: TestNotebookDocument;
    let controller: IKernelController;
    let clock: fakeTimers.InstalledClock;
    const serverProviderHandle = { handle: 'handle', id: 'id', extensionId: '' };
    let remoteKernelSpec = RemoteKernelSpecConnectionMetadata.create({
        id: 'remote',
        baseUrl: '1',
        kernelSpec: {
            argv: [],
            display_name: 'remote',
            executable: '',
            name: 'remote'
        },
        serverProviderHandle
    });
    let localKernelSpec = LocalKernelSpecConnectionMetadata.create({
        id: 'local',
        kernelSpec: {
            argv: [],
            display_name: 'remote',
            executable: '',
            name: 'remote'
        }
    });
    setup(async () => {
        kernelProvider = mock<IKernelProvider>();
        kernel = mock<IKernel>();
        kernelExecution = mock<INotebookKernelExecution>();
        kernelSession = mock<IKernelSession>();
        onKernelStatusChanged = new EventEmitter<{
            status: KernelMessage.Status;
            kernel: IKernel;
        }>();
        onDidStartKernel = new EventEmitter<IKernel>();
        onPreExecute = new EventEmitter<NotebookCell>();
        notebook = new TestNotebookDocument();
        cell = await notebook.appendCodeCell('1234');
        controller = createKernelController('1');
        disposables.push(onDidStartKernel);
        disposables.push(onKernelStatusChanged);
        disposables.push(onPreExecute);
        when(kernel.dispose()).thenResolve();
        when(kernel.disposed).thenReturn(false);
        when(kernel.controller).thenReturn(controller);
        when(kernel.disposing).thenReturn(false);
        when(kernel.session).thenReturn(instance(kernelSession));
        when(kernelSession.kind).thenReturn('localRaw');
        when(mockedVSCodeNamespaces.window.showErrorMessage(anything())).thenResolve();

        when(kernelProvider.onDidStartKernel).thenReturn(onDidStartKernel.event);
        when(kernelProvider.onKernelStatusChanged).thenReturn(onKernelStatusChanged.event);
        when(kernelProvider.getOrCreate(anything(), anything())).thenReturn(instance(kernel));
        when(kernelProvider.getKernelExecution(anything())).thenReturn(instance(kernelExecution));
        when(kernelExecution.onPreExecute).thenReturn(onPreExecute.event);

        kernelCrashMonitor = new KernelCrashMonitor(disposables, instance(kernelProvider));
        clock = fakeTimers.install();
        disposables.push(new Disposable(() => clock.uninstall()));
    });
    teardown(() => (disposables = dispose(disposables)));

    test('Error message displayed and Cell output updated with error message (raw kernel)', async () => {
        when(kernelSession.kind).thenReturn('localRaw');
        when(kernel.kernelConnectionMetadata).thenReturn(localKernelSpec);
        // Ensure we have a kernel and have started a cell.
        kernelCrashMonitor.activate();
        onDidStartKernel.fire(instance(kernel));
        onPreExecute.fire(cell);
        const execution = controller.createNotebookCellExecution(cell);
        execution.start();

        const expectedErrorMessage = Buffer.from(
            createOutputWithErrorMessageForDisplay(DataScience.kernelCrashedDueToCodeInCurrentOrPreviousCell)?.items[0]!
                .data!
        ).toString();

        when(kernel.status).thenReturn('dead');
        onKernelStatusChanged.fire({ status: 'dead', kernel: instance(kernel) });
        await clock.runAllAsync();

        verify(
            mockedVSCodeNamespaces.window.showErrorMessage(
                DataScience.kernelDiedWithoutError(getDisplayNameOrNameOfKernelConnection(localKernelSpec))
            )
        ).once();

        assert.strictEqual(cell.outputs.length, 1);
        assert.strictEqual(cell.outputs[0].items.length, 1);
        const outputItem = cell.outputs[0].items[0];
        assert.include(Buffer.from(outputItem.data).toString(), expectedErrorMessage);
    });
    test('Error message displayed and Cell output updated with error message (jupyter kernel)', async () => {
        when(kernelSession.kind).thenReturn('localJupyter');
        when(kernel.kernelConnectionMetadata).thenReturn(remoteKernelSpec);
        // Ensure we have a kernel and have started a cell.
        kernelCrashMonitor.activate();
        onDidStartKernel.fire(instance(kernel));
        onPreExecute.fire(cell);
        const execution = controller.createNotebookCellExecution(cell);
        execution.start();

        const expectedErrorMessage = Buffer.from(
            createOutputWithErrorMessageForDisplay(DataScience.kernelCrashedDueToCodeInCurrentOrPreviousCell)?.items[0]!
                .data!
        ).toString();

        when(kernel.status).thenReturn('autorestarting');
        when(kernelSession.status).thenReturn('autorestarting');
        onKernelStatusChanged.fire({ status: 'dead', kernel: instance(kernel) });
        await clock.runAllAsync();

        verify(
            mockedVSCodeNamespaces.window.showErrorMessage(
                DataScience.kernelDiedWithoutErrorAndAutoRestarting(
                    getDisplayNameOrNameOfKernelConnection(remoteKernelSpec)
                )
            )
        ).once();

        assert.strictEqual(cell.outputs.length, 1);
        assert.strictEqual(cell.outputs[0].items.length, 1);
        const outputItem = cell.outputs[0].items[0];
        assert.include(Buffer.from(outputItem.data).toString(), expectedErrorMessage);
    });
});
