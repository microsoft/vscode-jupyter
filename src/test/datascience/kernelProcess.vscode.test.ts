/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import * as assert from 'assert';
import * as sinon from 'sinon';
import { IKernelConnection } from '../../client/datascience/kernel-launcher/types';
import { IS_REMOTE_NATIVE_TEST } from '../constants';
import { IDisposable } from '../../client/common/types';
import rewiremock from 'rewiremock';
import {
    IProcessService,
    IProcessServiceFactory,
    IPythonExecutionFactory,
    ObservableExecutionResult
} from '../../client/common/process/types';
import { anything, capture, instance, mock, when } from 'ts-mockito';
import { KernelDaemonPool } from '../../client/datascience/kernel-launcher/kernelDaemonPool';
import { KernelSpecConnectionMetadata } from '../../client/datascience/jupyter/kernels/types';
import { IFileSystem } from '../../client/common/platform/types';
import { KernelEnvironmentVariablesService } from '../../client/datascience/kernel-launcher/kernelEnvVarsService';
import { KernelProcess } from '../../client/datascience/kernel-launcher/kernelProcess';
import { IPythonExtensionChecker } from '../../client/api/types';
import { noop } from '../core';
import { PythonKernelLauncherDaemon } from '../../client/datascience/kernel-launcher/kernelLauncherDaemon';
import { EventEmitter } from 'events';
import { disposeAllDisposables } from '../../client/common/helpers';
import { traceInfo } from '../../client/common/logger';

suite('DataScience - Kernel Process', () => {
    let processService: IProcessService;
    let pythonExecFactory: IPythonExecutionFactory;
    const disposables: IDisposable[] = [];
    suiteSetup(async function () {
        // These are slow tests, hence lets run only on linux on CI.
        if (IS_REMOTE_NATIVE_TEST) {
            return this.skip();
        }
        rewiremock.disable();
        sinon.restore();
    });
    suiteTeardown(async function () {
        rewiremock.disable();
        sinon.restore();
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

    function launchKernel(metadata: KernelSpecConnectionMetadata, connectionFile: string) {
        const processExecutionFactory = mock<IProcessServiceFactory>();
        const daemonPool = mock<KernelDaemonPool>();
        const connection = mock<IKernelConnection>();
        const fs = mock<IFileSystem>();
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
        pythonExecFactory = mock<IPythonExecutionFactory>();
        when(processExecutionFactory.create(anything())).thenResolve(instanceOfExecutionService);
        when(fs.createTemporaryLocalFile(anything())).thenResolve({ dispose: noop, filePath: connectionFile });
        when(fs.writeFile(anything(), anything())).thenResolve();
        when(kernelEnvVarsService.getEnvironmentVariables(anything(), anything(), anything())).thenResolve(process.env);
        when(processService.execObservable(anything(), anything(), anything())).thenReturn(observableProc);
        sinon.stub(PythonKernelLauncherDaemon.prototype, 'launch');
        rewiremock.enable();
        rewiremock('tcp-port-used').with({ waitUntilUsed: () => Promise.resolve() });
        return new KernelProcess(
            instance(processExecutionFactory),
            instance(daemonPool),
            instance(connection),
            metadata,
            instance(fs),
            undefined,
            instance(extensionChecker),
            instance(kernelEnvVarsService),
            instance(pythonExecFactory)
        );
    }
    test('Launch from kernelspec (linux)', async function () {
        const metadata: KernelSpecConnectionMetadata = {
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
                path: ''
            },
            kind: 'startUsingKernelSpec'
        };
        const kernelProcess = launchKernel(metadata, 'wow/connection_config.json');
        await kernelProcess.launch('', 10_000);
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
        const metadata: KernelSpecConnectionMetadata = {
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
                path: ''
            },
            kind: 'startUsingKernelSpec'
        };
        const kernelProcess = launchKernel(metadata, 'wow/connection config.json');
        await kernelProcess.launch('', 10_000);
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
        const metadata: KernelSpecConnectionMetadata = {
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
                path: ''
            },
            kind: 'startUsingKernelSpec'
        };
        const kernelProcess = launchKernel(metadata, 'connection_config.json');
        await kernelProcess.launch('', 10_000);
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
        const metadata: KernelSpecConnectionMetadata = {
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
                path: ''
            },
            kind: 'startUsingKernelSpec'
        };
        const kernelProcess = launchKernel(metadata, 'D:\\hello\\connection config.json');
        await kernelProcess.launch('', 10_000);
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
