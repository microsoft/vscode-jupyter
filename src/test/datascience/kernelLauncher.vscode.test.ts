// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { assert, use } from 'chai';

import { KernelMessage } from '@jupyterlab/services';
import * as uuid from 'uuid/v4';
import { IProcessServiceFactory } from '../../client/common/process/types';
import { createDeferred } from '../../client/common/utils/async';
import { JupyterZMQBinariesNotFoundError } from '../../client/datascience/jupyter/jupyterZMQBinariesNotFoundError';
import { KernelDaemonPool } from '../../client/datascience/kernel-launcher/kernelDaemonPool';
import { KernelLauncher } from '../../client/datascience/kernel-launcher/kernelLauncher';
import { IKernelConnection } from '../../client/datascience/kernel-launcher/types';
import { createRawKernel } from '../../client/datascience/raw-kernel/rawKernel';
import { IJupyterKernelSpec, IKernelDependencyService } from '../../client/datascience/types';
import { sleep, waitForCondition } from '../common';
import { requestExecute } from './raw-kernel/rawKernelTestHelpers';

// Chai as promised is not part of this file
import * as chaiAsPromised from 'chai-as-promised';
import { IPythonExtensionChecker } from '../../client/api/types';
import { IFileSystem } from '../../client/common/platform/types';
import { KernelEnvironmentVariablesService } from '../../client/datascience/kernel-launcher/kernelEnvVarsService';
import { traceInfo } from '../../client/common/logger';
import { IS_REMOTE_NATIVE_TEST } from '../constants';
import { initialize } from '../initialize';
import { createDefaultKernelSpec } from '../../client/datascience/jupyter/kernels/helpers';
use(chaiAsPromised);

const test_Timeout = 30_000;

suite('DataScience - Kernel Launcher', () => {
    let kernelLauncher: KernelLauncher;
    const kernelSpec = createDefaultKernelSpec();
    suiteSetup(async function () {
        // These are slow tests, hence lets run only on linux on CI.
        if (IS_REMOTE_NATIVE_TEST) {
            return this.skip();
        }
        await initialize();
    });

    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
        const api = await initialize();
        const ioc = api.serviceContainer;
        const processServiceFactory = ioc.get<IProcessServiceFactory>(IProcessServiceFactory);
        const daemonPool = ioc.get<KernelDaemonPool>(KernelDaemonPool);
        const fileSystem = ioc.get<IFileSystem>(IFileSystem);
        const extensionChecker = ioc.get<IPythonExtensionChecker>(IPythonExtensionChecker);
        kernelLauncher = new KernelLauncher(
            processServiceFactory,
            fileSystem,
            daemonPool,
            extensionChecker,
            ioc.get<KernelEnvironmentVariablesService>(KernelEnvironmentVariablesService),
            ioc.get<IKernelDependencyService>(IKernelDependencyService)
        );

        traceInfo(`Start Test Complete ${this.currentTest?.title}`);
    });
    teardown(function () {
        traceInfo(`End Test Complete ${this.currentTest?.title}`);
    });

    test('Launch from kernelspecxxx', async function () {
        let exitExpected = false;
        const deferred = createDeferred<boolean>();
        const kernel = await kernelLauncher.launch(
            { kernelSpec, kind: 'startUsingKernelSpec' },
            -1,
            undefined,
            process.cwd()
        );
        kernel.exited(() => {
            if (exitExpected) {
                deferred.resolve(true);
            } else {
                deferred.reject(new Error('Kernel exited prematurely'));
            }
        });

        assert.isOk<IKernelConnection | undefined>(kernel.connection, 'Connection not found');

        // It should not exit.
        await assert.isRejected(
            waitForCondition(() => deferred.promise, 2_000, 'Timeout'),
            'Timeout'
        );

        // Upon disposing, we should get an exit event within 100ms or less.
        // If this happens, then we know a process existed.
        exitExpected = true;
        await kernel.dispose();
        await deferred.promise;
    }).timeout(test_Timeout);

    test('Launch with environment', async function () {
        const spec: IJupyterKernelSpec = {
            name: 'foo',
            language: 'python',
            path: 'python',
            display_name: 'foo',
            argv: ['python', '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
            env: {
                TEST_VAR: '1'
            }
        };

        const kernel = await kernelLauncher.launch(
            { kernelSpec: spec, kind: 'startUsingKernelSpec' },
            30_000,
            undefined,
            process.cwd()
        );

        assert.isOk<IKernelConnection | undefined>(kernel.connection, 'Connection not found');

        // Send a request to print out the env vars
        const rawKernel = createRawKernel(kernel, uuid());

        const result = await requestExecute(rawKernel, 'import os\nprint(os.getenv("TEST_VAR"))');
        assert.ok(result, 'No result returned');
        // Should have a stream output message
        const output = result.find((r) => r.header.msg_type === 'stream') as KernelMessage.IStreamMsg;
        assert.ok(output, 'no stream output');
        assert.equal(output.content.text, '1\n', 'Wrong content found on message');

        // Upon disposing, we should get an exit event within 100ms or less.
        // If this happens, then we know a process existed.
        await kernel.dispose();
    }).timeout(test_Timeout);

    test('Bind with ZMQ', async function () {
        const kernel = await kernelLauncher.launch(
            { kernelSpec, kind: 'startUsingKernelSpec' },
            -1,
            undefined,
            process.cwd()
        );

        try {
            const zmq = await import('zeromq');
            const sock = new zmq.Pull();

            sock.connect(`tcp://${kernel.connection!.ip}:${kernel.connection!.stdin_port}`);
            sock.receive().ignoreErrors(); // This will never return unless the kenrel process sends something. Just used for testing the API is available
            await sleep(50);
            sock.close();
        } catch (e) {
            throw new JupyterZMQBinariesNotFoundError(e.toString());
        } finally {
            await kernel.dispose();
        }
    });
});
