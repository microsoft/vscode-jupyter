// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import { assert, use } from 'chai';

import { KernelMessage } from '@jupyterlab/services';
import uuid from 'uuid/v4';
import { createDeferred } from '../../platform/common/utils/async';
import { createEventHandler, PYTHON_PATH, sleep, waitForCondition } from '../common.node';
import { requestExecute } from './raw-kernel/rawKernelTestHelpers';

// Chai as promised is not part of this file
import chaiAsPromised from 'chai-as-promised';
import { traceInfo } from '../../platform/logging';
import { IS_REMOTE_NATIVE_TEST } from '../constants.node';
import { initialize } from '../initialize.node';
import { PortAttributesProviders } from '../../kernels/raw/port/portAttributeProvider.node';
import { IDisposable } from '../../platform/common/types';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { CancellationTokenSource, PortAutoForwardAction } from 'vscode';
import { createRawKernel } from '../../kernels/raw/session/rawKernel.node';
import { IKernelConnection, IKernelLauncher } from '../../kernels/raw/types';
import { IJupyterKernelSpec } from '../../kernels/types';
use(chaiAsPromised);

const test_Timeout = 30_000;

suite('DataScience - Kernel Launcher', () => {
    let kernelLauncher: IKernelLauncher;
    let token: CancellationTokenSource;
    const kernelSpec = {
        name: 'python3',
        language: 'python',
        display_name: 'Python 3',
        metadata: {},
        argv: [PYTHON_PATH, '-m', 'ipykernel_launcher', '-f', `{connection_file}`],
        env: {},
        resources: {},
        executable: ''
    };
    const disposables: IDisposable[] = [];
    suiteSetup(async function () {
        // These are slow tests, hence lets run only on linux on CI.
        if (IS_REMOTE_NATIVE_TEST()) {
            return this.skip();
        }
        const api = await initialize();
        kernelLauncher = api.serviceContainer.get<IKernelLauncher>(IKernelLauncher);
    });

    setup(async function () {
        token = new CancellationTokenSource();
        traceInfo(`Start Test ${this.currentTest?.title}`);
    });
    teardown(function () {
        token.dispose();
        traceInfo(`End Test Complete ${this.currentTest?.title}`);
        disposeAllDisposables(disposables);
    });

    test('Launch from kernelspec', async function () {
        let exitExpected = false;
        const deferred = createDeferred<boolean>();
        const kernel = await kernelLauncher.launch(
            { kernelSpec, kind: 'startUsingLocalKernelSpec', id: '1' },
            -1,
            undefined,
            process.cwd(),
            token.token
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
            waitForCondition(() => deferred.promise, 15_000, 'Timeout'),
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
            executable: 'python',
            display_name: 'foo',
            argv: [PYTHON_PATH, '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
            env: {
                TEST_VAR: '1'
            }
        };

        const kernel = await kernelLauncher.launch(
            { kernelSpec: spec, kind: 'startUsingLocalKernelSpec', id: '1' },
            30_000,
            undefined,
            process.cwd(),
            token.token
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

        await kernel.dispose();
    }).timeout(test_Timeout);
    test('Ensure ports are not forwarded to end user', async function () {
        const spec: IJupyterKernelSpec = {
            name: 'foo',
            language: 'python',
            executable: 'python',
            display_name: 'foo',
            argv: [PYTHON_PATH, '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
            env: {
                TEST_VAR: '1'
            }
        };

        const kernel = await kernelLauncher.launch(
            { kernelSpec: spec, kind: 'startUsingLocalKernelSpec', id: '1' },
            30_000,
            undefined,
            process.cwd(),
            token.token
        );

        // Confirm the ports used by this kernel are ignored.
        const kernelPorts = [
            kernel.connection.control_port,
            kernel.connection.hb_port,
            kernel.connection.iopub_port,
            kernel.connection.shell_port,
            kernel.connection.stdin_port
        ];
        const portAttributeProvider = new PortAttributesProviders(disposables);

        // The current kernels ports are hidden.
        kernelPorts.forEach((port) => {
            let portsAttribute = portAttributeProvider.providePortAttributes(
                port,
                undefined,
                undefined,
                new CancellationTokenSource().token
            );
            assert.isOk(portsAttribute, 'Port attribute should not be undefined');
            assert.equal(
                portsAttribute!.autoForwardAction,
                PortAutoForwardAction.Ignore,
                `Port ${port} should be hidden`
            );
        });
        const kernelDiedEvent = createEventHandler(kernel, 'exited', disposables);
        // Upon disposing, we should get an exit event within 100ms or less.
        // If this happens, then we know a process existed.
        await kernel.dispose();
        await kernelDiedEvent.assertFiredAtLeast(1, 1_000);

        // The current kernels ports are no longer hidden.
        kernelPorts.forEach((port) => {
            let portsAttribute = portAttributeProvider.providePortAttributes(
                port,
                undefined,
                undefined,
                new CancellationTokenSource().token
            );
            assert.isUndefined(portsAttribute);
        });
    }).timeout(test_Timeout);

    test('Bind with ZMQ', async function () {
        const kernel = await kernelLauncher.launch(
            { kernelSpec, kind: 'startUsingLocalKernelSpec', id: '1' },
            -1,
            undefined,
            process.cwd(),
            token.token
        );

        try {
            const zmq = await import('zeromq');
            const sock = new zmq.Pull();

            sock.connect(`tcp://${kernel.connection!.ip}:${kernel.connection!.stdin_port}`);
            sock.receive().ignoreErrors(); // This will never return unless the kenrel process sends something. Just used for testing the API is available
            await sleep(50);
            sock.close();
        } finally {
            await kernel.dispose();
        }
    });
});
