// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fakeTimers from '@sinonjs/fake-timers';
import { anything, instance, mock, reset, verify, when } from 'ts-mockito';
import { Disposable, EventEmitter, NotebookControllerDetectionTask, NotebookDocument, NotebookEditor } from 'vscode';
import { dispose } from '../platform/common/helpers';
import { IDisposable } from '../platform/common/types';
import { KernelRefreshIndicator } from './kernelRefreshIndicator.node';
import { IKernelFinder } from './types';
import { mockedVSCodeNamespaces } from '../test/vscode-mock';
import { IPythonExtensionChecker } from '../platform/api/types';
import { IInterpreterService } from '../platform/interpreter/contracts';
import { createDeferred } from '../platform/common/utils/async';
import { InteractiveWindowView, JupyterNotebookView } from '../platform/common/constants';

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
        when(mockedVSCodeNamespaces.window.activeNotebookEditor).thenReturn(undefined);
        taskNb = mock<NotebookControllerDetectionTask>();
        taskIW = mock<NotebookControllerDetectionTask>();
        when(mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(JupyterNotebookView)).thenReturn(
            instance(taskNb)
        );
        when(mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(InteractiveWindowView)).thenReturn(
            instance(taskIW)
        );
        indicator = new KernelRefreshIndicator(
            disposables,
            instance(extensionChecker),
            instance(interpreterService),
            instance(kernelFinder)
        );
        clock = fakeTimers.install();
        disposables.push(new Disposable(() => clock.uninstall()));
        disposables.push(indicator);
        disposables.push(onPythonExtensionInstallationStatusChanged);
    });
    teardown(() => {
        reset(mockedVSCodeNamespaces.notebooks);
        dispose(disposables);
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
        test('Progress is not displayed when finder is idle', async () => {
            when(kernelFinder.status).thenReturn('idle');
            const deferred = createDeferred<void>();
            when(interpreterService.status).thenReturn('idle');

            indicator.activate();
            await clock.runAllAsync();

            verify(mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(JupyterNotebookView)).never();
            verify(
                mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(InteractiveWindowView)
            ).never();
            verify(taskNb.dispose()).never();
            verify(taskIW.dispose()).never();

            // End refresh and task should stop.
            deferred.resolve();
            await clock.runAllAsync();

            verify(taskNb.dispose()).never();
            verify(taskIW.dispose()).never();
            verify(interpreterService.refreshInterpreters()).never();
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

            verify(taskNb.dispose()).once();
            verify(taskIW.dispose()).once();

            // End refresh and task should stop.
            deferred.resolve();
            await clock.runAllAsync();

            verify(taskNb.dispose()).once();
            verify(taskIW.dispose()).once();
            verify(interpreterService.refreshInterpreters()).never();
        });
        test('Progress when finder is initially idle then starts discovering', async () => {
            when(kernelFinder.status).thenReturn('idle');
            const deferred = createDeferred<void>();
            when(interpreterService.status).thenReturn('idle');

            indicator.activate();
            onDidChangeStatus.fire(); // This should have no effect.
            onDidChangeStatus.fire(); // This should have no effect.
            await clock.runAllAsync();

            verify(mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(JupyterNotebookView)).never();
            verify(
                mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(InteractiveWindowView)
            ).never();
            verify(taskNb.dispose()).never();
            verify(taskIW.dispose()).never();

            // Now start discovering.
            when(kernelFinder.status).thenReturn('discovering');
            onDidChangeStatus.fire();
            await clock.runAllAsync();

            verify(mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(JupyterNotebookView)).once();
            verify(
                mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(InteractiveWindowView)
            ).once();
            verify(taskNb.dispose()).never();
            verify(taskIW.dispose()).never();

            // End refresh, task should keep going as finder is still busy.
            deferred.resolve();
            await clock.runAllAsync();

            // Ensure task stops once finder is idle.
            when(kernelFinder.status).thenReturn('idle');
            onDidChangeStatus.fire();
            await clock.runAllAsync();

            verify(taskNb.dispose()).once();
            verify(taskIW.dispose()).once();
            verify(interpreterService.refreshInterpreters()).never();

            // Now start discovering once again.
            when(kernelFinder.status).thenReturn('discovering');
            onDidChangeStatus.fire();
            await clock.runAllAsync();

            verify(mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(JupyterNotebookView)).twice();
            verify(
                mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(InteractiveWindowView)
            ).twice();
            verify(taskNb.dispose()).once();
            verify(taskIW.dispose()).once();

            // End refresh, task should keep going as finder is still busy.
            deferred.resolve();
            await clock.runAllAsync();

            // Ensure task stops once finder is idle.
            when(kernelFinder.status).thenReturn('idle');
            onDidChangeStatus.fire();
            await clock.runAllAsync();

            verify(taskNb.dispose()).twice();
            verify(taskIW.dispose()).twice();
            verify(interpreterService.refreshInterpreters()).never();
        });
        test('Progress when finder is initially discovering', async () => {
            when(kernelFinder.status).thenReturn('discovering');
            const deferred = createDeferred<void>();
            when(interpreterService.status).thenReturn('refreshing');

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

            // End refresh, task should keep going as finder is still busy.
            deferred.resolve();
            await clock.runAllAsync();

            // Ensure task stops once finder is idle.
            when(kernelFinder.status).thenReturn('idle');
            onDidChangeStatus.fire();
            await clock.runAllAsync();

            verify(taskNb.dispose()).once();
            verify(taskIW.dispose()).once();
            verify(interpreterService.refreshInterpreters()).never();

            // Now start discovering once again.
            when(kernelFinder.status).thenReturn('discovering');
            onDidChangeStatus.fire();
            await clock.runAllAsync();

            verify(mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(JupyterNotebookView)).twice();
            verify(
                mockedVSCodeNamespaces.notebooks.createNotebookControllerDetectionTask(InteractiveWindowView)
            ).twice();
            verify(taskNb.dispose()).once();
            verify(taskIW.dispose()).once();

            // End refresh, task should keep going as finder is still busy.
            deferred.resolve();
            await clock.runAllAsync();

            // Ensure task stops once finder is idle.
            when(kernelFinder.status).thenReturn('idle');
            onDidChangeStatus.fire();
            await clock.runAllAsync();

            verify(taskNb.dispose()).twice();
            verify(taskIW.dispose()).twice();
            verify(interpreterService.refreshInterpreters()).never();
        });
        test('Refresh interpreters when a Notebook is opened', async () => {
            const onDidOpenNotebookDocument = new EventEmitter<NotebookDocument>();
            const onDidChangeActiveNotebookEditor = new EventEmitter<NotebookEditor>();
            disposables.push(onDidOpenNotebookDocument);
            disposables.push(onDidChangeActiveNotebookEditor);
            when(kernelFinder.status).thenReturn('idle');
            when(interpreterService.status).thenReturn('idle');
            when(interpreterService.refreshInterpreters()).thenResolve();
            when(interpreterService.refreshInterpreters(anything())).thenResolve();
            when(mockedVSCodeNamespaces.workspace.onDidOpenNotebookDocument).thenReturn(
                onDidOpenNotebookDocument.event
            );
            when(mockedVSCodeNamespaces.window.onDidChangeActiveNotebookEditor).thenReturn(
                onDidChangeActiveNotebookEditor.event
            );

            indicator.activate();
            onDidChangeStatus.fire(); // This should have no effect.
            onDidChangeStatus.fire(); // This should have no effect.
            await clock.runAllAsync();

            verify(interpreterService.refreshInterpreters()).never();

            const nb = mock<NotebookDocument>();
            when(nb.notebookType).thenReturn(JupyterNotebookView);
            const nb2 = mock<NotebookDocument>();
            when(nb2.notebookType).thenReturn(JupyterNotebookView);
            onDidOpenNotebookDocument.fire(instance(nb));
            onDidOpenNotebookDocument.fire(instance(nb));
            onDidOpenNotebookDocument.fire(instance(nb2));

            verify(interpreterService.refreshInterpreters()).once();
        });
        test('Do not Refresh interpreters when a non-Jupyter Notebook is opened', async () => {
            const onDidOpenNotebookDocument = new EventEmitter<NotebookDocument>();
            const onDidChangeActiveNotebookEditor = new EventEmitter<NotebookEditor>();
            disposables.push(onDidOpenNotebookDocument);
            disposables.push(onDidChangeActiveNotebookEditor);
            when(kernelFinder.status).thenReturn('idle');
            when(interpreterService.status).thenReturn('idle');
            when(interpreterService.refreshInterpreters()).thenResolve();
            when(interpreterService.refreshInterpreters(anything())).thenResolve();
            when(mockedVSCodeNamespaces.workspace.onDidOpenNotebookDocument).thenReturn(
                onDidOpenNotebookDocument.event
            );
            when(mockedVSCodeNamespaces.window.onDidChangeActiveNotebookEditor).thenReturn(
                onDidChangeActiveNotebookEditor.event
            );

            indicator.activate();
            onDidChangeStatus.fire(); // This should have no effect.
            onDidChangeStatus.fire(); // This should have no effect.
            await clock.runAllAsync();

            verify(interpreterService.refreshInterpreters()).never();

            const nb = mock<NotebookDocument>();
            when(nb.notebookType).thenReturn('abc');
            const nb2 = mock<NotebookDocument>();
            when(nb2.notebookType).thenReturn('hello');
            const editor = mock<NotebookEditor>();
            when(editor.notebook).thenReturn(instance(nb));
            onDidOpenNotebookDocument.fire(instance(nb));
            onDidOpenNotebookDocument.fire(instance(nb));
            onDidOpenNotebookDocument.fire(instance(nb2));
            onDidChangeActiveNotebookEditor.fire(instance(editor));

            verify(interpreterService.refreshInterpreters()).never();
        });
    });
});
