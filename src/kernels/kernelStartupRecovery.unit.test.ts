// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import { instance, mock, when } from 'ts-mockito';
import { Kernel, KernelMessage } from '@jupyterlab/services';
import { Signal } from '@lumino/signaling';
import { CancellationError, CancellationToken, CancellationTokenSource, EventEmitter } from 'vscode';
import { KernelStartupRecovery, StartupRecoveryRequestEvent } from './kernelStartupRecovery';
import { LocalKernelSpecConnectionMetadata } from './types';
import { KernelConnectionTimeoutError } from './errors/kernelConnectionTimeoutError';
import { logger } from '../platform/logging';
import { noop } from '../platform/common/utils/misc';
import { createDeferred } from '../platform/common/utils/async';

type ObserveRecovery = (event: StartupRecoveryRequestEvent) => void;

suite('Kernel startup no-progress recovery', () => {
    let clock: sinon.SinonFakeTimers;
    let token: CancellationTokenSource;
    let posted: EventEmitter<KernelMessage.IMessage>;
    let messages: Signal<Kernel.IKernelConnection, Kernel.IAnyMessageArgs>;
    let kernel: Kernel.IKernelConnection;
    let recovery: KernelStartupRecovery;
    let current: boolean;
    let pendingInput: boolean;
    let attempts: number;
    let attemptTokens: CancellationToken[];
    let kernelStatus: Kernel.Status;
    let statusChanged: Signal<Kernel.IKernelConnection, Kernel.Status>;

    setup(() => {
        clock = sinon.useFakeTimers();
        token = new CancellationTokenSource();
        posted = new EventEmitter<KernelMessage.IMessage>();
        const mocked = mock<Kernel.IKernelConnection>();
        kernel = instance(mocked);
        messages = new Signal(kernel);
        when(mocked.anyMessage).thenReturn(messages);
        when(mocked.hasPendingInput).thenCall(() => pendingInput);
        kernelStatus = 'idle';
        statusChanged = new Signal(kernel);
        when(mocked.status).thenCall(() => kernelStatus);
        when(mocked.statusChanged).thenReturn(statusChanged);
        current = true;
        pendingInput = false;
        attempts = 0;
        attemptTokens = [];
    });

    teardown(() => {
        recovery?.dispose();
        token.dispose();
        posted.dispose();
        sinon.restore();
    });

    function start(
        budget = 2000,
        probe: (value: CancellationToken, observe: ObserveRecovery) => Promise<void> = async () => undefined
    ) {
        recovery = new KernelStartupRecovery(
            kernel,
            posted.event,
            budget,
            token.token,
            async (value, _timeout, observe) => {
                attempts += 1;
                attemptTokens.push(value);
                await probe(value, observe);
            },
            () => current,
            LocalKernelSpecConnectionMetadata.create({
                id: 'fixture',
                kernelSpec: { name: 'python3', display_name: 'Fixture', argv: ['python'], executable: 'python' }
            })
        );
        return recovery;
    }

    function send() {
        const request = KernelMessage.createMessage({
            msgType: 'execute_request',
            channel: 'shell',
            username: 'test',
            session: 'client',
            content: { code: 'pass' }
        });
        posted.fire(request);
        return request;
    }

    function status(request: KernelMessage.IMessage, execution_state: 'busy' | 'idle') {
        const message: KernelMessage.IStatusMsg = {
            header: { ...request.header, msg_type: 'status' },
            channel: 'iopub',
            parent_header: request.header,
            metadata: {},
            content: { execution_state }
        };
        messages.emit({ direction: 'recv', msg: message });
    }

    function auxiliaryRequest(observe: ObserveRecovery) {
        const request = KernelMessage.createMessage({
            msgType: 'kernel_info_request',
            channel: 'shell',
            username: 'test',
            session: 'auxiliary',
            content: {}
        });
        observe({ requestId: request.header.msg_id, phase: 'created' });
        observe({ requestId: request.header.msg_id, phase: 'sent' });
        return request;
    }

    function reply(request: KernelMessage.IExecuteRequestMsg) {
        const message: KernelMessage.IExecuteReplyMsg = {
            header: { ...request.header, msg_type: 'execute_reply' },
            channel: 'shell',
            parent_header: request.header,
            metadata: {},
            content: { status: 'ok', execution_count: 1, payload: [], user_expressions: {} }
        };
        messages.emit({ direction: 'recv', msg: message });
    }

    test('healthy matching requests do not create recovery peers', async () => {
        start();
        for (let index = 0; index < 3; index += 1) {
            const request = send();
            status(request, 'busy');
            await clock.tickAsync(3000);
            reply(request);
            status(request, 'idle');
        }
        await recovery.finish();
        assert.strictEqual(attempts, 0);
        assert.strictEqual(recovery.remainingBudget, 2000);
    });

    test('wall-clock adjustments cannot reset or exhaust the no-progress budget', async () => {
        start(1000);
        send();
        await clock.tickAsync(100);
        clock.setSystemTime(Date.now() + 3600000);
        await clock.tickAsync(500);
        assert.strictEqual(recovery.remainingBudget, 400);
        recovery.throwIfFailed();
        clock.setSystemTime(Date.now() - 7200000);
        await clock.tickAsync(400);
        assert.throws(() => recovery.throwIfFailed(), KernelConnectionTimeoutError);
    });

    test('exhaustion rejects the independent failure channel and stops its timer', async () => {
        start(1000);
        let failure: unknown;
        void recovery.failure.catch((error: unknown) => (failure = error));
        send();
        await clock.tickAsync(1000);
        assert.instanceOf(failure, KernelConnectionTimeoutError);
        assert.strictEqual(clock.countTimers(), 0);
    });

    test('a pending request triggers recovery at the observation threshold, not before', async () => {
        start();
        send();
        await clock.tickAsync(499);
        assert.strictEqual(attempts, 0);
        await clock.tickAsync(1);
        assert.strictEqual(attempts, 1);
    });

    test('unrecoverable no-ack has an independent typed failure', async () => {
        start(1000);
        const failure = recovery.failure.catch((error: unknown) => error);
        send();
        await clock.tickAsync(1000);
        assert.instanceOf(await failure, KernelConnectionTimeoutError);
        assert.throws(() => recovery.throwIfFailed(), KernelConnectionTimeoutError);
        assert.strictEqual(clock.countTimers(), 0);
    });

    test('unrelated idle and reply do not acknowledge the original request', async () => {
        start(1000);
        const failure = recovery.failure.catch((error: unknown) => error);
        send();
        const unrelated = KernelMessage.createMessage({
            msgType: 'execute_request',
            channel: 'shell',
            username: 'other',
            session: 'other',
            content: { code: 'pass' }
        });
        status(unrelated, 'idle');
        reply(unrelated);
        await clock.tickAsync(1000);
        assert.instanceOf(await failure, KernelConnectionTimeoutError);
    });

    test('requests queued behind acknowledged busy work pause the budget', async () => {
        start(1000);
        const first = send();
        status(first, 'busy');
        const second = send();
        await clock.tickAsync(10000);
        assert.strictEqual(attempts, 0);
        assert.strictEqual(recovery.remainingBudget, 1000);
        reply(first);
        status(first, 'idle');
        await clock.tickAsync(500);
        assert.strictEqual(attempts, 1);
        status(second, 'busy');
        await clock.tickAsync(10000);
        assert.strictEqual(recovery.remainingBudget, 500);
    });

    test('an unrelated idle cannot release a busy original request', async () => {
        start(1000);
        const first = send();
        status(first, 'busy');
        send();
        const unrelated = KernelMessage.createMessage({
            msgType: 'kernel_info_request',
            channel: 'shell',
            username: 'other',
            session: 'other',
            content: {}
        });
        status(unrelated, 'idle');
        await clock.tickAsync(10000);
        assert.strictEqual(attempts, 0);
        assert.strictEqual(recovery.remainingBudget, 1000);
    });

    test('pending input pauses otherwise eligible no-progress time', async () => {
        start(1000);
        pendingInput = true;
        send();
        await clock.tickAsync(10000);
        assert.strictEqual(recovery.remainingBudget, 1000);
        assert.strictEqual(attempts, 0);
        pendingInput = false;
        await clock.tickAsync(1000);
        assert.isAtLeast(attempts, 1);
    });

    test('acknowledgement and a new phase do not replenish consumed budget', async () => {
        start(1000);
        const first = send();
        await clock.tickAsync(400);
        status(first, 'busy');
        await clock.tickAsync(10000);
        reply(first);
        status(first, 'idle');
        send();
        const failure = recovery.failure.catch((error: unknown) => error);
        await clock.tickAsync(600);
        assert.instanceOf(await failure, KernelConnectionTimeoutError);
    });

    test('only one auxiliary peer is in flight', async () => {
        start(3000, async () => new Promise<void>(noop));
        send();
        await clock.tickAsync(2500);
        assert.strictEqual(attempts, 1);
    });

    test('original progress keeps submitted auxiliary work owned through reply and matching idle', async () => {
        const gate = createDeferred<void>();
        let auxiliary: KernelMessage.IInfoRequestMsg | undefined;
        start(2000, async (_value, observe) => {
            auxiliary = auxiliaryRequest(observe);
            await gate.promise;
            observe({ requestId: auxiliary.header.msg_id, phase: 'reply' });
            observe({ requestId: auxiliary.header.msg_id, phase: 'closed' });
        });
        const request = send();
        await clock.tickAsync(500);
        status(request, 'busy');
        await clock.tickAsync(10000);
        assert.isNotTrue(attemptTokens[0].isCancellationRequested);
        reply(request);
        status(request, 'idle');
        if (!auxiliary) {
            throw new Error('Auxiliary request was not submitted');
        }
        status(auxiliary, 'busy');
        let finished = false;
        const completion = recovery.finish().then(() => (finished = true));
        gate.resolve();
        await clock.tickAsync(10000);
        assert.isFalse(finished, 'The private reply alone must not bypass matching auxiliary idle');
        status(auxiliary, 'idle');
        await completion;
        recovery.throwIfFailed();
        assert.isNotTrue(attemptTokens[0].isCancellationRequested);
        assert.strictEqual(attempts, 1);
    });

    test('a closed submitted auxiliary request remains bounded without recursive recovery peers', async () => {
        start(3000, async (_value, observe) => {
            const request = auxiliaryRequest(observe);
            observe({ requestId: request.header.msg_id, phase: 'closed' });
        });
        const request = send();
        await clock.tickAsync(500);
        reply(request);
        status(request, 'idle');
        let failure: unknown;
        void recovery.finish().catch((error: unknown) => (failure = error));
        await clock.tickAsync(1000);
        assert.strictEqual(attempts, 1);
        assert.isUndefined(failure);
        await clock.tickAsync(1500);
        assert.instanceOf(failure, KernelConnectionTimeoutError);
        assert.strictEqual(attempts, 1);
        assert.strictEqual(clock.countTimers(), 0);
    });

    test('a new original wait re-arms recovery while older auxiliary work is charging the budget', async () => {
        start(3000, async (_value, observe) => {
            const request = auxiliaryRequest(observe);
            observe({ requestId: request.header.msg_id, phase: 'closed' });
        });
        const first = send();
        await clock.tickAsync(500);
        reply(first);
        status(first, 'idle');
        send();
        await clock.tickAsync(499);
        assert.strictEqual(attempts, 1);
        await clock.tickAsync(1);
        assert.strictEqual(attempts, 2);
    });

    test('auxiliary idle without its private reply consumes only the remaining no-progress budget', async () => {
        let auxiliary: KernelMessage.IInfoRequestMsg | undefined;
        start(1000, async (_value, observe) => {
            auxiliary = auxiliaryRequest(observe);
            await new Promise<void>(noop);
        });
        const request = send();
        await clock.tickAsync(500);
        reply(request);
        status(request, 'idle');
        if (!auxiliary) {
            throw new Error('Auxiliary request was not submitted');
        }
        status(auxiliary, 'idle');
        let failure: unknown;
        void recovery.finish().catch((error: unknown) => (failure = error));
        await clock.tickAsync(500);
        assert.instanceOf(failure, KernelConnectionTimeoutError);
        assert.strictEqual(attempts, 1);
    });

    test('an unsent auxiliary request cannot poison healthy completed work', async () => {
        start(2000, async (_value, observe) => {
            observe({ requestId: 'unsent', phase: 'created' });
            observe({ requestId: 'unsent', phase: 'closed' });
            throw new Error('Fixture send failed before submission');
        });
        const request = send();
        await clock.tickAsync(500);
        reply(request);
        status(request, 'idle');
        await clock.tickAsync(5000);
        await recovery.finish();
        assert.strictEqual(attempts, 1);
        recovery.throwIfFailed();
    });

    test('healthy startup does not require an additional post-auxiliary barrier', async () => {
        start();
        const request = send();
        reply(request);
        status(request, 'idle');
        const ready = sinon.spy(async () => undefined);
        await recovery.finish(ready);
        assert.isFalse(ready.called);
    });

    test('cancellation rejects the independent channel and stops peers/timers', async () => {
        start();
        const failure = recovery.failure.catch((error: unknown) => error);
        send();
        await clock.tickAsync(500);
        token.cancel();
        assert.instanceOf(await failure, CancellationError);
        await clock.tickAsync(2000);
        assert.strictEqual(attempts, 1);
        assert.strictEqual(clock.countTimers(), 0);
    });

    test('a stale generation cannot start another peer', async () => {
        start();
        let failure: unknown;
        void recovery.failure.catch((error: unknown) => (failure = error));
        send();
        current = false;
        await clock.tickAsync(500);
        assert.instanceOf(failure, CancellationError);
        assert.strictEqual(attempts, 0);
        assert.strictEqual(clock.countTimers(), 0);
    });

    test('disposing unregisters observations and does not leave a heartbeat', async () => {
        start();
        recovery.dispose();
        send();
        await clock.tickAsync(10000);
        assert.strictEqual(attempts, 0);
        assert.strictEqual(clock.countTimers(), 0);
    });

    test('peer transport failures are logged and cannot manufacture startup success', async () => {
        const warning = sinon.spy(logger, 'warn');
        start(1000, async () => {
            throw new Error('fixture connection failed');
        });
        const failure = recovery.failure.catch((error: unknown) => error);
        send();
        await clock.tickAsync(1000);
        assert.instanceOf(await failure, KernelConnectionTimeoutError);
        assert.isTrue(warning.called);
    });

    test('an unresponsive recovery provider cannot hang completion forever', async () => {
        start(2000, async () => new Promise<void>(noop));
        const request = send();
        await clock.tickAsync(500);
        status(request, 'busy');
        reply(request);
        status(request, 'idle');
        const finished = recovery.finish().catch((error: unknown) => error);
        await clock.tickAsync(1500);
        assert.instanceOf(await finished, KernelConnectionTimeoutError);
    });

    test('short configured budgets are used as milliseconds', async () => {
        start(200);
        const failure = recovery.failure.catch((error: unknown) => error);
        send();
        await clock.tickAsync(100);
        assert.strictEqual(attempts, 1);
        await clock.tickAsync(100);
        assert.instanceOf(await failure, KernelConnectionTimeoutError);
    });

    test('final acknowledged busy work is not limited by the nearly spent no-ack budget', async () => {
        start(1000);
        const request = send();
        await clock.tickAsync(899);
        status(request, 'busy');
        reply(request);
        status(request, 'idle');
        kernelStatus = 'busy';
        let completed = false;
        const idle = recovery.waitForIdle().then(() => (completed = true));
        await clock.tickAsync(5000);
        assert.isFalse(completed);
        assert.strictEqual(recovery.remainingBudget, 101);
        kernelStatus = 'idle';
        statusChanged.emit('idle');
        await idle;
        assert.isTrue(completed);
    });

    test('cancellation also releases final readiness waiting', async () => {
        start();
        kernelStatus = 'busy';
        const idle = recovery.waitForIdle().catch((error: unknown) => error);
        token.cancel();
        assert.instanceOf(await idle, CancellationError);
        assert.strictEqual(clock.countTimers(), 0);
    });
});
