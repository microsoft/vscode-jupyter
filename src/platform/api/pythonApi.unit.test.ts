// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fakeTimers from '@sinonjs/fake-timers';
import { assert } from 'chai';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { Disposable, EventEmitter, WorkspaceFoldersChangeEvent } from 'vscode';
import { createEventHandler } from '../../test/common';
import { IWorkspaceService } from '../common/application/types';
import { dispose } from '../common/helpers';
import { IDisposable, IExtensionContext } from '../common/types';
import { IInterpreterService } from '../interpreter/contracts';
import { InterpreterService } from './pythonApi';
import {
    ActiveEnvironmentPathChangeEvent,
    EnvironmentsChangeEvent,
    EnvironmentVariablesChangeEvent,
    PythonExtension
} from '@vscode/python-extension';
import { IPythonApiProvider, IPythonExtensionChecker } from './types';

suite(`Interpreter Service`, () => {
    let clock: fakeTimers.InstalledClock;
    let interpreterService: IInterpreterService;
    let apiProvider: IPythonApiProvider;
    let extensionChecker: IPythonExtensionChecker;
    let workspace: IWorkspaceService;
    let context: IExtensionContext;
    const disposables: IDisposable[] = [];
    let onDidActivatePythonExtension: EventEmitter<void>;
    let onDidChangeWorkspaceFolders: EventEmitter<WorkspaceFoldersChangeEvent>;
    let onDidChangeActiveEnvironmentPath: EventEmitter<ActiveEnvironmentPathChangeEvent>;
    let onDidChangeEnvironments: EventEmitter<EnvironmentsChangeEvent>;
    let onDidEnvironmentVariablesChange: EventEmitter<EnvironmentVariablesChangeEvent>;
    let newPythonApi: PythonExtension;
    let environments: PythonExtension['environments'];
    setup(() => {
        interpreterService = mock<IInterpreterService>();
        apiProvider = mock<IPythonApiProvider>();
        extensionChecker = mock<IPythonExtensionChecker>();
        workspace = mock<IWorkspaceService>();
        context = mock<IExtensionContext>();
        onDidActivatePythonExtension = new EventEmitter<void>();
        onDidChangeWorkspaceFolders = new EventEmitter<WorkspaceFoldersChangeEvent>();
        onDidChangeActiveEnvironmentPath = new EventEmitter<ActiveEnvironmentPathChangeEvent>();
        onDidChangeEnvironments = new EventEmitter<EnvironmentsChangeEvent>();
        onDidEnvironmentVariablesChange = new EventEmitter<EnvironmentVariablesChangeEvent>();
        disposables.push(onDidActivatePythonExtension);
        disposables.push(onDidChangeWorkspaceFolders);
        disposables.push(onDidChangeActiveEnvironmentPath);
        disposables.push(onDidChangeEnvironments);
        disposables.push(onDidEnvironmentVariablesChange);

        newPythonApi = mock<PythonExtension>();
        environments = mock<PythonExtension['environments']>();
        when(newPythonApi.environments).thenReturn(instance(environments));
        when(environments.onDidChangeActiveEnvironmentPath).thenReturn(onDidChangeActiveEnvironmentPath.event);
        when(environments.onDidChangeEnvironments).thenReturn(onDidChangeEnvironments.event);
        when(environments.onDidEnvironmentVariablesChange).thenReturn(onDidEnvironmentVariablesChange.event);
        when(environments.known).thenReturn([]);
        when(environments.getActiveEnvironmentPath(anything())).thenReturn();
        (instance(newPythonApi) as any).then = undefined;
        when(apiProvider.getNewApi()).thenResolve(instance(newPythonApi));
        when(apiProvider.onDidActivatePythonExtension).thenReturn(onDidActivatePythonExtension.event);
        when(workspace.onDidChangeWorkspaceFolders).thenReturn(onDidChangeWorkspaceFolders.event);
        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
        clock = fakeTimers.install();
        disposables.push(new Disposable(() => clock.uninstall()));
    });
    teardown(() => dispose(disposables));
    function createInterpreterService() {
        interpreterService = new InterpreterService(
            instance(apiProvider),
            instance(extensionChecker),
            disposables,
            instance(workspace),
            instance(context)
        );
    }
    test('Progress status triggered upon refresh', async () => {
        createInterpreterService();

        const statuses: (typeof interpreterService.status)[] = [];
        interpreterService.onDidChangeStatus(() => statuses.push(interpreterService.status));
        const progressEvent = createEventHandler(interpreterService, 'onDidChangeStatus', disposables);
        // const deferred = createDeferred<void>();
        when(environments.refreshEnvironments(anything())).thenReturn(Promise.resolve());
        await interpreterService.refreshInterpreters();
        await clock.runAllAsync();

        verify(environments.refreshEnvironments(anything())).once();
        assert.isAtLeast(progressEvent.count, 2, 'Progress event not triggered at least 2 times');
        assert.deepEqual(statuses, ['refreshing', 'idle']);
    });
});
