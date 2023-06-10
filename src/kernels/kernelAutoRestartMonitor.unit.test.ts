// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { KernelMessage } from '@jupyterlab/services';
import { instance, mock, verify, when } from 'ts-mockito';
import { assert } from 'chai';
import { EventEmitter } from 'vscode';
import { KernelAutoRestartMonitor } from './kernelAutoRestartMonitor.node';
import { IKernel, IKernelSession, IKernelProvider, LocalKernelSpecConnectionMetadata } from './types';
import { disposeAllDisposables } from '../platform/common/helpers';
import { IDisposable } from '../platform/common/types';
import { KernelProgressReporter } from '../platform/progress/kernelProgressReporter';

suite('Jupyter Execution', () => {
    let kernelProvider: IKernelProvider;
    let restartMonitor: KernelAutoRestartMonitor;
    let onKernelStatusChanged = new EventEmitter<{ status: KernelMessage.Status; kernel: IKernel }>();
    let onDidStartKernel = new EventEmitter<IKernel>();
    let onDidReStartKernel = new EventEmitter<IKernel>();
    let onDidDisposeKernel = new EventEmitter<IKernel>();
    const disposables: IDisposable[] = [];
    const connectionMetadata = LocalKernelSpecConnectionMetadata.create({
        kernelSpec: {
            argv: [],
            display_name: 'Hello',
            name: 'hello',
            executable: 'path'
        }
    });
    setup(() => {
        kernelProvider = mock<IKernelProvider>();
        when(kernelProvider.onDidRestartKernel).thenReturn(onDidReStartKernel.event);
        when(kernelProvider.onDidStartKernel).thenReturn(onDidStartKernel.event);
        when(kernelProvider.onDidDisposeKernel).thenReturn(onDidDisposeKernel.event);
        when(kernelProvider.onKernelStatusChanged).thenReturn(onKernelStatusChanged.event);
        restartMonitor = new KernelAutoRestartMonitor(disposables, instance(kernelProvider));
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

        const kernel = mock<IKernel>();
        const session = mock<IKernelSession>();
        const disposable = mock<IDisposable>();
        when(kernel.kernelConnectionMetadata).thenReturn(connectionMetadata);
        when(kernel.session).thenReturn(instance(session));
        when(session.kind).thenReturn(sessionType);
        const oldCreateProgressReporter = KernelProgressReporter.createProgressReporter;
        disposables.push({
            dispose: () => {
                KernelProgressReporter.createProgressReporter = oldCreateProgressReporter;
            }
        });
        let createProgressReporterCalled = false;
        KernelProgressReporter.createProgressReporter = () => {
            createProgressReporterCalled = true;
            return instance(disposable);
        };
        onDidStartKernel.fire(instance(kernel));
        when(kernel.status).thenReturn('autorestarting');
        onKernelStatusChanged.fire({ kernel: instance(kernel), status: 'autorestarting' });

        if (sessionType === 'localRaw') {
            assert.isFalse(createProgressReporterCalled);
        } else {
            assert.isTrue(createProgressReporterCalled);
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
            verify(disposable.dispose()).atLeast(1);
        }
    }
});
