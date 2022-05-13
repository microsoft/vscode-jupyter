/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import * as assert from 'assert';
import * as sinon from 'sinon';
import { IS_REMOTE_NATIVE_TEST } from '../constants.node';
import { IDisposable, IJupyterSettings } from '../../platform/common/types';
import rewiremock from 'rewiremock';
import {
    IProcessService,
    IProcessServiceFactory,
    IPythonExecutionFactory,
    ObservableExecutionResult
} from '../../platform/common/process/types.node';
import { anything, capture, instance, mock, when } from 'ts-mockito';
import { LocalKernelSpecConnectionMetadata } from '../../kernels/types';
import { IFileSystemNode } from '../../platform/common/platform/types.node';
import { IPythonExtensionChecker } from '../../platform/api/types';
import { noop } from '../core';
import { EventEmitter } from 'events';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { traceInfo } from '../../platform/logging';
import { CancellationTokenSource } from 'vscode';
import { IKernelConnection } from '../../kernels/raw/types';
import { KernelEnvironmentVariablesService } from '../../kernels/raw/launcher/kernelEnvVarsService.node';
import { KernelProcess } from '../../kernels/raw/launcher/kernelProcess.node';
import { JupyterPaths } from '../../kernels/raw/finder/jupyterPaths.node';

suite('DataScience - Kernel Process', () => {
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
        when(fs.createTemporaryLocalFile(anything())).thenResolve({ dispose: noop, filePath: connectionFile });
        when(fs.writeFile(anything(), anything())).thenResolve();
        when(kernelEnvVarsService.getEnvironmentVariables(anything(), anything(), anything())).thenResolve(process.env);
        when(processService.execObservable(anything(), anything(), anything())).thenReturn(observableProc);
        rewiremock.enable();
        rewiremock('tcp-port-used').with({ waitUntilUsed: () => Promise.resolve() });
        const settings = mock<IJupyterSettings>();
        when(settings.enablePythonKernelLogging).thenReturn(false);
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
            instance(jupyterPaths)
        );
    }
    test('Launch from kernelspec (linux)', async function () {
        const metadata: LocalKernelSpecConnectionMetadata = {
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
            },
            kind: 'startUsingLocalKernelSpec'
        };
        const kernelProcess = launchKernel(metadata, 'wow/connection_config.json');
        await kernelProcess.launch('', 10_000, token.token);
        const args = capture(processService.execObservable).first();

        assert.strictEqual(args[0], metadata.kernelSpec.argv[0]);
        assert.deepStrictEqual(
            args[1],
            metadata.kernelSpec.argv
                .slice(1, metadata.kernelSpec.argv.length - 1)
                .concat('--connection-file=wow/connection_config.json')
        );
        await kernelProcess.dispose();
    });
    test('Launch from kernelspec (linux with space in file name)', async function () {
        const metadata: LocalKernelSpecConnectionMetadata = {
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
            },
            kind: 'startUsingLocalKernelSpec'
        };
        const kernelProcess = launchKernel(metadata, 'wow/connection config.json');
        await kernelProcess.launch('', 10_000, token.token);
        const args = capture(processService.execObservable).first();

        assert.strictEqual(args[0], metadata.kernelSpec.argv[0]);
        assert.deepStrictEqual(
            args[1],
            metadata.kernelSpec.argv
                .slice(1, metadata.kernelSpec.argv.length - 1)
                .concat('--connection-file="wow/connection config.json"')
        );
        await kernelProcess.dispose();
    });
    test('Launch from kernelspec (windows)', async function () {
        const metadata: LocalKernelSpecConnectionMetadata = {
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
            },
            kind: 'startUsingLocalKernelSpec'
        };
        const kernelProcess = launchKernel(metadata, 'connection_config.json');
        await kernelProcess.launch('', 10_000, token.token);
        const args = capture(processService.execObservable).first();

        assert.strictEqual(args[0], metadata.kernelSpec.argv[0]);
        assert.deepStrictEqual(
            args[1],
            metadata.kernelSpec.argv
                .slice(1, metadata.kernelSpec.argv.length - 1)
                .concat('--connection-file=connection_config.json')
        );
        await kernelProcess.dispose();
    });
    test('Launch from kernelspec (windows with space in file name)', async function () {
        const metadata: LocalKernelSpecConnectionMetadata = {
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
            },
            kind: 'startUsingLocalKernelSpec'
        };
        const kernelProcess = launchKernel(metadata, 'D:\\hello\\connection config.json');
        await kernelProcess.launch('', 10_000, token.token);
        const args = capture(processService.execObservable).first();

        assert.strictEqual(args[0], metadata.kernelSpec.argv[0]);
        assert.deepStrictEqual(
            args[1],
            metadata.kernelSpec.argv
                .slice(1, metadata.kernelSpec.argv.length - 1)
                .concat('--connection-file="D:\\hello\\connection config.json"')
        );
        await kernelProcess.dispose();
    });
});
