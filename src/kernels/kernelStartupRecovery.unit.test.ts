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

    const reply = (original: KernelMessage.IExecuteRequestMsg) =>
        KernelMessage.createMessage<KernelMessage.IExecuteReplyMsg>({
            msgType: 'execute_reply',
            channel: 'shell',
            username: 'test',
            session: 'kernel',
            parentHeader: original.header,
            content: { status: 'ok', execution_count: 1, payload: [], user_expressions: {} }
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

    test('a request posted just before a tick is not probed until it has been eligible for the interval', async () => {
        const probe = sinon.stub().resolves();
        startup = new KernelStartupRecovery(6000, failure, probe);
        await clock.tickAsync(900);
        startup.sent(request());
        await clock.tickAsync(100);
        assert.strictEqual(probe.callCount, 0);
        await clock.tickAsync(1000);
        assert.strictEqual(probe.callCount, 1);
    });

    test('acknowledged busy work pauses the budget and suppresses probes until idle', async () => {
        const probe = sinon.stub().resolves();
        startup = new KernelStartupRecovery(3000, failure, probe);
        const original = request();
        const other = request();
        startup.sent(original);
        startup.received(status(original, 'busy'));
        startup.sent(other);
        startup.auxiliarySent('pending-peer');
        let completed = false;
        const operation = startup.complete(async () => undefined, parent.token).then(() => (completed = true));
        await clock.tickAsync(10000);
        assert.strictEqual(probe.callCount, 0);
        assert.isFalse(completed);
        assert.isUndefined(startup.error);
        assert.strictEqual(startup.remainingTime, 3000);
        startup.received(reply(other));
        startup.received(status(other, 'idle'));
        startup.auxiliaryReplied('pending-peer');
        startup.received(reply(original));
        startup.received(status(original, 'idle'));
        await operation;
        assert.isTrue(completed);
        assert.isUndefined(startup.error);
    });

    test('a shell reply alone pauses the budget and suppresses probes until idle', async () => {
        const probe = sinon.stub().resolves();
        startup = new KernelStartupRecovery(3000, failure, probe);
        const original = request();
        startup.sent(original);
        startup.received(reply(original));
        let completed = false;
        const operation = startup.complete(async () => undefined, parent.token).then(() => (completed = true));
        await clock.tickAsync(10000);
        assert.strictEqual(probe.callCount, 0);
        assert.isFalse(completed);
        assert.isUndefined(startup.error);
        assert.strictEqual(startup.remainingTime, 3000);
        startup.received(status(original, 'idle'));
        await operation;
        assert.isTrue(completed);
    });

    test('a stalled request is recovered when the fresh-peer probe delivers its reply and idle', async () => {
        const original = request();
        const probe = sinon.stub().callsFake(async () => {
            // The fresh peer wakes the kernel, which now answers the original request.
            startup.received(reply(original));
            startup.received(status(original, 'idle'));
        });
        startup = new KernelStartupRecovery(5000, failure, probe);
        startup.sent(original);
        let completed = false;
        const operation = startup.complete(async () => undefined, parent.token).then(() => (completed = true));
        await clock.tickAsync(1000);
        await operation;
        assert.isAbove(probe.callCount, 0);
        assert.isTrue(completed);
        assert.isUndefined(startup.error);
    });

    test('does not publish on idle until the matching shell reply arrives', async () => {
        const probe = sinon.stub().resolves();
        startup = new KernelStartupRecovery(3000, failure, probe);
        const original = request();
        startup.sent(original);
        startup.received(status(original, 'busy'));
        startup.received(status(original, 'idle'));
        let completed = false;
        const operation = startup.complete(async () => undefined, parent.token).then(() => (completed = true));
        await clock.tickAsync(2000);
        assert.isFalse(completed);
        assert.isUndefined(startup.error);
        startup.received(reply(original));
        await operation;
        assert.isTrue(completed);
    });

    test('communication budget charges only while unacknowledged and is not replenished by progress', async () => {
        startup = new KernelStartupRecovery(5000, failure, async () => undefined);
        const first = request();
        const second = request();
        startup.sent(first);
        await clock.tickAsync(1200);
        assert.strictEqual(startup.remainingTime, 3800);
        startup.received(status(first, 'busy'));
        startup.sent(second);
        await clock.tickAsync(8000);
        assert.strictEqual(startup.remainingTime, 3800);
        startup.received(reply(first));
        startup.received(status(first, 'idle'));
        await clock.tickAsync(1000);
        assert.strictEqual(startup.remainingTime, 2800);
        startup.received(status(second, 'busy'));
        await clock.tickAsync(3000);
        assert.strictEqual(startup.remainingTime, 2800);
        startup.received(reply(second));
        startup.received(status(second, 'idle'));
        await clock.tickAsync(2000);
        assert.strictEqual(startup.remainingTime, 2800);
        startup.sent(request());
        await clock.tickAsync(1000);
        assert.strictEqual(startup.remainingTime, 1800);
        assert.isUndefined(startup.error);
    });

    test('an unacknowledged primary request fails when the communication budget is exhausted', async () => {
        startup = new KernelStartupRecovery(3000, failure, async () => undefined);
        startup.sent(request());
        const operation = startup
            .run((token) => raceCancellationError(token, createDeferred<void>().promise), parent.token)
            .catch((error) => error);
        let result: unknown;
        void operation.then((value) => (result = value));
        await clock.tickAsync(2999);
        assert.isUndefined(result);
        await clock.tickAsync(1);
        assert.strictEqual(result, failure);
    });

    test('an unanswered auxiliary request exhausts the communication budget', async () => {
        startup = new KernelStartupRecovery(3000, failure, async () => undefined);
        startup.auxiliarySent('pending-peer');
        const operation = startup
            .run((token) => raceCancellationError(token, createDeferred<void>().promise), parent.token)
            .catch((error) => error);
        let result: unknown;
        void operation.then((value) => (result = value));
        await clock.tickAsync(2999);
        assert.isUndefined(result);
        await clock.tickAsync(1);
        assert.strictEqual(result, failure);
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

    test('reports a healthy outcome when startup completes without probing', async () => {
        const report = sinon.stub();
        startup = new KernelStartupRecovery(3000, failure, async () => undefined, report);
        await startup.complete(async () => undefined, parent.token);
        assert.strictEqual(report.callCount, 1);
        assert.strictEqual(report.firstCall.args[0].outcome, 'healthy');
        assert.strictEqual(report.firstCall.args[0].probeCount, 0);
    });

    test('reports a recovered outcome after a probe delivers the stalled reply', async () => {
        const original = request();
        const report = sinon.stub();
        const probe = sinon.stub().callsFake(async () => {
            startup.received(reply(original));
            startup.received(status(original, 'idle'));
        });
        startup = new KernelStartupRecovery(5000, failure, probe, report);
        startup.sent(original);
        const operation = startup.complete(async () => undefined, parent.token);
        await clock.tickAsync(1000);
        await operation;
        assert.strictEqual(report.callCount, 1);
        assert.strictEqual(report.firstCall.args[0].outcome, 'recovered');
        assert.isAbove(report.firstCall.args[0].probeCount, 0);
    });

    test('reports a timeout outcome when the communication budget is exhausted', async () => {
        const report = sinon.stub();
        startup = new KernelStartupRecovery(3000, failure, async () => undefined, report);
        startup.sent(request());
        const operation = startup
            .run((token) => raceCancellationError(token, createDeferred<void>().promise), parent.token)
            .catch((error) => error);
        await clock.tickAsync(3000);
        await operation;
        assert.strictEqual(report.callCount, 1);
        assert.strictEqual(report.firstCall.args[0].outcome, 'timeout');
    });
});
