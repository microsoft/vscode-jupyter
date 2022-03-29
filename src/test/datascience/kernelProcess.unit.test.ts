/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import * as os from 'os';
import { assert } from 'chai';
import rewiremock from 'rewiremock';
import { anything, instance, mock, when, verify, capture } from 'ts-mockito';
import { KernelProcess } from '../../kernels/raw/launcher/kernelProcess';
import {
    IProcessService,
    IProcessServiceFactory,
    IPythonExecutionFactory,
    IPythonExecutionService,
    Output
} from '../../platform/common/process/types';
import { IKernelConnection } from '../../kernels/raw/types';
import { LocalKernelSpecConnectionMetadata, PythonKernelConnectionMetadata } from '../../kernels/types';
import { IFileSystem } from '../../platform/common/platform/types';
import { IPythonExtensionChecker } from '../../platform/api/types';
import { KernelEnvironmentVariablesService } from '../../kernels/raw/launcher/kernelEnvVarsService';
import { IDisposable, IJupyterSettings, IOutputChannel } from '../../platform/common/types';
import { IJupyterKernelSpec } from '../../platform/datascience/types';
import { CancellationTokenSource } from 'vscode';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { noop } from '../core';
import { Observable, Subject } from 'rxjs';
import { ChildProcess } from 'child_process';
import { EventEmitter } from 'stream';
import { PythonKernelInterruptDaemon } from '../../kernels/raw/finder/pythonKernelInterruptDaemon';
import { JupyterPaths } from '../../kernels/raw/finder/jupyterPaths';

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
    let fs: IFileSystem;
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
    setup(() => {
        tempFileDisposable = mock<IDisposable>();
        token = new CancellationTokenSource();
        disposables.push(token);
        processService = mock<IProcessService>();
        processServiceFactory = mock<IProcessServiceFactory>();
        connectionMetadata = mock<LocalKernelSpecConnectionMetadata | PythonKernelConnectionMetadata>();
        fs = mock<IFileSystem>();
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
            path: 'dotnet'
        };
        const tempFile = 'temporary file.json';
        when(connectionMetadata.kind).thenReturn('startUsingLocalKernelSpec');
        when(connectionMetadata.kernelSpec).thenReturn(kernelSpec);
        when(fs.createTemporaryLocalFile('.json')).thenResolve({
            dispose: instance(tempFileDisposable).dispose,
            filePath: tempFile
        });

        await kernelProcess.launch('', 0, token.token);

        verify(fs.createTemporaryLocalFile('.json')).atLeast(1);
        verify(tempFileDisposable.dispose()).once();
        verify(fs.writeLocalFile(tempFile, anything())).atLeast(1);
        verify(tempFileDisposable.dispose()).calledBefore(fs.writeLocalFile(tempFile, anything()));
    });
    test('Ensure kernelspec json file is created with the connection info in it', async () => {
        const kernelSpec: IJupyterKernelSpec = {
            argv: ['dotnet', 'csharp', '{connection_file}'],
            display_name: 'C# .NET',
            name: 'csharp',
            path: 'dotnet'
        };
        const tempFile = 'temporary file.json';
        when(connectionMetadata.kind).thenReturn('startUsingLocalKernelSpec');
        when(connectionMetadata.kernelSpec).thenReturn(kernelSpec);
        when(fs.createTemporaryLocalFile('.json')).thenResolve({
            dispose: instance(tempFileDisposable).dispose,
            filePath: tempFile
        });

        await kernelProcess.launch('', 0, token.token);

        verify(fs.writeLocalFile(tempFile, JSON.stringify(connection))).atLeast(1);
    });
    test('Ensure we start the .NET process instead of a Python process (& daemon is not started either)', async () => {
        const kernelSpec: IJupyterKernelSpec = {
            argv: ['dotnet', 'csharp', '{connection_file}'],
            display_name: 'C# .NET',
            name: 'csharp',
            path: 'dotnet'
        };
        const tempFile = 'temporary file.json';
        when(connectionMetadata.kind).thenReturn('startUsingLocalKernelSpec');
        when(connectionMetadata.kernelSpec).thenReturn(kernelSpec);
        when(fs.createTemporaryLocalFile('.json')).thenResolve({
            dispose: instance(tempFileDisposable).dispose,
            filePath: tempFile
        });

        await kernelProcess.launch('', 0, token.token);

        verify(pythonExecFactory.createDaemon(anything())).never();
        verify(pythonProcess.execObservable(anything(), anything())).never();
        assert.strictEqual(capture(processService.execObservable).first()[0], 'dotnet');
        assert.deepStrictEqual(capture(processService.execObservable).first()[1], ['csharp', '"temporary file.json"']);
    });
    test('Start Python process along with the daemon', async () => {
        const kernelSpec: IJupyterKernelSpec = {
            argv: ['python', '-f', '{connection_file}'],
            display_name: 'Python',
            name: 'Python3',
            path: 'python'
        };
        when(pythonExecFactory.createDaemon(anything())).thenResolve(instance(pythonProcess));
        when(connectionMetadata.kind).thenReturn('startUsingPythonInterpreter');
        when(connectionMetadata.kernelSpec).thenReturn(kernelSpec);

        await kernelProcess.launch(__dirname, 0, token.token);

        // Daemon is created only on windows.
        verify(pythonExecFactory.createDaemon(anything())).times(os.platform() === 'win32' ? 1 : 0);
        verify(processService.execObservable(anything(), anything())).never();
        verify(pythonProcess.execObservable(anything(), anything())).once();
    });
});
