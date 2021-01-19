// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { assert } from 'chai';
import { noop } from 'jquery';
import * as portfinder from 'portfinder';
import * as uuid from 'uuid/v4';
import { IPythonExtensionChecker } from '../../../client/api/types';
import { IFileSystem } from '../../../client/common/platform/types';
import { IProcessServiceFactory } from '../../../client/common/process/types';
import { createDeferred, sleep } from '../../../client/common/utils/async';
import { KernelDaemonPool } from '../../../client/datascience/kernel-launcher/kernelDaemonPool';
import { KernelEnvironmentVariablesService } from '../../../client/datascience/kernel-launcher/kernelEnvVarsService';
import { KernelProcess } from '../../../client/datascience/kernel-launcher/kernelProcess';
import { createRawKernel, RawKernel } from '../../../client/datascience/raw-kernel/rawKernel';
import { IJupyterKernelSpec } from '../../../client/datascience/types';
import { IInterpreterService } from '../../../client/interpreter/contracts';
import { DataScienceIocContainer } from '../dataScienceIocContainer';
import { requestExecute, requestInspect } from './rawKernelTestHelpers';

/* eslint-disable @typescript-eslint/no-explicit-any, no-multi-str, , no-console, max-classes-per-file, comma-dangle */
suite('DataScience raw kernel tests', () => {
    let ioc: DataScienceIocContainer;
    let rawKernel: RawKernel;
    const connectionInfo = {
        shell_port: 57718,
        iopub_port: 57719,
        stdin_port: 57720,
        control_port: 57721,
        hb_port: 57722,
        ip: '127.0.0.1',
        key: 'c29c2121-d277576c2c035f0aceeb5068',
        transport: 'tcp',
        signature_scheme: 'hmac-sha256',
        kernel_name: 'python3',
        version: 5.1
    };
    let kernelProcess: KernelProcess;
    setup(async function () {
        ioc = new DataScienceIocContainer();
        ioc.registerDataScienceTypes();
        await ioc.activate();
        if (ioc.mockJupyter) {
            // eslint-disable-next-line no-invalid-this
            this.skip();
        } else {
            const port = await portfinder.getPortPromise({ startPort: 57718 });
            rawKernel = await connectToKernel(port);
        }
    });

    teardown(async () => {
        await disconnectFromKernel();
        await ioc.dispose();
    });

    async function connectToKernel(startPort: number): Promise<RawKernel> {
        connectionInfo.stdin_port = startPort;
        connectionInfo.shell_port = startPort + 1;
        connectionInfo.iopub_port = startPort + 2;
        connectionInfo.hb_port = startPort + 3;
        connectionInfo.control_port = startPort + 4;

        // Find our jupyter interpreter
        const interpreter = await ioc.get<IInterpreterService>(IInterpreterService).getActiveInterpreter(undefined);
        assert.ok(interpreter, 'No jupyter interpreter found');
        // Start our kernel
        const kernelSpec: IJupyterKernelSpec = {
            argv: [interpreter!.path, '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
            metadata: {
                interpreter
            },
            display_name: '',
            env: undefined,
            language: 'python',
            name: '',
            path: interpreter!.path,
            id: uuid()
        };
        kernelProcess = new KernelProcess(
            ioc.get<IProcessServiceFactory>(IProcessServiceFactory),
            ioc.get<KernelDaemonPool>(KernelDaemonPool),
            connectionInfo as any,
            { kernelSpec, interpreter, kind: 'startUsingKernelSpec' },
            ioc.get<IFileSystem>(IFileSystem),
            undefined,
            ioc.get<IPythonExtensionChecker>(IPythonExtensionChecker),
            ioc.get<KernelEnvironmentVariablesService>(KernelEnvironmentVariablesService)
        );
        await kernelProcess.launch(process.cwd());
        return createRawKernel(kernelProcess, uuid());
    }

    async function disconnectFromKernel() {
        if (kernelProcess) {
            await kernelProcess.dispose().catch(noop);
        }
    }

    async function shutdown(): Promise<void> {
        return rawKernel.shutdown();
    }

    test('Basic connection', async () => {
        let exited = false;
        kernelProcess.exited(() => (exited = true));
        await shutdown();
        await sleep(2500); // Give time for the shutdown to go across
        assert.ok(exited, 'Kernel did not shutdown');
    });

    test('Basic request', async () => {
        const replies = await requestExecute(rawKernel, 'a=1\na');
        const executeResult = replies.find((r) => r.header.msg_type === 'execute_result');
        assert.ok(executeResult, 'Result not found');
        assert.equal((executeResult?.content as any).data['text/plain'], '1', 'Results were not computed');
    });

    test('Interrupt pending request', async () => {
        const executionStarted = createDeferred<void>();

        // If the interrupt doesn't work, then test will timeout as execution will sleep for `300s`.
        // Hence timeout is a test failure.
        const longCellExecutionRequest = requestExecute(
            rawKernel,
            `
import time
import sys
for i in range(3000):
    sys.stdout.write('.')
    sys.stdout.flush()
    time.sleep(0.1)
    sys.stdout.write('\\\r')`,
            executionStarted
        );

        // Wait until the execution has started (cuz we cannot interrupt until exec has started).
        await executionStarted.promise;

        // Give it a bit to start running
        await sleep(300);

        // Then throw the interrupt
        await rawKernel.interrupt();

        // Verify our results
        const replies = await longCellExecutionRequest;
        const executeResult = replies.find((r) => r.header.msg_type === 'execute_reply');
        assert.ok(executeResult, 'Result not found');
        assert.equal((executeResult?.content as any).ename, 'KeyboardInterrupt', 'Interrupt not found');

        // Based on tests 2s is sufficient. Lets give 10s for CI and slow Windows machines.
    }).timeout(10_000);

    test('Multiple requests', async () => {
        let replies = await requestExecute(rawKernel, 'a=1\na');
        let executeResult = replies.find((r) => r.header.msg_type === 'execute_result');
        assert.ok(executeResult, 'Result not found');
        replies = await requestExecute(rawKernel, 'a=2\na');
        executeResult = replies.find((r) => r.header.msg_type === 'execute_result');
        assert.ok(executeResult, 'Result 2 not found');
        assert.equal((executeResult?.content as any).data['text/plain'], '2', 'Results were not computed');
        const json = await requestInspect(rawKernel, 'a');
        assert.ok(json, 'Inspect reply was not computed');
    });

    test('Startup and shutdown', async () => {
        let replies = await requestExecute(rawKernel, 'a=1\na');
        let executeResult = replies.find((r) => r.header.msg_type === 'execute_result');
        assert.ok(executeResult, 'Result not found');
        await shutdown();
        await sleep(2500); // Give time for the shutdown to go across
        const port = await portfinder.getPortPromise({ startPort: 57418 });
        rawKernel = await connectToKernel(port);
        replies = await requestExecute(rawKernel, 'a=1\na');
        executeResult = replies.find((r) => r.header.msg_type === 'execute_result');
        assert.ok(executeResult, 'Result not found');
    });
});
