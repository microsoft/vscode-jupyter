// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fakeTimers from '@sinonjs/fake-timers';
import { instance, mock, reset, verify, when } from 'ts-mockito';
import { Disposable, EventEmitter, NotebookControllerDetectionTask } from 'vscode';
import { disposeAllDisposables } from '../platform/common/helpers';
import { IDisposable } from '../platform/common/types';
import { KernelRefreshIndicator } from './kernelRefreshIndicator.node';
import { IKernelFinder } from './types';
import { mockedVSCodeNamespaces } from '../test/vscode-mock';
import { IPythonExtensionChecker } from '../platform/api/types';
import { IInterpreterService } from '../platform/interpreter/contracts';
import { createDeferred } from '../platform/common/utils/async';
import { InteractiveWindowView, JupyterNotebookView } from '../platform/common/constants';
import { IApplicationEnvironment } from '../platform/common/application/types';

suite('Kernel Refresh Indicator (node)', () => {
    let indicator: KernelRefreshIndicator;
    const disposables: IDisposable[] = [];
    let kernelFinder: IKernelFinder;
    let onDidChangeStatus: EventEmitter<void>;
    let taskNb: NotebookControllerDetectionTask;
    let taskIW: NotebookControllerDetectionTask;
    let extensionChecker: IPythonExtensionChecker;
    let interpreterService: IInterpreterService;
    let onPythonExtensionInstallationStatusChanged: EventEmitter<'installed' | 'uninstalled'>;
    let clock: fakeTimers.InstalledClock;
    setup(() => {
        kernelFinder = mock<IKernelFinder>();
        onDidChangeStatus = new EventEmitter<void>();
        onPythonExtensionInstallationStatusChanged = new EventEmitter<'installed' | 'uninstalled'>();
        extensionChecker = mock<IPythonExtensionChecker>();
        interpreterService = mock<IInterpreterService>();
        when(kernelFinder.status).thenReturn('idle');
        when(kernelFinder.onDidChangeStatus).thenReturn(onDidChangeStatus.event);
        when(extensionChecker.onPythonExtensionInstallationStatusChanged).thenReturn(
            onPythonExtensionInstallationStatusChanged.event
        );
        taskNb = mock<NotebookControllerDetectionTask>();
        taskIW = mock<NotebookControllerDetectionTask>();
        when(mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(JupyterNotebookView)).thenReturn(
            instance(taskNb)
        );
        when(mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(InteractiveWindowView)).thenReturn(
            instance(taskIW)
        );
        const app = mock<IApplicationEnvironment>();
        when(app.channel).thenReturn('insiders');
        indicator = new KernelRefreshIndicator(
            disposables,
            instance(extensionChecker),
            instance(interpreterService),
            instance(kernelFinder),
            instance(app)
        );
        clock = fakeTimers.install();
        disposables.push(new Disposable(() => clock.uninstall()));
        disposables.push(indicator);
        disposables.push(onPythonExtensionInstallationStatusChanged);
    });
    teardown(() => {
        reset(mockedVSCodeNamespaces.notebooks);
        disposeAllDisposables(disposables);
    });
    suite('Python extension not installed', () => {
        setup(() => {
            when(extensionChecker.isPythonExtensionInstalled).thenReturn(false);
        });
        test('No Progress when finder is idle', async () => {
            when(kernelFinder.status).thenReturn('idle');

            indicator.activate();
            await clock.runAllAsync();

            verify(mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(JupyterNotebookView)).never();
            verify(
                mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(InteractiveWindowView)
            ).never();
            verify(taskNb.dispose()).never();
            verify(taskIW.dispose()).never();
        });
        test('Progress when finder is initially discovering', async () => {
            when(kernelFinder.status).thenReturn('discovering');

            indicator.activate();

            verify(mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(JupyterNotebookView)).once();
            verify(
                mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(InteractiveWindowView)
            ).once();
            verify(taskNb.dispose()).never();
            verify(taskIW.dispose()).never();

            // Ensure task stops once finder is idle.
            when(kernelFinder.status).thenReturn('idle');
            onDidChangeStatus.fire();

            verify(taskNb.dispose()).once();
        });
        test('Progress when finder is initially idle then starts discovering', async () => {
            when(kernelFinder.status).thenReturn('idle');

            indicator.activate();
            onDidChangeStatus.fire(); // This should have no effect.
            onDidChangeStatus.fire(); // This should have no effect.

            verify(mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(JupyterNotebookView)).never();
            verify(
                mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(InteractiveWindowView)
            ).never();
            verify(taskNb.dispose()).never();
            verify(taskIW.dispose()).never();

            // Now start discovering.
            when(kernelFinder.status).thenReturn('discovering');
            onDidChangeStatus.fire();

            verify(mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(JupyterNotebookView)).once();
            verify(
                mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(InteractiveWindowView)
            ).once();
            verify(taskNb.dispose()).never();
            verify(taskIW.dispose()).never();

            // Ensure task stops once finder is idle.
            when(kernelFinder.status).thenReturn('idle');
            onDidChangeStatus.fire();

            verify(taskNb.dispose()).once();
            verify(taskIW.dispose()).once();
        });
    });
    suite('Python extension is installed', () => {
        setup(() => {
            when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
        });
        test('Progress even when finder is idle ', async () => {
            when(kernelFinder.status).thenReturn('idle');
            const deferred = createDeferred<void>();
            when(interpreterService.refreshInterpreters()).thenReturn(deferred.promise);
            when(interpreterService.status).thenReturn('idle');

            indicator.activate();
            await clock.runAllAsync();

            verify(mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(JupyterNotebookView)).once();
            verify(
                mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(InteractiveWindowView)
            ).once();
            verify(taskNb.dispose()).never();
            verify(taskIW.dispose()).never();

            // End refresh and task should stop.
            deferred.resolve();
            await clock.runAllAsync();

            verify(taskNb.dispose()).once();
            verify(taskIW.dispose()).once();
        });
        test('Progress when finder is initially discovering', async () => {
            when(kernelFinder.status).thenReturn('discovering');
            const deferred = createDeferred<void>();
            when(interpreterService.refreshInterpreters()).thenReturn(deferred.promise);
            when(interpreterService.status).thenReturn('idle');

            indicator.activate();
            await clock.runAllAsync();

            verify(mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(JupyterNotebookView)).once();
            verify(
                mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(InteractiveWindowView)
            ).once();
            verify(taskNb.dispose()).never();
            verify(taskIW.dispose()).never();

            // Even after we finish finder, the task should go on (till interpreter discovery finishes).
            when(kernelFinder.status).thenReturn('idle');
            onDidChangeStatus.fire();
            await clock.runAllAsync();

            verify(taskNb.dispose()).never();
            verify(taskIW.dispose()).never();

            // End refresh and task should stop.
            deferred.resolve();
            await clock.runAllAsync();

            verify(taskNb.dispose()).once();
            verify(taskIW.dispose()).once();
        });
        test('Progress when finder is initially idle then starts discovering', async () => {
            when(kernelFinder.status).thenReturn('idle');
            const deferred = createDeferred<void>();
            when(interpreterService.refreshInterpreters()).thenReturn(deferred.promise);
            when(interpreterService.status).thenReturn('idle');

            indicator.activate();
            onDidChangeStatus.fire(); // This should have no effect.
            onDidChangeStatus.fire(); // This should have no effect.
            await clock.runAllAsync();

            verify(mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(JupyterNotebookView)).once();
            verify(
                mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(InteractiveWindowView)
            ).once();
            verify(taskNb.dispose()).never();
            verify(taskIW.dispose()).never();

            // Now start discovering.
            when(kernelFinder.status).thenReturn('discovering');
            onDidChangeStatus.fire();
            await clock.runAllAsync();

            verify(taskNb.dispose()).never();
            verify(taskIW.dispose()).never();

            // End refresh, task should keep going as finder is still busy.
            deferred.resolve();
            await clock.runAllAsync();

            verify(taskNb.dispose()).never();
            verify(taskIW.dispose()).never();

            // Ensure task stops once finder is idle.
            when(kernelFinder.status).thenReturn('idle');
            onDidChangeStatus.fire();
            await clock.runAllAsync();

            verify(taskNb.dispose()).once();
            verify(taskIW.dispose()).once();
        });
    });
});
