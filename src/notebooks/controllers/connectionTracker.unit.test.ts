// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fakeTimers from '@sinonjs/fake-timers';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { Disposable, EventEmitter, NotebookController, NotebookControllerAffinity2, NotebookDocument } from 'vscode';
import { LocalKernelSpecConnectionMetadata } from '../../kernels/types';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { IConfigurationService, IDisposable } from '../../platform/common/types';
import { TestNotebookDocument } from '../../test/datascience/notebook/executionHelper';
import { mockedVSCodeNamespaces } from '../../test/vscode-mock';
import { ConnectionTracker } from './connectionTracker';
import { IConnectionMru, IControllerRegistration, IKernelRankingHelper, IVSCodeNotebookController } from './types';

suite('Connection Tracker', () => {
    let tracker: ConnectionTracker;
    let mru: IConnectionMru;
    const disposables: IDisposable[] = [];
    let rankingHelper: IKernelRankingHelper;
    let controllerRegistrations: IControllerRegistration;
    let notebook: NotebookDocument;
    let onDidOpenNotebookDocument: EventEmitter<NotebookDocument>;
    let onCreated: EventEmitter<IVSCodeNotebookController>;
    let clock: fakeTimers.InstalledClock;
    let controller: NotebookController;
    let ourController: IVSCodeNotebookController;
    setup(() => {
        rankingHelper = mock<IKernelRankingHelper>();
        controllerRegistrations = mock<IControllerRegistration>();
        mru = mock<IConnectionMru>();
        notebook = new TestNotebookDocument();
        onDidOpenNotebookDocument = new EventEmitter<NotebookDocument>();
        onCreated = new EventEmitter<IVSCodeNotebookController>();
        disposables.push(onDidOpenNotebookDocument);
        disposables.push(onCreated);
        controller = mock<NotebookController>();
        ourController = mock<IVSCodeNotebookController>();
        when(ourController.id).thenReturn('1');
        when(ourController.controller).thenReturn(instance(controller));
        when(mockedVSCodeNamespaces.workspace.onDidOpenNotebookDocument).thenReturn(onDidOpenNotebookDocument.event);
        when(mockedVSCodeNamespaces.workspace.notebookDocuments).thenReturn([]);
        when(controllerRegistrations.onCreated).thenReturn(onCreated.event);
        const configService = mock<IConfigurationService>();
        when(configService.getSettings(anything())).thenReturn({ kernelPickerType: 'Insiders' } as any);
        tracker = new ConnectionTracker(
            disposables,
            instance(controllerRegistrations),
            instance(rankingHelper),
            instance(mru),
            instance(configService)
        );
        tracker.activate();
        clock = fakeTimers.install();
        disposables.push(new Disposable(() => clock.uninstall()));
    });
    teardown(() => disposeAllDisposables(disposables));
    test('Update Mru upon selection of a connection', async () => {
        when(mru.add(anything(), anything())).thenResolve();
        const connection = LocalKernelSpecConnectionMetadata.create({
            id: '1',
            kernelSpec: {
                argv: [],
                display_name: '',
                language: 'python',
                name: '1',
                executable: ''
            }
        });

        await tracker.trackSelection(notebook, connection);

        verify(mru.add(notebook, connection)).once();
    });

    test('Upon creating a controller, ensure it is hidden for notebooks that do not use it', async () => {
        const connection = LocalKernelSpecConnectionMetadata.create({
            id: '1',
            kernelSpec: {
                argv: [],
                display_name: '',
                language: 'python',
                name: '1',
                executable: ''
            }
        });
        when(ourController.connection).thenReturn(connection);
        when(rankingHelper.isExactMatch(anything(), anything(), anything())).thenResolve(false);
        when(mockedVSCodeNamespaces.workspace.notebookDocuments).thenReturn([notebook]);
        when(mru.exists(notebook, connection)).thenResolve(false);
        when(controllerRegistrations.get(anything(), notebook.notebookType as any)).thenReturn(instance(ourController));

        onCreated.fire(ourController);
        await clock.runAllAsync();

        verify(mru.exists(anything(), anything())).once();
        verify(controller.updateNotebookAffinity(notebook, NotebookControllerAffinity2.Hidden)).once();
    });
    test('Upon opening a notebook, ensure controllers that are not used by this notebook are hidden', async () => {
        const connection = LocalKernelSpecConnectionMetadata.create({
            id: '1',
            kernelSpec: {
                argv: [],
                display_name: '',
                language: 'python',
                name: '1',
                executable: ''
            }
        });
        when(ourController.connection).thenReturn(connection);
        when(rankingHelper.isExactMatch(anything(), anything(), anything())).thenResolve(false);
        when(mockedVSCodeNamespaces.workspace.notebookDocuments).thenReturn([notebook]);
        when(mru.exists(notebook, connection)).thenResolve(false);
        when(controllerRegistrations.get(anything(), notebook.notebookType as any)).thenReturn(instance(ourController));
        when(controllerRegistrations.registered).thenReturn([instance(ourController)]);

        onDidOpenNotebookDocument.fire(notebook);
        await clock.runAllAsync();

        verify(mru.exists(anything(), anything())).once();
        verify(controller.updateNotebookAffinity(notebook, NotebookControllerAffinity2.Hidden)).once();
    });
    test('Upon opening a notebook, ensure controllers that are used by this notebook are displayed', async () => {
        const connection = LocalKernelSpecConnectionMetadata.create({
            id: '1',
            kernelSpec: {
                argv: [],
                display_name: '',
                language: 'python',
                name: '1',
                executable: ''
            }
        });
        when(ourController.connection).thenReturn(connection);
        when(rankingHelper.isExactMatch(anything(), anything(), anything())).thenResolve(false);
        when(mockedVSCodeNamespaces.workspace.notebookDocuments).thenReturn([notebook]);
        when(mru.exists(notebook, connection)).thenResolve(true);
        when(controllerRegistrations.get(anything(), notebook.notebookType as any)).thenReturn(instance(ourController));
        when(controllerRegistrations.registered).thenReturn([instance(ourController)]);

        onDidOpenNotebookDocument.fire(notebook);
        await clock.runAllAsync();

        verify(mru.exists(anything(), anything())).once();
        verify(controller.updateNotebookAffinity(notebook, NotebookControllerAffinity2.Default)).once();
    });
    test('Upon opening a notebook, ensure controllers that match exactly are set as preferred', async () => {
        const connection = LocalKernelSpecConnectionMetadata.create({
            id: '1',
            kernelSpec: {
                argv: [],
                display_name: '',
                language: 'python',
                name: '1',
                executable: ''
            }
        });
        when(ourController.connection).thenReturn(connection);
        when(rankingHelper.isExactMatch(anything(), anything(), anything())).thenResolve(true);
        when(mockedVSCodeNamespaces.workspace.notebookDocuments).thenReturn([notebook]);
        when(mru.exists(notebook, connection)).thenResolve(true);
        when(controllerRegistrations.get(anything(), notebook.notebookType as any)).thenReturn(instance(ourController));
        when(controllerRegistrations.registered).thenReturn([instance(ourController)]);

        onDidOpenNotebookDocument.fire(notebook);
        await clock.runAllAsync();

        verify(mru.exists(anything(), anything())).once();
        verify(controller.updateNotebookAffinity(notebook, NotebookControllerAffinity2.Preferred)).once();
    });
});
