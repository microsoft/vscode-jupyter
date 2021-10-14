// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert } from 'chai';
import { anything, deepEqual, instance, mock, verify, when } from 'ts-mockito';
import {
    IPythonExecutionFactory,
    IPythonExecutionService,
    ObservableExecutionResult
} from '../../../client/common/process/types';
import { ReadWrite } from '../../../client/common/types';
import { KernelDaemonPool } from '../../../client/datascience/kernel-launcher/kernelDaemonPool';
import { KernelEnvironmentVariablesService } from '../../../client/datascience/kernel-launcher/kernelEnvVarsService';
import { PythonKernelLauncherDaemon } from '../../../client/datascience/kernel-launcher/kernelLauncherDaemon';
import { IPythonKernelDaemon } from '../../../client/datascience/kernel-launcher/types';
import { IJupyterKernelSpec } from '../../../client/datascience/types';
import { PythonEnvironment } from '../../../client/pythonEnvironments/info';
import { createPythonInterpreter } from '../../utils/interpreters';

/* eslint-disable , @typescript-eslint/no-explicit-any */
suite('DataScience - Kernel Launcher Daemon', () => {
    let launcher: PythonKernelLauncherDaemon;
    let daemonPool: KernelDaemonPool;
    let interpreter: PythonEnvironment;
    let kernelSpec: ReadWrite<IJupyterKernelSpec>;
    let kernelDaemon: IPythonKernelDaemon;
    let pythonExecService: IPythonExecutionService;
    let execFactory: IPythonExecutionFactory;
    let observableOutputForDaemon: ObservableExecutionResult<string>;
    setup(() => {
        kernelSpec = {
            argv: ['python', '-m', 'ipykernel_launcher', '-f', 'file.json'],
            display_name: '',
            env: { hello: '1' },
            language: 'python',
            name: '',
            path: ''
        };
        interpreter = createPythonInterpreter();
        execFactory = mock<IPythonExecutionFactory>();
        daemonPool = mock(KernelDaemonPool);
        observableOutputForDaemon = mock<ObservableExecutionResult<string>>();
        kernelDaemon = mock<IPythonKernelDaemon>();
        pythonExecService = mock<IPythonExecutionService>();
        // Else ts-mockit doesn't allow us to return an instance of a mock as a return value from an async function.
        (instance(kernelDaemon) as any).then = undefined;
        (instance(pythonExecService) as any).then = undefined;
        // Else ts-mockit doesn't allow us to return an instance of a mock as a return value from an async function.
        (instance(observableOutputForDaemon) as any).then = undefined;
        when(execFactory.createActivatedEnvironment(anything())).thenResolve(instance(pythonExecService));
        when(daemonPool.get(anything(), anything(), anything())).thenResolve(instance(kernelDaemon));
        when(observableOutputForDaemon.proc).thenResolve({} as any);
        when(kernelDaemon.start('ipykernel_launcher', deepEqual(['-f', 'file.json']), anything())).thenResolve(
            instance(observableOutputForDaemon)
        );
        when(kernelDaemon.start('ipykernel', deepEqual(['-f', 'file.json']), anything())).thenResolve(
            instance(observableOutputForDaemon)
        );
        when(pythonExecService.execObservable(anything(), anything())).thenReturn(instance(observableOutputForDaemon));
        launcher = new PythonKernelLauncherDaemon(
            instance(daemonPool),
            instance(execFactory),
            instance(mock<KernelEnvironmentVariablesService>())
        );
    });
    test('Supports launching kernels if there is no -m in argv', async () => {
        kernelSpec.argv = ['exec', 'wow'];
        const obs = await launcher.launch(undefined, '', kernelSpec, interpreter);

        await assert.isObject(obs);
        verify(pythonExecService.execObservable(deepEqual(['wow']), anything())).once();
    });
    test('Supports launching non ipykernel kernels', async () => {
        kernelSpec.argv = ['python', '-m', 'ansible'];
        const obs = await launcher.launch(undefined, '', kernelSpec, interpreter);

        await assert.isObject(obs);
        verify(pythonExecService.execObservable(deepEqual(['-m', 'ansible']), anything())).once();
    });
    test('Creates and returns a daemon', async () => {
        const daemonCreationOutput = await launcher.launch(undefined, '', kernelSpec, interpreter);

        assert.isDefined(daemonCreationOutput);

        if (daemonCreationOutput) {
            assert.equal(daemonCreationOutput.observableOutput, instance(observableOutputForDaemon));
            assert.equal(daemonCreationOutput.daemon, instance(kernelDaemon));
        }
    });
    test('If our daemon pool returns an execution service, then use it and return the daemon as undefined', async () => {
        const executionService = mock<IPythonExecutionService>();
        when(
            executionService.execModuleObservable('ipykernel_launcher', deepEqual(['-f', 'file.json']), anything())
        ).thenReturn(instance(observableOutputForDaemon));
        // Else ts-mockit doesn't allow us to return an instance of a mock as a return value from an async function.
        (instance(executionService) as any).then = undefined;
        when(daemonPool.get(anything(), anything(), anything())).thenResolve(instance(executionService) as any);
        const daemonCreationOutput = await launcher.launch(undefined, '', kernelSpec, interpreter);

        assert.equal(daemonCreationOutput.observableOutput, instance(observableOutputForDaemon));
        assert.isUndefined(daemonCreationOutput.daemon);
    });
});
