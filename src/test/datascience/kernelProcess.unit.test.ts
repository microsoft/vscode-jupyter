/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import * as os from 'os';
import { assert } from 'chai';
import * as path from '../../platform/vscode-path/path';
import rewiremock from 'rewiremock';
import { anything, instance, mock, when, verify, capture, deepEqual } from 'ts-mockito';
import { KernelProcess } from '../../kernels/raw/launcher/kernelProcess.node';
import {
    IProcessService,
    IProcessServiceFactory,
    IPythonExecutionFactory,
    IPythonExecutionService,
    Output
} from '../../platform/common/process/types.node';
import { IKernelConnection } from '../../kernels/raw/types';
import {
    IJupyterKernelSpec,
    LocalKernelSpecConnectionMetadata,
    PythonKernelConnectionMetadata
} from '../../kernels/types';
import { IFileSystemNode } from '../../platform/common/platform/types.node';
import { IPythonExtensionChecker } from '../../platform/api/types';
import { KernelEnvironmentVariablesService } from '../../kernels/raw/launcher/kernelEnvVarsService.node';
import { IDisposable, IJupyterSettings, IOutputChannel } from '../../platform/common/types';
import { CancellationTokenSource, Uri } from 'vscode';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { noop } from '../core';
import { Observable } from 'rxjs/Observable';
import { Subject } from 'rxjs/Subject';
import { ChildProcess } from 'child_process';
import { EventEmitter } from 'stream';
import { PythonKernelInterruptDaemon } from '../../kernels/raw/finder/pythonKernelInterruptDaemon.node';
import { JupyterPaths } from '../../kernels/raw/finder/jupyterPaths.node';
import { waitForCondition } from '../common.node';
import { uriEquals } from './helpers';

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
        when(daemon.getInterruptHandle()).thenResolve(1);
        (instance(processService) as any).then = undefined;
        (instance(pythonProcess) as any).then = undefined;
        when(pythonExecFactory.createActivatedEnvironment(anything())).thenResolve(instance(pythonProcess));
        (instance(daemon) as any).then = undefined;
        when(pythonExecFactory.createDaemon(anything())).thenResolve(instance(daemon));
        rewiremock.enable();
        rewiremock('tcp-port-used').with({ waitUntilUsed: () => Promise.resolve() });
        when(fs.createTemporaryLocalFile(anything())).thenResolve({
            dispose: noop,
            filePath: 'connection.json'
        });
        when(jupyterPaths.getRuntimeDir()).thenResolve();
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
            instance(jupyterPaths)
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

        verify(pythonExecFactory.createDaemon(anything())).never();
        verify(pythonProcess.execObservable(anything(), anything())).never();
        assert.strictEqual(capture(processService.execObservable).first()[0], 'dotnet');
        assert.deepStrictEqual(capture(processService.execObservable).first()[1], ['csharp', `"${tempFile}"`]);
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
        assert.deepStrictEqual(capture(processService.execObservable).first()[1], [
            'csharp',
            `"${expectedConnectionFile}"`
        ]);

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
        assert.deepStrictEqual(capture(processService.execObservable).first()[1], ['csharp', `"${tempFile}"`]);

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
            argv: ['python', '-f', '{connection_file}'],
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
        when(pythonExecFactory.createDaemon(anything())).thenResolve(instance(pythonProcess));
        when(connectionMetadata.kind).thenReturn('startUsingPythonInterpreter');
        when(connectionMetadata.kernelSpec).thenReturn(kernelSpec);
        const expectedArgs = [
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

        // Daemon is created only on windows.
        verify(pythonExecFactory.createDaemon(anything())).times(os.platform() === 'win32' ? 1 : 0);
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
            argv: ['python', '-f', '{connection_file}'],
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
        when(pythonExecFactory.createDaemon(anything())).thenResolve(instance(pythonProcess));
        when(connectionMetadata.kind).thenReturn('startUsingPythonInterpreter');
        when(connectionMetadata.kernelSpec).thenReturn(kernelSpec);
        const expectedArgs = [
            `--ip=${connection.ip}`,
            `--stdin=${connection.stdin_port}`,
            `--control=${connection.control_port}`,
            `--hb=${connection.hb_port}`,
            `--Session.signature_scheme="${connection.signature_scheme}"`,
            `--Session.key=b"${connection.key}"`,
            `--shell=${connection.shell_port}`,
            `--transport="${connection.transport}"`,
            `--iopub=${connection.iopub_port}`,
            `--f="${tempFile}"`,
            `--debug`
        ];
        await kernelProcess.launch(__dirname, 0, token.token);

        // Daemon is created only on windows.
        verify(pythonExecFactory.createDaemon(anything())).times(os.platform() === 'win32' ? 1 : 0);
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
            argv: ['python', '-f', '{connection_file}'],
            display_name: 'Python',
            name: 'Python3',
            executable: 'python'
        };
        when(pythonExecFactory.createDaemon(anything())).thenResolve(instance(pythonProcess));
        when(connectionMetadata.kind).thenReturn('startUsingPythonInterpreter');
        when(connectionMetadata.kernelSpec).thenReturn(kernelSpec);
        const expectedArgs = [
            `--ip=${connection.ip}`,
            `--stdin=${connection.stdin_port}`,
            `--control=${connection.control_port}`,
            `--hb=${connection.hb_port}`,
            `--Session.signature_scheme="${connection.signature_scheme}"`,
            `--Session.key=b"${connection.key}"`,
            `--shell=${connection.shell_port}`,
            `--transport="${connection.transport}"`,
            `--iopub=${connection.iopub_port}`,
            `--f=connection.json`,
            `--debug`
        ];
        await kernelProcess.launch(__dirname, 0, token.token);

        // Daemon is created only on windows.
        verify(pythonExecFactory.createDaemon(anything())).times(os.platform() === 'win32' ? 1 : 0);
        verify(processService.execObservable(anything(), anything())).never();
        verify(pythonProcess.execObservable(deepEqual(expectedArgs), anything())).once();
    });
});
