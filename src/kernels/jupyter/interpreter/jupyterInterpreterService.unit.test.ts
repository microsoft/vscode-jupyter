// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IDisposable } from '@fluentui/react';
import { assert } from 'chai';
import { anything, deepEqual, instance, mock, verify, when } from 'ts-mockito';
import { EventEmitter, Memento, Uri } from 'vscode';
import { IApplicationShell, IWorkspaceService } from '../../../platform/common/application/types';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { DataScience } from '../../../platform/common/utils/localize';
import { JupyterInstallError } from '../../../platform/errors/jupyterInstallError';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { MockMemento } from '../../../test/mocks/mementos';
import { createPythonInterpreter } from '../../../test/utils/interpreters';
import { JupyterInterpreterDependencyResponse } from '../types';
import { JupyterInterpreterDependencyService } from './jupyterInterpreterDependencyService.node';
import { JupyterInterpreterSelector } from './jupyterInterpreterSelector.node';
import { JupyterInterpreterService } from './jupyterInterpreterService.node';
import { JupyterInterpreterStateStore } from './jupyterInterpreterStateStore';

/* eslint-disable  */

suite('Jupyter Interpreter Service', () => {
    let jupyterInterpreterService: JupyterInterpreterService;
    let interpreterSelector: JupyterInterpreterSelector;
    let interpreterConfiguration: JupyterInterpreterDependencyService;
    let interpreterService: IInterpreterService;
    let selectedInterpreterEventArgs: PythonEnvironment | undefined;
    let memento: Memento;
    let interpreterSelectionState: JupyterInterpreterStateStore;
    let appShell: IApplicationShell;
    const selectedJupyterInterpreter = createPythonInterpreter({ displayName: 'JupyterInterpreter' });
    const pythonInterpreter: PythonEnvironment = {
        uri: Uri.file('some path'),
        id: Uri.file('some path').fsPath,
        sysPrefix: '',
        sysVersion: ''
    };
    const secondPythonInterpreter: PythonEnvironment = {
        uri: Uri.file('second interpreter path'),
        id: Uri.file('second interpreter path').fsPath,
        sysPrefix: '',
        sysVersion: ''
    };
    const disposables: IDisposable[] = [];

    setup(() => {
        interpreterSelector = mock(JupyterInterpreterSelector);
        interpreterConfiguration = mock(JupyterInterpreterDependencyService);
        interpreterService = mock<IInterpreterService>();
        memento = mock(MockMemento);
        interpreterSelectionState = mock(JupyterInterpreterStateStore);
        appShell = mock<IApplicationShell>();
        const workspace = mock<IWorkspaceService>();
        const onDidGrantWorkspaceTrust = new EventEmitter<void>();
        disposables.push(onDidGrantWorkspaceTrust);
        when(workspace.onDidGrantWorkspaceTrust).thenReturn(onDidGrantWorkspaceTrust.event);
        jupyterInterpreterService = new JupyterInterpreterService(
            instance(interpreterSelectionState),
            instance(interpreterSelector),
            instance(interpreterConfiguration),
            instance(interpreterService),
            instance(appShell),
            instance(workspace),
            disposables
        );
        when(interpreterService.getInterpreterDetails(pythonInterpreter.uri)).thenResolve(pythonInterpreter);
        when(interpreterService.getInterpreterDetails(secondPythonInterpreter.uri)).thenResolve(
            secondPythonInterpreter
        );
        when(memento.update(anything(), anything())).thenResolve();
        jupyterInterpreterService.onDidChangeInterpreter((e) => (selectedInterpreterEventArgs = e));
        when(interpreterSelector.selectInterpreter()).thenResolve(pythonInterpreter);
    });
    teardown(() => disposeAllDisposables(disposables));

    test('Cancelling interpreter configuration is same as cancelling selection of an interpreter', async () => {
        when(interpreterConfiguration.installMissingDependencies(pythonInterpreter, anything())).thenResolve(
            JupyterInterpreterDependencyResponse.cancel
        );

        const response = await jupyterInterpreterService.selectInterpreter();

        assert.equal(response, undefined);
        assert.isUndefined(selectedInterpreterEventArgs);
    });
    test('Once selected interpreter must be stored in settings and event fired', async () => {
        when(interpreterConfiguration.installMissingDependencies(pythonInterpreter, anything())).thenResolve(
            JupyterInterpreterDependencyResponse.ok
        );

        const response = await jupyterInterpreterService.selectInterpreter();

        verify(interpreterConfiguration.installMissingDependencies(pythonInterpreter, anything())).once();
        assert.equal(response, pythonInterpreter);
        assert.equal(selectedInterpreterEventArgs, pythonInterpreter);

        // Selected interpreter should be returned.
        const selectedInterpreter = await jupyterInterpreterService.selectInterpreter();

        assert.equal(selectedInterpreter, pythonInterpreter);
    });
    test('Select another interpreter if user opts to not install dependencies', async () => {
        when(interpreterConfiguration.installMissingDependencies(pythonInterpreter, anything())).thenResolve(
            JupyterInterpreterDependencyResponse.selectAnotherInterpreter
        );
        when(interpreterConfiguration.installMissingDependencies(secondPythonInterpreter, anything())).thenResolve(
            JupyterInterpreterDependencyResponse.ok
        );
        let interpreterSelection = 0;
        when(interpreterSelector.selectInterpreter()).thenCall(() => {
            // When selecting intererpter for first time, return first interpreter
            // When selected interpretre
            interpreterSelection += 1;
            return interpreterSelection === 1 ? pythonInterpreter : secondPythonInterpreter;
        });

        const response = await jupyterInterpreterService.selectInterpreter();

        verify(interpreterSelector.selectInterpreter()).twice();
        assert.equal(response, secondPythonInterpreter);
        assert.equal(selectedInterpreterEventArgs, secondPythonInterpreter);

        // Selected interpreter should be the second interpreter.
        const selectedInterpreter = await jupyterInterpreterService.selectInterpreter();

        assert.equal(selectedInterpreter, secondPythonInterpreter);
    });
    test('Display prompt to select an interpreter when running the installer without an active interpreter', async () => {
        when(appShell.showErrorMessage(anything(), anything(), anything())).thenResolve();

        const response = await jupyterInterpreterService.installMissingDependencies(new JupyterInstallError('Kaboom'));

        verify(
            appShell.showErrorMessage(
                'Kaboom',
                deepEqual({ modal: true }),
                DataScience.selectDifferentJupyterInterpreter
            )
        ).once();
        verify(interpreterSelector.selectInterpreter()).never();
        assert.equal(response, JupyterInterpreterDependencyResponse.cancel);
    });
    test('setInitialInterpreter use saved interpreter if valid', async () => {
        when(interpreterSelectionState.selectedPythonPath).thenReturn(pythonInterpreter.uri);
        when(interpreterConfiguration.areDependenciesInstalled(pythonInterpreter, anything())).thenResolve(true);
        const initialInterpreter = await jupyterInterpreterService.setInitialInterpreter(undefined);
        assert.equal(initialInterpreter, pythonInterpreter);
    });
    test('setInitialInterpreter saved interpreter invalid, clear it and use active interpreter', async () => {
        when(interpreterSelectionState.selectedPythonPath).thenReturn(secondPythonInterpreter.uri);
        when(interpreterConfiguration.areDependenciesInstalled(secondPythonInterpreter, anything())).thenResolve(false);
        when(interpreterService.getActiveInterpreter(anything())).thenResolve(pythonInterpreter);
        when(interpreterConfiguration.areDependenciesInstalled(pythonInterpreter, anything())).thenResolve(true);
        const initialInterpreter = await jupyterInterpreterService.setInitialInterpreter(undefined);
        assert.equal(initialInterpreter, pythonInterpreter);
        // Make sure we set our saved interpreter to the new active interpreter
        // it should have been cleared to undefined, then set to a new value
        verify(interpreterSelectionState.updateSelectedPythonPath(undefined)).once();
        verify(interpreterSelectionState.updateSelectedPythonPath(pythonInterpreter.uri)).once();
    });
    test('Install missing dependencies into active interpreter', async () => {
        when(interpreterService.getActiveInterpreter(anything())).thenResolve(pythonInterpreter);
        await jupyterInterpreterService.installMissingDependencies(undefined);
        verify(interpreterConfiguration.installMissingDependencies(pythonInterpreter, undefined)).once();
    });
    test('Install missing dependencies into jupyter interpreter', async () => {
        when(interpreterService.getActiveInterpreter(anything())).thenResolve(undefined);
        when(interpreterSelector.selectInterpreter()).thenResolve(selectedJupyterInterpreter);
        when(interpreterConfiguration.installMissingDependencies(selectedJupyterInterpreter, anything())).thenResolve(
            JupyterInterpreterDependencyResponse.ok
        );
        // First select our interpreter
        await jupyterInterpreterService.selectInterpreter();
        verify(interpreterConfiguration.installMissingDependencies(selectedJupyterInterpreter, undefined)).once();
    });
    test('Display picker if no interpreters are selected', async () => {
        when(interpreterService.getActiveInterpreter(undefined)).thenResolve(undefined);
        when(interpreterSelector.selectInterpreter()).thenResolve(selectedJupyterInterpreter);
        when(interpreterConfiguration.installMissingDependencies(selectedJupyterInterpreter, anything())).thenResolve(
            JupyterInterpreterDependencyResponse.ok
        );
        await jupyterInterpreterService.installMissingDependencies(undefined);
        verify(interpreterSelector.selectInterpreter()).once();
    });
});
