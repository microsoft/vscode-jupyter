// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { KernelMessage } from '@jupyterlab/services';
import { assert } from 'chai';
import * as sinon from 'sinon';
import { CancellationTokenSource } from 'vscode';
import { KernelStartupRecovery } from './kernelStartupRecovery';
import { createDeferred } from '../platform/common/utils/async';
import { raceCancellationError } from '../platform/common/cancellation';

suite('Kernel Startup Recovery Budget', () => {
    let clock: sinon.SinonFakeTimers;
    let startup: KernelStartupRecovery;
    let parent: CancellationTokenSource;
    const failure = new Error('configured startup deadline');
    const request = () =>
        KernelMessage.createMessage<KernelMessage.IExecuteRequestMsg>({
            msgType: 'execute_request',
            channel: 'shell',
            username: 'test',
            session: 'primary',
            content: { code: 'pass', silent: true, store_history: false, allow_stdin: false, stop_on_error: false }
        });
    const status = (original: KernelMessage.IMessage, execution_state: 'busy' | 'idle') =>
        KernelMessage.createMessage<KernelMessage.IStatusMsg>({
            msgType: 'status',
            channel: 'iopub',
            username: 'test',
            session: 'kernel',
            parentHeader: original.header,
            content: { execution_state }
        });

    setup(() => {
        clock = sinon.useFakeTimers();
        parent = new CancellationTokenSource();
    });
    teardown(async () => {
        startup.dispose();
        parent.dispose();
        await clock.tickAsync(0);
        assert.strictEqual(clock.countTimers(), 0);
        clock.restore();
    });

    test('waits one second, ignores unrelated busy traffic and never overlaps attempts', async () => {
        const pending = createDeferred<void>();
        const probe = sinon.stub().returns(pending.promise);
        startup = new KernelStartupRecovery(6000, failure, probe);
        startup.sent(request());
        startup.received(status(request(), 'busy'));
        await clock.tickAsync(999);
        assert.strictEqual(probe.callCount, 0);
        await clock.tickAsync(1);
        assert.strictEqual(probe.callCount, 1);
        await clock.tickAsync(2000);
        assert.strictEqual(probe.callCount, 1);
        pending.resolve();
        await clock.tickAsync(1000);
        assert.strictEqual(probe.callCount, 2);
    });

    test('acknowledged busy work suppresses probes but cannot suspend the deadline', async () => {
        const probe = sinon.stub().resolves();
        startup = new KernelStartupRecovery(3000, failure, probe);
        const original = request();
        startup.sent(original);
        startup.received(status(original, 'busy'));
        startup.sent(request());
        const operation = startup
            .run((token) => raceCancellationError(token, createDeferred<void>().promise), parent.token)
            .catch((error) => error);
        let result: unknown;
        void operation.then((value) => (result = value));
        await clock.tickAsync(2999);
        assert.strictEqual(probe.callCount, 0);
        await clock.tickAsync(1);
        assert.strictEqual(result, failure, 'Acknowledged work escaped the configured deadline');
    });

    test('raw readiness and initialization share the original remaining budget', async () => {
        startup = new KernelStartupRecovery(3000, failure, async () => undefined);
        await startup.run(async () => undefined, parent.token);
        await clock.tickAsync(2000);
        assert.strictEqual(startup.remainingTime, 1000);
        const operation = startup
            .run((token) => raceCancellationError(token, createDeferred<void>().promise), parent.token)
            .catch((error) => error);
        let result: unknown;
        void operation.then((value) => (result = value));
        await clock.tickAsync(1000);
        assert.strictEqual(result, failure, 'Initialization incorrectly reset the original deadline');
    });

    test('normal completion cancels monitoring without creating a failure', async () => {
        const probe = sinon.stub().resolves();
        startup = new KernelStartupRecovery(3000, failure, probe);
        await startup.complete(async () => undefined, parent.token);
        await clock.tickAsync(5000);
        assert.strictEqual(probe.callCount, 0);
        assert.isUndefined(startup.error);
    });

    test('a peer that failed before native send acceptance leaves no phantom request', async () => {
        startup = new KernelStartupRecovery(3000, failure, async () => undefined);
        startup.auxiliarySent('not-accepted');
        startup.auxiliaryNotSent('not-accepted');
        await startup.complete(async () => undefined, parent.token);
        assert.isUndefined(startup.error);
    });

    test('parent cancellation terminates a swallowed or never-settling operation', async () => {
        startup = new KernelStartupRecovery(3000, failure, async () => undefined);
        const operation = startup
            .run(async () => createDeferred<void>().promise, parent.token)
            .then(
                () => undefined,
                (error) => error
            );
        parent.cancel();
        assert.instanceOf(await operation, Error);
        assert.notStrictEqual(await operation, failure);
    });
});
