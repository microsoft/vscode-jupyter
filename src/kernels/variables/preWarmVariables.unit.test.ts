// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { anything, instance, mock, verify, when } from 'ts-mockito';
import { EventEmitter, Uri } from 'vscode';
import { IExtensionSyncActivationService } from '../../platform/activation/types';
import { PythonExtensionChecker } from '../../platform/api/pythonApi';
import { IPythonApiProvider } from '../../platform/api/types';
import { CondaService } from '../../platform/interpreter/condaService.node';
import { createDeferred } from '../../platform/common/utils/async';
import { IEnvironmentActivationService } from '../../platform/interpreter/activation/types';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { JupyterInterpreterService } from '../jupyter/interpreter/jupyterInterpreterService.node';
import { PreWarmActivatedJupyterEnvironmentVariables } from './preWarmVariables.node';
import { sleep } from '../../test/core';
import { IRawNotebookSupportedService } from '../raw/types';

suite('PreWarm Env Vars', () => {
    let activationService: IExtensionSyncActivationService;
    let envActivationService: IEnvironmentActivationService;
    let jupyterInterpreter: JupyterInterpreterService;
    let onDidChangeInterpreter: EventEmitter<PythonEnvironment>;
    let interpreter: PythonEnvironment;
    let extensionChecker: PythonExtensionChecker;
    let zmqSupported: IRawNotebookSupportedService;
    setup(() => {
        interpreter = {
            uri: Uri.file(''),
            id: Uri.file('').fsPath,
            sysPrefix: '',
            sysVersion: ''
        };
        onDidChangeInterpreter = new EventEmitter<PythonEnvironment>();
        envActivationService = mock<IEnvironmentActivationService>();
        jupyterInterpreter = mock(JupyterInterpreterService);
        when(jupyterInterpreter.onDidChangeInterpreter).thenReturn(onDidChangeInterpreter.event);
        extensionChecker = mock(PythonExtensionChecker);
        const apiProvider = mock<IPythonApiProvider>();
        when(apiProvider.onDidActivatePythonExtension).thenReturn(new EventEmitter<void>().event);
        when(extensionChecker.isPythonExtensionInstalled).thenReturn(false);
        when(extensionChecker.isPythonExtensionActive).thenReturn(true);
        zmqSupported = mock<IRawNotebookSupportedService>();
        when(zmqSupported.isSupported).thenReturn(false);
        activationService = new PreWarmActivatedJupyterEnvironmentVariables(
            instance(envActivationService),
            instance(jupyterInterpreter),
            [],
            instance(extensionChecker),
            instance(apiProvider),
            instance(zmqSupported),
            instance(mock(CondaService))
        );
    });
    test('Should not pre-warm env variables if there is no jupyter interpreter', async () => {
        const envActivated = createDeferred<string>();
        when(jupyterInterpreter.getSelectedInterpreter()).thenResolve(undefined);
        when(envActivationService.getActivatedEnvironmentVariables(anything(), anything())).thenCall(() => {
            envActivated.reject(new Error('Environment Activated when it should not have been!'));
            return Promise.resolve();
        });
        when(envActivationService.getActivatedEnvironmentVariables(anything(), anything(), anything())).thenCall(() => {
            envActivated.reject(new Error('Environment Activated when it should not have been!'));
            return Promise.resolve();
        });

        await activationService.activate();

        await Promise.race([envActivated.promise, sleep(50)]);
    });
    test('Should not pre-warm env variables if there is no python extension', async () => {
        const envActivated = createDeferred<string>();
        when(extensionChecker.isPythonExtensionInstalled).thenReturn(false);
        when(envActivationService.getActivatedEnvironmentVariables(anything(), anything())).thenCall(() => {
            envActivated.reject(new Error('Environment Activated when it should not have been!'));
            return Promise.resolve();
        });
        when(envActivationService.getActivatedEnvironmentVariables(anything(), anything(), anything())).thenCall(() => {
            envActivated.reject(new Error('Environment Activated when it should not have been!'));
            return Promise.resolve();
        });

        await activationService.activate();

        await Promise.race([envActivated.promise, sleep(50)]);
    });
    test('Should not pre-warm env variables if ZMQ is supported', async () => {
        const envActivated = createDeferred<string>();
        when(zmqSupported.isSupported).thenReturn(true);
        when(envActivationService.getActivatedEnvironmentVariables(anything(), anything())).thenCall(() => {
            envActivated.reject(new Error('Environment Activated when it should not have been!'));
            return Promise.resolve();
        });
        when(envActivationService.getActivatedEnvironmentVariables(anything(), anything(), anything())).thenCall(() => {
            envActivated.reject(new Error('Environment Activated when it should not have been!'));
            return Promise.resolve();
        });

        await activationService.activate();

        await Promise.race([envActivated.promise, sleep(50)]);
    });
    test('Should pre-warm env variables', async () => {
        const envActivated = createDeferred<string>();
        when(jupyterInterpreter.getSelectedInterpreter()).thenResolve(interpreter);
        when(envActivationService.getActivatedEnvironmentVariables(anything(), anything())).thenCall(() => {
            envActivated.resolve();
            return Promise.resolve();
        });
        when(envActivationService.getActivatedEnvironmentVariables(anything(), anything(), anything())).thenCall(() => {
            envActivated.resolve();
            return Promise.resolve();
        });

        await activationService.activate();

        await envActivated.promise;
        verify(envActivationService.getActivatedEnvironmentVariables(undefined, interpreter)).once();
    });
    test('Should pre-warm env variables when jupyter interpreter changes', async () => {
        const envActivated = createDeferred<string>();
        when(jupyterInterpreter.getSelectedInterpreter()).thenResolve(undefined);
        when(envActivationService.getActivatedEnvironmentVariables(anything(), anything())).thenCall(() => {
            envActivated.reject(new Error('Environment Activated when it should not have been!'));
            return Promise.resolve();
        });
        when(envActivationService.getActivatedEnvironmentVariables(anything(), anything(), anything())).thenCall(() => {
            envActivated.reject(new Error('Environment Activated when it should not have been!'));
            return Promise.resolve();
        });

        await activationService.activate();

        await Promise.race([envActivated.promise, sleep(50)]);

        // Change interpreter
        when(jupyterInterpreter.getSelectedInterpreter()).thenResolve(interpreter);
        when(envActivationService.getActivatedEnvironmentVariables(anything(), anything())).thenCall(() => {
            envActivated.resolve();
            return Promise.resolve();
        });
        when(envActivationService.getActivatedEnvironmentVariables(anything(), anything(), anything())).thenCall(() => {
            envActivated.resolve();
            return Promise.resolve();
        });
        onDidChangeInterpreter.fire(interpreter);

        await envActivated.promise;
        verify(envActivationService.getActivatedEnvironmentVariables(undefined, interpreter)).once();
    });
});
