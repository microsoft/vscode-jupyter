// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { anything, instance, mock, verify, when } from 'ts-mockito';
import { EventEmitter } from 'vscode';
import { IExtensionSingleActivationService } from '../../client/activation/types';
import { PythonExtensionChecker } from '../../client/api/pythonApi';
import { IPythonApiProvider } from '../../client/api/types';
import { createDeferred } from '../../client/common/utils/async';
import { JupyterInterpreterService } from '../../client/datascience/jupyter/interpreter/jupyterInterpreterService';
import { PreWarmActivatedJupyterEnvironmentVariables } from '../../client/datascience/preWarmVariables';
import { IRawNotebookSupportedService } from '../../client/datascience/types';
import { IEnvironmentActivationService } from '../../client/interpreter/activation/types';
import { PythonEnvironment } from '../../client/pythonEnvironments/info';
import { sleep } from '../core';

suite('DataScience - PreWarm Env Vars', () => {
    let activationService: IExtensionSingleActivationService;
    let envActivationService: IEnvironmentActivationService;
    let jupyterInterpreter: JupyterInterpreterService;
    let onDidChangeInterpreter: EventEmitter<PythonEnvironment>;
    let interpreter: PythonEnvironment;
    let extensionChecker: PythonExtensionChecker;
    let zmqSupported: IRawNotebookSupportedService;
    setup(() => {
        interpreter = {
            path: '',
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
        when(extensionChecker.isPythonExtensionInstalled).thenReturn(true);
        when(extensionChecker.isPythonExtensionActive).thenReturn(true);
        zmqSupported = mock<IRawNotebookSupportedService>();
        when(zmqSupported.supported()).thenReturn(false);
        activationService = new PreWarmActivatedJupyterEnvironmentVariables(
            instance(envActivationService),
            instance(jupyterInterpreter),
            [],
            instance(extensionChecker),
            instance(apiProvider),
            instance(zmqSupported)
        );
    });
    test('Should not pre-warm env variables if there is no jupyter interpreter', async () => {
        const envActivated = createDeferred<string>();
        when(jupyterInterpreter.getSelectedInterpreter()).thenResolve(undefined);
        when(envActivationService.getActivatedEnvironmentVariables(anything(), anything())).thenCall(() => {
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

        await activationService.activate();

        await Promise.race([envActivated.promise, sleep(50)]);
    });
    test('Should not pre-warm env variables if ZMQ is supported', async () => {
        const envActivated = createDeferred<string>();
        when(zmqSupported.supported()).thenReturn(true);
        when(envActivationService.getActivatedEnvironmentVariables(anything(), anything())).thenCall(() => {
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

        await activationService.activate();

        await Promise.race([envActivated.promise, sleep(50)]);

        // Change interpreter
        when(jupyterInterpreter.getSelectedInterpreter()).thenResolve(interpreter);
        when(envActivationService.getActivatedEnvironmentVariables(anything(), anything())).thenCall(() => {
            envActivated.resolve();
            return Promise.resolve();
        });
        onDidChangeInterpreter.fire(interpreter);

        await envActivated.promise;
        verify(envActivationService.getActivatedEnvironmentVariables(undefined, interpreter)).once();
    });
});
