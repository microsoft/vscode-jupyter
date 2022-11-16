// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { anything, instance, mock, reset, verify, when } from 'ts-mockito';
import { EventEmitter, NotebookControllerDetectionTask } from 'vscode';
import { disposeAllDisposables } from '../platform/common/helpers';
import { IDisposable } from '../platform/common/types';
import { KernelRefreshIndicator } from './kernelRefreshIndicator.web';
import { IKernelFinder } from './types';
import { mockedVSCodeNamespaces } from '../test/vscode-mock';

suite('Kernel Refresh Indicator (web)', () => {
    let indicator: KernelRefreshIndicator;
    const disposables: IDisposable[] = [];
    let kernelFinder: IKernelFinder;
    let onDidChangeStatus: EventEmitter<void>;
    let task: NotebookControllerDetectionTask;
    setup(() => {
        kernelFinder = mock<IKernelFinder>();
        onDidChangeStatus = new EventEmitter<void>();
        when(kernelFinder.status).thenReturn('idle');
        when(kernelFinder.onDidChangeStatus).thenReturn(onDidChangeStatus.event);
        task = mock<NotebookControllerDetectionTask>();
        when(mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(anything())).thenReturn(
            instance(task)
        );
        indicator = new KernelRefreshIndicator(disposables, instance(kernelFinder));
        disposables.push(indicator);
        disposables.push(onDidChangeStatus);
    });
    teardown(() => {
        reset(mockedVSCodeNamespaces.notebooks);
        disposeAllDisposables(disposables);
    });
    test('No Progress when finder is idle', async () => {
        when(kernelFinder.status).thenReturn('idle');

        indicator.activate();

        verify(mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(anything())).never();
    });
    test('Progress when finder is initially discovering', async () => {
        when(kernelFinder.status).thenReturn('discovering');

        indicator.activate();

        verify(mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(anything())).once();
        verify(task.dispose()).never();

        // Ensure task stops once finder is idle.
        when(kernelFinder.status).thenReturn('idle');
        onDidChangeStatus.fire();

        verify(task.dispose()).once();
    });
    test('Progress when finder is initially idle then starts discovering', async () => {
        when(kernelFinder.status).thenReturn('idle');

        indicator.activate();
        onDidChangeStatus.fire(); // This should have no effect.
        onDidChangeStatus.fire(); // This should have no effect.

        verify(mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(anything())).never();
        verify(task.dispose()).never();

        // Now start discovering.
        when(kernelFinder.status).thenReturn('discovering');
        onDidChangeStatus.fire();

        verify(mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(anything())).once();
        verify(task.dispose()).never();

        // Ensure task stops once finder is idle.
        when(kernelFinder.status).thenReturn('idle');
        onDidChangeStatus.fire();

        verify(task.dispose()).once();
    });
});
