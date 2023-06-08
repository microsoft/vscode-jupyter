// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as os from 'os';
import { assert } from 'chai';
import * as path from '../../../platform/vscode-path/path';
import * as sinon from 'sinon';
import rewiremock from 'rewiremock';
import { anything, instance, mock, when, verify, capture, deepEqual } from 'ts-mockito';
import { KernelProcess } from './kernelProcess.node';
import {
    IProcessService,
    IProcessServiceFactory,
    ObservableExecutionResult,
    Output
} from '../../../platform/common/process/types.node';
import { IKernelConnection } from '../types';
import { IJupyterKernelSpec, LocalKernelSpecConnectionMetadata, PythonKernelConnectionMetadata } from '../../types';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { IPythonExtensionChecker } from '../../../platform/api/types';
import { KernelEnvironmentVariablesService } from './kernelEnvVarsService.node';
import { IDisposable, IJupyterSettings, IOutputChannel } from '../../../platform/common/types';
import { CancellationTokenSource, Uri } from 'vscode';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { noop } from '../../../test/core';
import { Observable } from 'rxjs/Observable';
import { Subject } from 'rxjs/Subject';
import { ChildProcess } from 'child_process';
import { EventEmitter } from 'stream';
import { PythonKernelInterruptDaemon } from '../finder/pythonKernelInterruptDaemon.node';
import { JupyterPaths } from '../finder/jupyterPaths.node';
import { waitForCondition } from '../../../test/common.node';
import { uriEquals } from '../../../test/datascience/helpers';
import { IS_REMOTE_NATIVE_TEST } from '../../../test/constants';
import { traceInfo } from '../../../platform/logging';
import { IPlatformService } from '../../../platform/common/platform/types';
import { IPythonExecutionFactory, IPythonExecutionService } from '../../../platform/interpreter/types.node';

suite('kernel Process', () => {
    let kernelProcess: KernelProcess;
    let processServiceFactory: IProcessServiceFactory;
    const connection: IKernelConnection = {
        control_port: 1,
        hb_port: 2,
        iopub_port: 3,
        ip: '1.2.3',
        key: 'some key',
        shell_port: 4,
        signature_scheme: 'hmac-sha256',
        stdin_port: 5,
        transport: 'tcp'
    };
    let connectionMetadata: LocalKernelSpecConnectionMetadata | PythonKernelConnectionMetadata;
    let fs: IFileSystemNode;
    let extensionChecker: IPythonExtensionChecker;
    let kernelEnvVarsService: KernelEnvironmentVariablesService;
    let pythonExecFactory: IPythonExecutionFactory;
    let outputChannel: IOutputChannel | undefined;
    let jupyterSettings: IJupyterSettings;
    let token: CancellationTokenSource;
    let tempFileDisposable: IDisposable;
    let processService: IProcessService;
    let pythonProcess: IPythonExecutionService;
    const disposables: IDisposable[] = [];
    let observableOutput: Observable<Output<string>>;
    let daemon: PythonKernelInterruptDaemon;
    let proc: ChildProcess;
    let jupyterPaths: JupyterPaths;
    const tempFileCreationOptions = { fileExtension: '.json', prefix: 'kernel-v2-' };
    setup(() => {
        tempFileDisposable = mock<IDisposable>();
        token = new CancellationTokenSource();
        disposables.push(token);
        processService = mock<IProcessService>();
        processServiceFactory = mock<IProcessServiceFactory>();
        connectionMetadata = mock<LocalKernelSpecConnectionMetadata | PythonKernelConnectionMetadata>();
        fs = mock<IFileSystemNode>();
        extensionChecker = mock<IPythonExtensionChecker>();
        kernelEnvVarsService = mock<KernelEnvironmentVariablesService>();
        pythonExecFactory = mock<IPythonExecutionFactory>();
        outputChannel = mock<IOutputChannel | undefined>();
        jupyterSettings = mock<IJupyterSettings>();
        pythonProcess = mock<IPythonExecutionService>();
        (instance(processService) as any).then = undefined;
        observableOutput = new Subject<Output<string>>();
        proc = mock<ChildProcess>();
        daemon = mock<PythonKernelInterruptDaemon>();
        const eventEmitter = new EventEmitter();
        disposables.push({
            dispose: () => {
                eventEmitter.removeAllListeners();
            }
        });
        jupyterPaths = mock<JupyterPaths>();
        when(proc.on).thenReturn(noop as any);
        when(proc.stdout).thenReturn(eventEmitter as any);
        when(proc.stderr).thenReturn(eventEmitter as any);
        when(processServiceFactory.create(anything())).thenResolve(instance(processService));
        when(processServiceFactory.create(anything(), anything())).thenResolve(instance(processService));
        when(kernelEnvVarsService.getEnvironmentVariables(anything(), anything(), anything())).thenResolve();
        when(processService.execObservable(anything(), anything(), anything())).thenReturn({
            dispose: noop,
            out: observableOutput,
            proc: instance(proc)
        });
        when(pythonProcess.execObservable(anything(), anything())).thenReturn({
            dispose: noop,
            out: observableOutput,
            proc: instance(proc)
        });
        const interrupter = {
            handle: 1,
            dispose: () => Promise.resolve(),
            interrupt: () => Promise.resolve()
        };
        when(daemon.createInterrupter(anything(), anything())).thenResolve(interrupter);
        (instance(processService) as any).then = undefined;
        (instance(pythonProcess) as any).then = undefined;
        when(pythonExecFactory.createActivatedEnvironment(anything())).thenResolve(instance(pythonProcess));
        (instance(daemon) as any).then = undefined;
        rewiremock.enable();
        rewiremock('tcp-port-used').with({ waitUntilUsed: () => Promise.resolve() });
        when(fs.createTemporaryLocalFile(anything())).thenResolve({
            dispose: noop,
            filePath: 'connection.json'
        });
        when(jupyterPaths.getRuntimeDir()).thenResolve();
        const platform = mock<IPlatformService>();
        when(platform.isWindows).thenReturn(false);
        kernelProcess = new KernelProcess(
            instance(processServiceFactory),
            connection,
            instance(connectionMetadata),
            instance(fs),
            undefined,
            instance(extensionChecker),
            instance(kernelEnvVarsService),
            instance(pythonExecFactory),
            instance(outputChannel),
            instance(jupyterSettings),
            instance(jupyterPaths),
            instance(daemon),
            instance(platform)
        );
    });
    teardown(() => {
        rewiremock.disable();
        disposeAllDisposables(disposables);
    });
    test('Ensure kernelspec json file is created & the temp file disposed (to prevent file handle being left open)', async () => {
        const kernelSpec: IJupyterKernelSpec = {
            argv: ['dotnet', 'csharp', '{connection_file}'],
            display_name: 'C# .NET',
            name: 'csharp',
            executable: 'dotnet'
        };
        const tempFile = 'temporary file.json';
        when(connectionMetadata.kind).thenReturn('startUsingLocalKernelSpec');
        when(connectionMetadata.kernelSpec).thenReturn(kernelSpec);
        when(fs.createTemporaryLocalFile(deepEqual(tempFileCreationOptions))).thenResolve({
            dispose: instance(tempFileDisposable).dispose,
            filePath: tempFile
        });

        await kernelProcess.launch('', 0, token.token);

        verify(fs.createTemporaryLocalFile(deepEqual(tempFileCreationOptions))).atLeast(1);
        verify(tempFileDisposable.dispose()).once();
        verify(fs.writeFile(uriEquals(tempFile), anything())).atLeast(1);
        verify(tempFileDisposable.dispose()).calledBefore(fs.writeFile(uriEquals(tempFile), anything()));
    });
    test('Ensure kernelspec json file is created with the connection info in it', async () => {
        const kernelSpec: IJupyterKernelSpec = {
            argv: ['dotnet', 'csharp', '{connection_file}'],
            display_name: 'C# .NET',
            name: 'csharp',
            executable: 'dotnet'
        };
        const tempFile = 'temporary file.json';
        when(connectionMetadata.kind).thenReturn('startUsingLocalKernelSpec');
        when(connectionMetadata.kernelSpec).thenReturn(kernelSpec);
        when(fs.createTemporaryLocalFile(deepEqual(tempFileCreationOptions))).thenResolve({
            dispose: instance(tempFileDisposable).dispose,
            filePath: tempFile
        });

        await kernelProcess.launch('', 0, token.token);

        verify(fs.writeFile(uriEquals(tempFile), JSON.stringify(connection))).atLeast(1);
    });
    test('Ensure we start the .NET process instead of a Python process (& daemon is not started either)', async () => {
        const kernelSpec: IJupyterKernelSpec = {
            argv: ['dotnet', 'csharp', '{connection_file}'],
            display_name: 'C# .NET',
            name: 'csharp',
            executable: 'dotnet'
        };
        const tempFile = 'temporary file.json';
        when(connectionMetadata.kind).thenReturn('startUsingLocalKernelSpec');
        when(connectionMetadata.kernelSpec).thenReturn(kernelSpec);
        when(fs.createTemporaryLocalFile(deepEqual(tempFileCreationOptions))).thenResolve({
            dispose: instance(tempFileDisposable).dispose,
            filePath: tempFile
        });

        await kernelProcess.launch('', 0, token.token);

        verify(pythonExecFactory.createActivatedEnvironment(anything())).never();
        verify(pythonProcess.execObservable(anything(), anything())).never();
        assert.strictEqual(capture(processService.execObservable).first()[0], 'dotnet');
        assert.deepStrictEqual(capture(processService.execObservable).first()[1], [
            'csharp',
            Uri.file(tempFile).fsPath
        ]);
    });
    test('Ensure connection file is created in jupyter runtime directory (.net kernel)', async () => {
        const kernelSpec: IJupyterKernelSpec = {
            argv: ['dotnet', 'csharp', '{connection_file}'],
            display_name: 'C# .NET',
            name: 'csharp',
            executable: 'dotnet'
        };
        const tempFile = path.join('tmp', 'temporary file.json');
        const jupyterRuntimeDir = Uri.file(path.join('hello', 'jupyter', 'runtime'));
        const expectedConnectionFile = path.join(jupyterRuntimeDir.fsPath, path.basename(tempFile));
        when(jupyterPaths.getRuntimeDir()).thenResolve(jupyterRuntimeDir);
        when(connectionMetadata.kind).thenReturn('startUsingLocalKernelSpec');
        when(connectionMetadata.kernelSpec).thenReturn(kernelSpec);
        when(fs.createTemporaryLocalFile(deepEqual(tempFileCreationOptions))).thenResolve({
            dispose: instance(tempFileDisposable).dispose,
            filePath: tempFile
        });
        when(fs.exists(anything())).thenCall((file: Uri) => file.fsPath === Uri.file(expectedConnectionFile).fsPath);

        await kernelProcess.launch('', 0, token.token);

        assert.strictEqual(capture(processService.execObservable).first()[0], 'dotnet');
        assert.deepStrictEqual(capture(processService.execObservable).first()[1], ['csharp', expectedConnectionFile]);

        // Verify it gets deleted.
        await kernelProcess.dispose();
        await waitForCondition(
            () => {
                verify(fs.delete(uriEquals(expectedConnectionFile))).once();
                return true;
            },
            5_000,
            'Connection file not deleted'
        );
    });
    test('Ensure connection file is created in temp directory (.net kernel)', async () => {
        const kernelSpec: IJupyterKernelSpec = {
            argv: ['dotnet', 'csharp', '{connection_file}'],
            display_name: 'C# .NET',
            name: 'csharp',
            executable: 'dotnet'
        };
        const tempFile = path.join('tmp', 'temporary file.json');
        when(jupyterPaths.getRuntimeDir()).thenResolve();
        when(connectionMetadata.kind).thenReturn('startUsingLocalKernelSpec');
        when(connectionMetadata.kernelSpec).thenReturn(kernelSpec);
        when(fs.createTemporaryLocalFile(deepEqual(tempFileCreationOptions))).thenResolve({
            dispose: instance(tempFileDisposable).dispose,
            filePath: tempFile
        });
        when(fs.exists(anything())).thenCall((file: Uri) => file.fsPath === Uri.file(tempFile).fsPath);

        await kernelProcess.launch('', 0, token.token);

        assert.strictEqual(capture(processService.execObservable).first()[0], 'dotnet');
        assert.deepStrictEqual(capture(processService.execObservable).first()[1], [
            'csharp',
            Uri.file(tempFile).fsPath
        ]);

        // Verify it gets deleted.
        await kernelProcess.dispose();
        await waitForCondition(
            () => {
                verify(fs.delete(uriEquals(tempFile))).once();
                return true;
            },
            5_000,
            'Connection file not deleted'
        );
    });
    test('Ensure connection file is created in jupyter runtime directory (python daemon kernel)', async () => {
        const kernelSpec: IJupyterKernelSpec = {
            argv: [os.platform() === 'win32' ? 'python.exe' : 'python', '-m', 'ipykernel', '-f', '{connection_file}'],
            display_name: 'Python',
            name: 'Python3',
            executable: 'python'
        };
        const tempFile = path.join('tmp', 'temporary file.json');
        const jupyterRuntimeDir = Uri.file(path.join('hello', 'jupyter', 'runtime'));
        const expectedConnectionFile = path.join(jupyterRuntimeDir.fsPath, path.basename(tempFile));
        when(fs.createTemporaryLocalFile(deepEqual(tempFileCreationOptions))).thenResolve({
            dispose: noop,
            filePath: tempFile
        });
        when(fs.exists(anything())).thenCall((file: Uri) => file.fsPath === Uri.file(expectedConnectionFile).fsPath);
        when(jupyterPaths.getRuntimeDir()).thenResolve(jupyterRuntimeDir);
        when(pythonExecFactory.createActivatedEnvironment(anything())).thenResolve(instance(pythonProcess));
        when(connectionMetadata.kind).thenReturn('startUsingPythonInterpreter');
        when(connectionMetadata.kernelSpec).thenReturn(kernelSpec);
        const expectedArgs = [
            `-m`,
            `ipykernel`,
            `--ip=${connection.ip}`,
            `--stdin=${connection.stdin_port}`,
            `--control=${connection.control_port}`,
            `--hb=${connection.hb_port}`,
            `--Session.signature_scheme="${connection.signature_scheme}"`,
            `--Session.key=b"${connection.key}"`,
            `--shell=${connection.shell_port}`,
            `--transport="${connection.transport}"`,
            `--iopub=${connection.iopub_port}`,
            `--f="${expectedConnectionFile}"`,
            `--debug`
        ];
        await kernelProcess.launch(__dirname, 0, token.token);

        verify(processService.execObservable(anything(), anything())).never();
        verify(pythonProcess.execObservable(deepEqual(expectedArgs), anything())).once();

        // Verify it gets deleted.
        await kernelProcess.dispose();
        await waitForCondition(
            () => {
                verify(fs.delete(uriEquals(expectedConnectionFile))).once();
                return true;
            },
            5_000,
            'Connection file not deleted'
        );
    });
    test('Ensure connection file is created in temp directory (python daemon kernel)', async () => {
        const kernelSpec: IJupyterKernelSpec = {
            argv: [os.platform() === 'win32' ? 'python.exe' : 'python', '-m', 'ipykernel', '-f', '{connection_file}'],
            display_name: 'Python',
            name: 'Python3',
            executable: 'python'
        };
        const tempFile = path.join('tmp', 'temporary file.json');
        when(fs.createTemporaryLocalFile(deepEqual(tempFileCreationOptions))).thenResolve({
            dispose: noop,
            filePath: tempFile
        });
        when(fs.exists(anything())).thenCall((file: Uri) => file.fsPath === Uri.file(tempFile).fsPath);
        when(jupyterPaths.getRuntimeDir()).thenResolve();
        when(pythonExecFactory.createActivatedEnvironment(anything())).thenResolve(instance(pythonProcess));
        when(connectionMetadata.kind).thenReturn('startUsingPythonInterpreter');
        when(connectionMetadata.kernelSpec).thenReturn(kernelSpec);
        const expectedArgs = [
            `-m`,
            `ipykernel`,
            `--ip=${connection.ip}`,
            `--stdin=${connection.stdin_port}`,
            `--control=${connection.control_port}`,
            `--hb=${connection.hb_port}`,
            `--Session.signature_scheme="${connection.signature_scheme}"`,
            `--Session.key=b"${connection.key}"`,
            `--shell=${connection.shell_port}`,
            `--transport="${connection.transport}"`,
            `--iopub=${connection.iopub_port}`,
            `--f="${Uri.file(tempFile).fsPath}"`,
            `--debug`
        ];
        await kernelProcess.launch(__dirname, 0, token.token);

        verify(processService.execObservable(anything(), anything())).never();
        verify(pythonProcess.execObservable(deepEqual(expectedArgs), anything())).once();

        // Verify it gets deleted.
        await kernelProcess.dispose();
        await waitForCondition(
            () => {
                verify(fs.delete(uriEquals(tempFile))).once();
                return true;
            },
            5_000,
            'Connection file not deleted'
        );
    });
    test('Start Python process along with the daemon', async () => {
        const kernelSpec: IJupyterKernelSpec = {
            argv: [os.platform() === 'win32' ? 'python.exe' : 'python', '-m', 'ipykernel', '-f', '{connection_file}'],
            display_name: 'Python',
            name: 'Python3',
            executable: 'python'
        };
        when(pythonExecFactory.createActivatedEnvironment(anything())).thenResolve(instance(pythonProcess));
        when(connectionMetadata.kind).thenReturn('startUsingPythonInterpreter');
        when(connectionMetadata.kernelSpec).thenReturn(kernelSpec);
        const expectedArgs = [
            `-m`,
            `ipykernel`,
            `--ip=${connection.ip}`,
            `--stdin=${connection.stdin_port}`,
            `--control=${connection.control_port}`,
            `--hb=${connection.hb_port}`,
            `--Session.signature_scheme="${connection.signature_scheme}"`,
            `--Session.key=b"${connection.key}"`,
            `--shell=${connection.shell_port}`,
            `--transport="${connection.transport}"`,
            `--iopub=${connection.iopub_port}`,
            `--f=${Uri.file('connection.json').fsPath}`,
            `--debug`
        ];
        await kernelProcess.launch(__dirname, 0, token.token);

        verify(processService.execObservable(anything(), anything())).never();
        verify(pythonProcess.execObservable(deepEqual(expectedArgs), anything())).once();
    });
});

suite('Kernel Process', () => {
    let processService: IProcessService;
    let pythonExecFactory: IPythonExecutionFactory;
    const disposables: IDisposable[] = [];
    let token: CancellationTokenSource;
    suiteSetup(async function () {
        // These are slow tests, hence lets run only on linux on CI.
        if (IS_REMOTE_NATIVE_TEST()) {
            return this.skip();
        }
        rewiremock.disable();
        sinon.restore();
    });
    suiteTeardown(async function () {
        rewiremock.disable();
        sinon.restore();
    });
    setup(() => {
        token = new CancellationTokenSource();
        disposables.push(token);
    });

    // setup(async function () {
    //     traceInfo(`Start Test ${this.currentTest?.title}`);
    // });
    teardown(function () {
        rewiremock.disable();
        sinon.restore();
        traceInfo(`End Test Complete ${this.currentTest?.title}`);
        disposeAllDisposables(disposables);
    });

    function launchKernel(metadata: LocalKernelSpecConnectionMetadata, connectionFile: string) {
        const processExecutionFactory = mock<IProcessServiceFactory>();
        const connection = mock<IKernelConnection>();
        const fs = mock<IFileSystemNode>();
        const extensionChecker = mock<IPythonExtensionChecker>();
        const kernelEnvVarsService = mock<KernelEnvironmentVariablesService>();
        processService = mock<IProcessService>();
        const instanceOfExecutionService = instance(processService);
        (instanceOfExecutionService as any).then = undefined;
        const observableProc: ObservableExecutionResult<string> = {
            dispose: noop,
            out: { subscribe: noop } as any,
            proc: {
                stdout: new EventEmitter(),
                stderr: new EventEmitter(),
                subscribe: noop,
                on: noop
            } as any
        };
        const jupyterPaths = mock<JupyterPaths>();
        pythonExecFactory = mock<IPythonExecutionFactory>();
        when(jupyterPaths.getRuntimeDir()).thenResolve();
        when(processExecutionFactory.create(anything())).thenResolve(instanceOfExecutionService);
        when(processExecutionFactory.create(anything(), anything())).thenResolve(instanceOfExecutionService);
        when(fs.createTemporaryLocalFile(anything())).thenResolve({ dispose: noop, filePath: connectionFile });
        when(fs.writeFile(anything(), anything())).thenResolve();
        when(kernelEnvVarsService.getEnvironmentVariables(anything(), anything(), anything())).thenResolve({});
        when(processService.execObservable(anything(), anything(), anything())).thenReturn(observableProc);
        rewiremock.enable();
        rewiremock('tcp-port-used').with({ waitUntilUsed: () => Promise.resolve() });
        const settings = mock<IJupyterSettings>();
        when(settings.enablePythonKernelLogging).thenReturn(false);
        const interruptDaemon = mock<PythonKernelInterruptDaemon>();
        when(interruptDaemon.createInterrupter(anything(), anything())).thenResolve({
            dispose: () => Promise.resolve(),
            interrupt: () => Promise.resolve(),
            handle: 1
        });
        const platform = mock<IPlatformService>();
        when(platform.isWindows).thenReturn(false);

        return new KernelProcess(
            instance(processExecutionFactory),
            instance(connection),
            metadata,
            instance(fs),
            undefined,
            instance(extensionChecker),
            instance(kernelEnvVarsService),
            instance(pythonExecFactory),
            undefined,
            instance(settings),
            instance(jupyterPaths),
            instance(interruptDaemon),
            instance(platform)
        );
    }
    test('Launch from kernelspec (linux)', async function () {
        const metadata = LocalKernelSpecConnectionMetadata.create({
            id: '1',
            kernelSpec: {
                argv: [
                    '/Library/Java/JavaVirtualMachines/adoptopenjdk-11.jdk/Contents/Home/bin/java',
                    '--add-opens',
                    'java.base/jdk.internal.misc=ALL-UNNAMED',
                    '--illegal-access=permit',
                    '-Djava.awt.headless=true',
                    '-Djdk.disableLastUsageTracking=true',
                    '-Dmaven.repo.local=/Users/jdoe/Notebooks/.venv/share/jupyter/repository',
                    '-jar',
                    '/Users/jdoe/.m2/repository/ganymede/ganymede/2.0.0-SNAPSHOT/ganymede-2.0.0-SNAPSHOT.jar',
                    '--connection-file={connection_file}'
                ],
                language: 'java',
                interrupt_mode: 'message',
                display_name: '',
                name: '',
                executable: ''
            }
        });
        const kernelProcess = launchKernel(metadata, 'wow/connection_config.json');
        await kernelProcess.launch('', 10_000, token.token);
        const args = capture(processService.execObservable).first();

        assert.strictEqual(args[0], metadata.kernelSpec.argv[0]);
        assert.deepStrictEqual(
            args[1],
            metadata.kernelSpec.argv
                .slice(1, metadata.kernelSpec.argv.length - 1)
                .concat(`--connection-file=${Uri.file('wow/connection_config.json').fsPath}`)
        );
        await kernelProcess.dispose();
    });
    test('Launch from kernelspec (linux with space in file name)', async function () {
        const metadata = LocalKernelSpecConnectionMetadata.create({
            id: '1',
            kernelSpec: {
                argv: [
                    '/Library/Java/JavaVirtualMachines/adoptopenjdk-11.jdk/Contents/Home/bin/java',
                    '--add-opens',
                    'java.base/jdk.internal.misc=ALL-UNNAMED',
                    '--illegal-access=permit',
                    '-Djava.awt.headless=true',
                    '-Djdk.disableLastUsageTracking=true',
                    '-Dmaven.repo.local=/Users/jdoe/Notebooks/.venv/share/jupyter/repository',
                    '-jar',
                    '/Users/jdoe/.m2/repository/ganymede/ganymede/2.0.0-SNAPSHOT/ganymede-2.0.0-SNAPSHOT.jar',
                    '--connection-file={connection_file}'
                ],
                language: 'java',
                interrupt_mode: 'message',
                display_name: '',
                name: '',
                executable: ''
            }
        });
        const kernelProcess = launchKernel(metadata, 'wow/connection config.json');
        await kernelProcess.launch('', 10_000, token.token);
        const args = capture(processService.execObservable).first();

        assert.strictEqual(args[0], metadata.kernelSpec.argv[0]);
        assert.deepStrictEqual(
            args[1],
            metadata.kernelSpec.argv
                .slice(1, metadata.kernelSpec.argv.length - 1)
                .concat(`--connection-file="${Uri.file('wow/connection config.json').fsPath}"`)
        );
        await kernelProcess.dispose();
    });
    test('Launch from kernelspec (linux with space in file name and file name is a separate arg)', async function () {
        const metadata = LocalKernelSpecConnectionMetadata.create({
            id: '1',
            kernelSpec: {
                argv: [
                    '/Library/Java/JavaVirtualMachines/adoptopenjdk-11.jdk/Contents/Home/bin/java',
                    '--add-opens',
                    'java.base/jdk.internal.misc=ALL-UNNAMED',
                    '--illegal-access=permit',
                    '-Djava.awt.headless=true',
                    '-Djdk.disableLastUsageTracking=true',
                    '-Dmaven.repo.local=/Users/jdoe/Notebooks/.venv/share/jupyter/repository',
                    '-jar',
                    '/Users/jdoe/.m2/repository/ganymede/ganymede/2.0.0-SNAPSHOT/ganymede-2.0.0-SNAPSHOT.jar',
                    '--connection-file',
                    '{connection_file}'
                ],
                language: 'java',
                interrupt_mode: 'message',
                display_name: '',
                name: '',
                executable: ''
            }
        });
        const kernelProcess = launchKernel(metadata, 'wow/connection config.json');
        await kernelProcess.launch('', 10_000, token.token);
        const args = capture(processService.execObservable).first();

        assert.strictEqual(args[0], metadata.kernelSpec.argv[0]);
        assert.deepStrictEqual(
            args[1],
            metadata.kernelSpec.argv
                .slice(1, metadata.kernelSpec.argv.length - 1)
                .concat(Uri.file('wow/connection config.json').fsPath)
        );
        await kernelProcess.dispose();
    });
    test('Launch from kernelspec (windows)', async function () {
        const metadata = LocalKernelSpecConnectionMetadata.create({
            id: '1',
            kernelSpec: {
                argv: [
                    'C:\\Program Files\\AdoptOpenJDK\\jdk-16.0.1.9-hotspot\\bin\\java.exe',
                    '--illegal-access=permit',
                    '--add-opens',
                    'java.base/jdk.internal.misc=ALL-UNNAMED',
                    '-jar',
                    'C:\\Users\\abc\\AppData\\Roaming\\jupyter\\kernels\\ganymede-1.1.0.20210614-java-16kernel.jar',
                    '--runtime-dir=C:\\Users\\abc\\AppData\\Roaming\\jupyter\\runtime',
                    '--connection-file={connection_file}'
                ],
                language: 'java',
                interrupt_mode: 'message',
                display_name: '',
                name: '',
                executable: ''
            }
        });
        const kernelProcess = launchKernel(metadata, 'connection_config.json');
        await kernelProcess.launch('', 10_000, token.token);
        const args = capture(processService.execObservable).first();

        assert.strictEqual(args[0], metadata.kernelSpec.argv[0]);
        assert.deepStrictEqual(
            args[1],
            metadata.kernelSpec.argv
                .slice(1, metadata.kernelSpec.argv.length - 1)
                .concat(`--connection-file=${Uri.file('connection_config.json').fsPath}`)
        );
        await kernelProcess.dispose();
    });
    test('Launch from kernelspec (windows with space in file name)', async function () {
        const metadata = LocalKernelSpecConnectionMetadata.create({
            id: '1',
            kernelSpec: {
                argv: [
                    'C:\\Program Files\\AdoptOpenJDK\\jdk-16.0.1.9-hotspot\\bin\\java.exe',
                    '--illegal-access=permit',
                    '--add-opens',
                    'java.base/jdk.internal.misc=ALL-UNNAMED',
                    '-jar',
                    'C:\\Users\\abc\\AppData\\Roaming\\jupyter\\kernels\\ganymede-1.1.0.20210614-java-16kernel.jar',
                    '--runtime-dir=C:\\Users\\abc\\AppData\\Roaming\\jupyter\\runtime',
                    '--connection-file={connection_file}'
                ],
                language: 'java',
                interrupt_mode: 'message',
                display_name: '',
                name: '',
                executable: ''
            }
        });
        const kernelProcess = launchKernel(metadata, 'D:\\hello\\connection config.json');
        await kernelProcess.launch('', 10_000, token.token);
        const args = capture(processService.execObservable).first();

        assert.strictEqual(args[0], metadata.kernelSpec.argv[0]);
        assert.deepStrictEqual(
            args[1],
            metadata.kernelSpec.argv
                .slice(1, metadata.kernelSpec.argv.length - 1)
                .concat(`--connection-file="${Uri.file('D:\\hello\\connection config.json').fsPath}"`)
        );
        await kernelProcess.dispose();
    });
    test('Launch from kernelspec (windows with space in file name when file name is a separate arg)', async function () {
        const metadata = LocalKernelSpecConnectionMetadata.create({
            id: '1',
            kernelSpec: {
                argv: [
                    'C:\\Program Files\\AdoptOpenJDK\\jdk-16.0.1.9-hotspot\\bin\\java.exe',
                    '--illegal-access=permit',
                    '--add-opens',
                    'java.base/jdk.internal.misc=ALL-UNNAMED',
                    '-jar',
                    'C:\\Users\\abc\\AppData\\Roaming\\jupyter\\kernels\\ganymede-1.1.0.20210614-java-16kernel.jar',
                    '--runtime-dir=C:\\Users\\abc\\AppData\\Roaming\\jupyter\\runtime',
                    '--connection-file',
                    '{connection_file}'
                ],
                language: 'java',
                interrupt_mode: 'message',
                display_name: '',
                name: '',
                executable: ''
            }
        });
        const kernelProcess = launchKernel(metadata, 'D:\\hello\\connection config.json');
        await kernelProcess.launch('', 10_000, token.token);
        const args = capture(processService.execObservable).first();

        assert.strictEqual(args[0], metadata.kernelSpec.argv[0]);
        assert.deepStrictEqual(
            args[1],
            metadata.kernelSpec.argv
                .slice(1, metadata.kernelSpec.argv.length - 1)
                .concat(Uri.file('D:\\hello\\connection config.json').fsPath)
        );
        await kernelProcess.dispose();
    });
});
