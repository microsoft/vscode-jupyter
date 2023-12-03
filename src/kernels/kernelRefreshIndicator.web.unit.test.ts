// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { instance, mock, verify, when } from 'ts-mockito';
import { EventEmitter, Disposable, NotebookControllerDetectionTask } from 'vscode';
import { dispose } from '../platform/common/utils/lifecycle';
import { IDisposable } from '../platform/common/types';
import { KernelRefreshIndicator } from './kernelRefreshIndicator.web';
import { IKernelFinder } from './types';
import { mockedVSCodeNamespaces, resetVSCodeMocks } from '../test/vscode-mock';
import { InteractiveWindowView, JupyterNotebookView } from '../platform/common/constants';

suite('Kernel Refresh Indicator (web)', () => {
    let indicator: KernelRefreshIndicator;
    let disposables: IDisposable[] = [];
    let kernelFinder: IKernelFinder;
    let onDidChangeStatus: EventEmitter<void>;
    let taskNb: NotebookControllerDetectionTask;
    let taskIW: NotebookControllerDetectionTask;
    setup(() => {
        resetVSCodeMocks();
        disposables.push(new Disposable(() => resetVSCodeMocks()));
        kernelFinder = mock<IKernelFinder>();
        onDidChangeStatus = new EventEmitter<void>();
        when(kernelFinder.status).thenReturn('idle');
        when(kernelFinder.onDidChangeStatus).thenReturn(onDidChangeStatus.event);
        taskNb = mock<NotebookControllerDetectionTask>();
        taskIW = mock<NotebookControllerDetectionTask>();
        when(mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(JupyterNotebookView)).thenReturn(
            instance(taskNb)
        );
        when(mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(InteractiveWindowView)).thenReturn(
            instance(taskIW)
        );
        indicator = new KernelRefreshIndicator(disposables, instance(kernelFinder));
        disposables.push(indicator);
        disposables.push(onDidChangeStatus);
    });
    teardown(() => {
        // reset(mockedVSCodeNamespaces.notebooks);
        disposables = dispose(disposables);
    });
    test('No Progress when finder is idle', async () => {
        when(kernelFinder.status).thenReturn('idle');

        indicator.activate();

        verify(mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(JupyterNotebookView)).never();
        verify(mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(InteractiveWindowView)).never();
    });
    test('Progress when finder is initially discovering', async () => {
        when(kernelFinder.status).thenReturn('discovering');

        indicator.activate();

        verify(mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(JupyterNotebookView)).once();
        verify(mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(InteractiveWindowView)).once();
        verify(taskNb.dispose()).never();
        verify(taskIW.dispose()).never();

        // Ensure task stops once finder is idle.
        when(kernelFinder.status).thenReturn('idle');
        onDidChangeStatus.fire();

        verify(taskNb.dispose()).once();
        verify(taskIW.dispose()).once();
    });
    test('Progress when finder is initially idle then starts discovering', async () => {
        when(kernelFinder.status).thenReturn('idle');

        indicator.activate();
        onDidChangeStatus.fire(); // This should have no effect.
        onDidChangeStatus.fire(); // This should have no effect.

        verify(mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(JupyterNotebookView)).never();
        verify(mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(InteractiveWindowView)).never();
        verify(taskNb.dispose()).never();
        verify(taskIW.dispose()).never();

        // Now start discovering.
        when(kernelFinder.status).thenReturn('discovering');
        onDidChangeStatus.fire();

        verify(mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(JupyterNotebookView)).once();
        verify(mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(InteractiveWindowView)).once();
        verify(taskNb.dispose()).never();
        verify(taskIW.dispose()).never();

        // Ensure task stops once finder is idle.
        when(kernelFinder.status).thenReturn('idle');
        onDidChangeStatus.fire();

        verify(taskNb.dispose()).once();
        verify(taskIW.dispose()).once();
    });
});
