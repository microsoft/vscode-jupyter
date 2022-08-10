// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { KernelMessage } from '@jupyterlab/services';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { EventEmitter } from 'vscode';
import { getDisplayNameOrNameOfKernelConnection } from '../../kernels/helpers';
import { KernelAutoRestartMonitor } from '../../kernels/kernelAutoRestartMonitor.node';
import { IKernel, IKernelConnectionSession, IKernelProvider, KernelConnectionMetadata } from '../../kernels/types';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { IDisposable } from '../../platform/common/types';
import { DataScience } from '../../platform/common/utils/localize';
import { IStatusProvider } from '../../platform/progress/types';

suite('Jupyter Execution', async () => {
    let statusProvider: IStatusProvider;
    let kernelProvider: IKernelProvider;
    let restartMonitor: KernelAutoRestartMonitor;
    let onKernelStatusChanged = new EventEmitter<{ status: KernelMessage.Status; kernel: IKernel }>();
    let onDidStartKernel = new EventEmitter<IKernel>();
    let onDidReStartKernel = new EventEmitter<IKernel>();
    let onDidDisposeKernel = new EventEmitter<IKernel>();
    const disposables: IDisposable[] = [];
    const connectionMetadata: KernelConnectionMetadata = {
        id: '123',
        kernelSpec: {
            argv: [],
            display_name: 'Hello',
            name: 'hello',
            executable: 'path'
        },
        kind: 'startUsingLocalKernelSpec'
    };
    setup(() => {
        statusProvider = mock<IStatusProvider>();
        kernelProvider = mock<IKernelProvider>();
        when(kernelProvider.onDidRestartKernel).thenReturn(onDidReStartKernel.event);
        when(kernelProvider.onDidStartKernel).thenReturn(onDidStartKernel.event);
        when(kernelProvider.onDidDisposeKernel).thenReturn(onDidDisposeKernel.event);
        when(kernelProvider.onKernelStatusChanged).thenReturn(onKernelStatusChanged.event);
        restartMonitor = new KernelAutoRestartMonitor(instance(statusProvider), disposables, instance(kernelProvider));
    });
    teardown(() => {
        disposeAllDisposables(disposables);
    });
    suiteTeardown(() => {
        onKernelStatusChanged.dispose();
        onDidStartKernel.dispose();
        onDidReStartKernel.dispose();
        onDidDisposeKernel.dispose();
    });
    test('Do not display progress indicator for local raw kernel', async () => {
        verifyProgressDisplay('localRaw');
    });
    test('Display progress indicator for remote Jupyter kernel', async () => {
        verifyProgressDisplay('remoteJupyter');
    });
    test('Display progress indicator for local Jupyter kernel', async () => {
        verifyProgressDisplay('localJupyter');
    });
    function verifyProgressDisplay(sessionType: 'remoteJupyter' | 'localJupyter' | 'localRaw') {
        restartMonitor.activate();

        const expectedMessage = DataScience.restartingKernelStatus().format(
            getDisplayNameOrNameOfKernelConnection(connectionMetadata)
        );

        const kernel = mock<IKernel>();
        const session = mock<IKernelConnectionSession>();
        const disposable = mock<IDisposable>();
        when(kernel.kernelConnectionMetadata).thenReturn(connectionMetadata);
        when(kernel.session).thenReturn(instance(session));
        when(session.kind).thenReturn(sessionType);
        when(statusProvider.set(anything())).thenReturn(instance(disposable));

        onDidStartKernel.fire(instance(kernel));
        when(kernel.status).thenReturn('autorestarting');
        onKernelStatusChanged.fire({ kernel: instance(kernel), status: 'autorestarting' });

        if (sessionType === 'localRaw') {
            verify(statusProvider.set(expectedMessage)).never();
        } else {
            verify(statusProvider.set(expectedMessage)).once();
        }
        verify(disposable.dispose()).never();

        when(kernel.status).thenReturn('busy');
        onKernelStatusChanged.fire({ kernel: instance(kernel), status: 'busy' });
        verify(disposable.dispose()).never();

        when(kernel.status).thenReturn('idle');
        onKernelStatusChanged.fire({ kernel: instance(kernel), status: 'idle' });
        if (sessionType === 'localRaw') {
            verify(disposable.dispose()).never();
        } else {
            verify(disposable.dispose()).once();
        }
    }
});
