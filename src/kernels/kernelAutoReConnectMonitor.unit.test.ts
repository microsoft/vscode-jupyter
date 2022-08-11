// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as fakeTimers from '@sinonjs/fake-timers';
import { IDisposable } from '../platform/common/types';
import { disposeAllDisposables } from '../platform/common/helpers';
import { IApplicationShell } from '../platform/common/application/types';
import { IKernel, IKernelConnectionSession, IKernelProvider, RemoteKernelConnectionMetadata } from './types';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { Disposable, EventEmitter, NotebookCell, Uri } from 'vscode';
import { Signal } from '@lumino/signaling';
import type { Kernel } from '@jupyterlab/services';
import { KernelAutoReconnectMonitor } from './kernelAutoReConnectMonitor';

suite('Kernel ReConnect Progress Message', () => {
    const disposables: IDisposable[] = [];
    let monitor: KernelAutoReconnectMonitor;
    let appShell: IApplicationShell;
    let kernelProvider: IKernelProvider;
    let onDidStartKernel: EventEmitter<IKernel>;
    let onDidDisposeKernel: EventEmitter<IKernel>;
    let onDidRestartKernel: EventEmitter<IKernel>;
    let clock: fakeTimers.InstalledClock;
    setup(() => {
        onDidStartKernel = new EventEmitter<IKernel>();
        onDidDisposeKernel = new EventEmitter<IKernel>();
        onDidRestartKernel = new EventEmitter<IKernel>();

        disposables.push(...[onDidStartKernel, onDidDisposeKernel, onDidRestartKernel]);
        appShell = mock<IApplicationShell>();
        when(appShell.withProgress(anything(), anything())).thenResolve();
        kernelProvider = mock<IKernelProvider>();
        when(kernelProvider.onDidStartKernel).thenReturn(onDidStartKernel.event);
        when(kernelProvider.onDidDisposeKernel).thenReturn(onDidDisposeKernel.event);
        when(kernelProvider.onDidRestartKernel).thenReturn(onDidRestartKernel.event);
        clock = fakeTimers.install();

        disposables.push(new Disposable(() => clock.uninstall()));
        monitor = new KernelAutoReconnectMonitor(instance(appShell), disposables, instance(kernelProvider));
        monitor.activate();
    });
    teardown(() => disposeAllDisposables(disposables));
    function createKernel() {
        const kernel = mock<IKernel>();
        const onPreExecute = new EventEmitter<NotebookCell>();
        const onRestarted = new EventEmitter<void>();
        disposables.push(onPreExecute);
        disposables.push(onRestarted);
        const session = mock<IKernelConnectionSession>();
        const kernelConnection = mock<Kernel.IKernelConnection>();
        const kernelConnectionStatusSignal = new Signal<Kernel.IKernelConnection, Kernel.ConnectionStatus>(
            instance(kernelConnection)
        );
        const connectionMetadata: RemoteKernelConnectionMetadata = {
            baseUrl: '<baseUrl>',
            id: '1234',
            kernelSpec: { name: 'python', display_name: 'Python', argv: [], executable: '' },
            kind: 'startUsingRemoteKernelSpec',
            serverId: '1234'
        };
        when(kernelConnection.connectionStatusChanged).thenReturn(kernelConnectionStatusSignal);
        when(kernel.session).thenReturn(instance(session));
        when(kernel.resourceUri).thenReturn(Uri.file('test.ipynb'));
        when(session.kernel).thenReturn(instance(kernelConnection));
        when(kernel.kernelConnectionMetadata).thenReturn(connectionMetadata);
        when(kernel.onPreExecute).thenReturn(onPreExecute.event);
        when(kernel.onRestarted).thenReturn(onRestarted.event);
        when(kernel.dispose()).thenResolve();
        let onWillRestart: (e: 'willRestart') => Promise<void> = () => Promise.resolve();
        when(kernel.addEventHook(anything())).thenCall((cb) => (onWillRestart = cb));
        return { kernel, onRestarted, kernelConnectionStatusSignal, onWillRestart: () => onWillRestart('willRestart') };
    }
    test('Display message when kernel is re-connecting', async () => {
        const kernel = createKernel();

        onDidStartKernel.fire(instance(kernel.kernel));

        // Send the kernel into connecting state & then disconnected.
        kernel.kernelConnectionStatusSignal.emit('connecting');
        kernel.kernelConnectionStatusSignal.emit('disconnected');
        await clock.runAllAsync();

        verify(appShell.withProgress(anything(), anything())).once();
    });
    test('Do not display a message if kernel is restarting', async () => {
        const kernel = createKernel();

        onDidStartKernel.fire(instance(kernel.kernel));

        // Send the kernel into connecting state & then disconnected.
        await kernel.onWillRestart();
        kernel.kernelConnectionStatusSignal.emit('connecting');
        kernel.kernelConnectionStatusSignal.emit('disconnected');
        onDidRestartKernel.fire(instance(kernel.kernel));

        await clock.runAllAsync();

        verify(appShell.withProgress(anything(), anything())).never();
    });
});
