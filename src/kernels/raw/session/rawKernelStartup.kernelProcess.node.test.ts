// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawn, ChildProcess } from 'child_process';
import { assert } from 'chai';
import * as sinon from 'sinon';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { CancellationTokenSource, Uri } from 'vscode';
import { KernelProcess } from '../launcher/kernelProcess.node';
import { IKernelConnection } from '../types';
import { LocalKernelSpecConnectionMetadata } from '../../types';
import {
    ExecutionResult,
    IProcessService,
    IProcessServiceFactory,
    Output,
    ShellOptions,
    SpawnOptions
} from '../../../platform/common/process/types.node';
import { createObservable } from '../../../platform/common/process/proc.node';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { KernelEnvironmentVariablesService } from '../launcher/kernelEnvVarsService.node';
import { Experiments, IExperimentService, IJupyterSettings } from '../../../platform/common/types';
import { IPythonExecutionFactory } from '../../../platform/interpreter/types.node';
import { JupyterPaths } from '../finder/jupyterPaths.node';
import { PythonKernelInterruptDaemon } from '../finder/pythonKernelInterruptDaemon.node';
import { IPlatformService } from '../../../platform/common/platform/types';
import { ServiceContainer } from '../../../platform/ioc/container';
import { IServiceContainer } from '../../../platform/ioc/types';
import { createDeferred, raceTimeoutError } from '../../../platform/common/utils/async';

suite('Raw startup KernelProcess native termination', () => {
    test('real owned child termination waits for actual exit after synthetic disposal', async () => {
        const token = new CancellationTokenSource();
        const children: ChildProcess[] = [];
        const childClosed = createDeferred<void>();
        const processService: IProcessService = {
            execObservable(command: string, args: string[], _options: SpawnOptions = {}) {
                const child = spawn(command, args);
                children.push(child);
                const out = createObservable<Output<string>>();
                child.once('close', () => {
                    out.resolve();
                    childClosed.resolve();
                });
                child.once('error', (error) => {
                    out.reject(error);
                    childClosed.resolve();
                });
                return {
                    proc: child,
                    out,
                    dispose: () => {
                        if (child.exitCode === null && !child.killed) {
                            child.kill();
                        }
                    }
                };
            },
            async exec(_file: string, _args: string[], _options?: SpawnOptions): Promise<ExecutionResult<string>> {
                throw new Error('The native termination fixture only launches observable processes');
            },
            async shellExec(_command: string, _options?: ShellOptions): Promise<ExecutionResult<string>> {
                throw new Error('The native termination fixture only launches observable processes');
            },
            dispose() {
                children.forEach((child) => {
                    if (child.exitCode === null && !child.killed) {
                        child.kill();
                    }
                });
            }
        };
        const processServiceFactory = mock<IProcessServiceFactory>();
        when(processServiceFactory.create(anything())).thenResolve(processService);
        when(processServiceFactory.create(anything(), anything())).thenResolve(processService);

        const fileSystem = mock<IFileSystemNode>();
        when(fileSystem.writeFile(anything(), anything())).thenResolve();
        when(fileSystem.delete(anything())).thenResolve();
        const extensionChecker = mock<IPythonExtensionChecker>();
        const environmentVariables = mock<KernelEnvironmentVariablesService>();
        when(environmentVariables.getEnvironmentVariables(anything(), anything(), anything(), anything())).thenResolve(
            {}
        );
        const pythonExecutionFactory = mock<IPythonExecutionFactory>();
        const settings = mock<IJupyterSettings>();
        when(settings.enablePythonKernelLogging).thenReturn(false);
        const paths = mock<JupyterPaths>();
        when(paths.getRuntimeDir()).thenResolve(Uri.file('C:\\fixture\\runtime'));
        const interruptDaemon = mock<PythonKernelInterruptDaemon>();
        const platform = mock<IPlatformService>();
        when(platform.isWindows).thenReturn(false);
        const experiment = mock<IExperimentService>();
        when(experiment.inExperiment(Experiments.DoNotWaitForZmqPortsToBeUsed)).thenReturn(true);
        const services = mock<IServiceContainer>();
        when(services.get<IExperimentService>(IExperimentService)).thenReturn(instance(experiment));
        const serviceContainer = sinon.stub(ServiceContainer, 'instance').get(() => instance(services));

        const connection: IKernelConnection = {
            control_port: 1,
            hb_port: 2,
            iopub_port: 3,
            ip: '127.0.0.1',
            key: '',
            shell_port: 4,
            signature_scheme: 'hmac-sha256',
            stdin_port: 5,
            transport: 'tcp'
        };
        // eslint-disable-next-line local-rules/dont-use-process
        const executable = process.execPath;
        const metadata = LocalKernelSpecConnectionMetadata.create({
            id: 'native-termination',
            kernelSpec: {
                argv: [
                    executable,
                    '-e',
                    "process.stdin.setEncoding('utf8'); process.stdin.on('data', (data) => { if (data.includes('exit')) { process.exit(0); } }); process.stdin.on('end', () => process.exit(0)); setInterval(() => {}, 1000);",
                    '{connection_file}'
                ],
                display_name: 'Native termination fixture',
                executable,
                language: 'javascript',
                name: 'native-termination'
            }
        });
        const kernelProcess = new KernelProcess(
            instance(processServiceFactory),
            connection,
            metadata,
            instance(fileSystem),
            undefined,
            instance(extensionChecker),
            instance(environmentVariables),
            instance(pythonExecutionFactory),
            undefined,
            instance(settings),
            instance(paths),
            instance(interruptDaemon),
            instance(platform)
        );
        const syntheticExit = createDeferred<void>();
        const disposed = createDeferred<void>();
        const exitedListener = kernelProcess.exited(() => syntheticExit.resolve());
        const disposedListener = kernelProcess.onDidDispose(() => disposed.resolve());
        let killStub: sinon.SinonStub | undefined;
        let killRequested = false;

        async function ensureChildTerminated() {
            const child = children[0];
            if (!child || child.exitCode !== null) {
                return;
            }
            try {
                child.stdin?.write('exit\n');
                child.stdin?.end();
            } catch {
                // Fall through to the owned-child termination fallback below.
            }
            try {
                await raceTimeoutError(
                    3000,
                    new Error('Owned native child did not close after graceful release'),
                    childClosed.promise
                );
            } catch {
                if (child.exitCode === null && !child.killed) {
                    child.kill();
                }
                await raceTimeoutError(
                    3000,
                    new Error('Owned native child did not close after forced release'),
                    childClosed.promise
                );
            }
        }

        try {
            await kernelProcess.launch('', 1000, token.token);
            assert.strictEqual(children.length, 1);
            const child = children[0];
            let terminated = false;
            void kernelProcess.termination.then(() => (terminated = true));
            killStub = sinon.stub(child, 'kill').callsFake(() => {
                killRequested = true;
                return true;
            });
            kernelProcess.dispose();
            await raceTimeoutError(
                5000,
                new Error('Production KernelProcess did not emit synthetic disposal state'),
                Promise.all([syntheticExit.promise, disposed.promise])
            );
            assert.isTrue(kernelProcess.isDisposed);
            assert.isTrue(killRequested);
            assert.isFalse(terminated, 'Synthetic disposal must not complete actual child termination');
            assert.strictEqual(child.exitCode, null);
            verify(fileSystem.delete(anything())).once();

            child.stdin?.write('exit\n');
            child.stdin?.end();
            await raceTimeoutError(
                5000,
                new Error('Production KernelProcess did not observe the released child exit'),
                Promise.all([kernelProcess.termination, childClosed.promise])
            );
            assert.isTrue(terminated);
            assert.strictEqual(child.exitCode, 0);
        } finally {
            killStub?.restore();
            await ensureChildTerminated();
            exitedListener.dispose();
            disposedListener.dispose();
            token.dispose();
            kernelProcess.dispose();
            serviceContainer.restore();
        }
    }).timeout(10000);
});
