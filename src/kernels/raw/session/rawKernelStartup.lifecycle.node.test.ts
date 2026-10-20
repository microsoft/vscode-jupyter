// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import { CancellationError, CancellationTokenSource } from 'vscode';
import { DisplayOptions } from '../../displayOptions';
import { RawKernelStartupFixture } from '../../../test/datascience/rawKernelStartupFixture.node';
import {
    createRawStartupTestContext,
    initializeRawStartupTestApi
} from '../../../test/datascience/rawKernelStartupTestContext.node';
import { createDeferred, raceTimeoutError, sleep } from '../../../platform/common/utils/async';
import { noop } from '../../../platform/common/utils/misc';
import { KernelConnectionTimeoutError } from '../../errors/kernelConnectionTimeoutError';

(process.platform === 'win32' ? suite : suite.skip)('Raw kernel startup recovery lifecycle (native transport)', () => {
    let api: ReturnType<typeof initializeRawStartupTestApi>;
    setup(() => {
        api = initializeRawStartupTestApi();
    });
    teardown(() => api.dispose());

    test('healthy initialization does not create a recovery peer', async () => {
        const fixture = await new RawKernelStartupFixture(false).start();
        const context = createRawStartupTestContext(fixture);
        try {
            await context.kernel.start(new DisplayOptions(true));
            assert.strictEqual(fixture.recoveryIdentities.size, 0);
        } finally {
            await context.dispose();
        }
    }).timeout(5000);

    for (const mode of ['no subshell capability', 'non-IPython implementation', 'non-Python metadata'] as const) {
        test(`recovery is not enabled for ${mode}`, async () => {
            const fixture = await new RawKernelStartupFixture(false).start();
            fixture.supportsSubshells = mode !== 'no subshell capability';
            fixture.implementation = mode === 'non-IPython implementation' ? 'fixture' : 'ipython';
            const context = createRawStartupTestContext(
                fixture,
                3000,
                undefined,
                mode === 'non-Python metadata' ? 'julia' : 'python'
            );
            const cancellation = new CancellationTokenSource();
            try {
                await context.kernel.start(new DisplayOptions(true));
                assert.isUndefined(context.sessions[0].raw.createStartupRecovery(cancellation.token));
                assert.strictEqual(fixture.recoveryIdentities.size, 0);
            } finally {
                cancellation.dispose();
                await context.dispose();
            }
        }).timeout(5000);
    }

    test('a replaced raw-session lease cannot target the current transport', async () => {
        const fixture = await new RawKernelStartupFixture(false).start();
        const context = createRawStartupTestContext(fixture);
        const cancellation = new CancellationTokenSource();
        try {
            await context.kernel.start(new DisplayOptions(true));
            const first = context.sessions[0].raw.createStartupRecovery(cancellation.token);
            const second = context.sessions[0].raw.createStartupRecovery(cancellation.token);
            if (!first || !second) {
                throw new Error('Affected raw-session capability was not available');
            }
            assert.isFalse(first.isCurrent(), 'The replaced lease must no longer own this transport');
            assert.isTrue(second.isCurrent());
            assert.throws(() => first.throwIfFailed(), CancellationError);
            second.dispose();
            assert.strictEqual(fixture.recoveryIdentities.size, 0);
        } finally {
            cancellation.dispose();
            await context.dispose();
        }
    }).timeout(5000);

    test('acknowledged long work outlives the no-ack budget without recovery', async () => {
        const fixture = await new RawKernelStartupFixture(false, false, 1100).start();
        const context = createRawStartupTestContext(fixture, 1000);
        try {
            await raceTimeoutError(
                8000,
                new Error('Healthy busy startup did not finish'),
                context.kernel.start(new DisplayOptions(true))
            );
            assert.strictEqual(fixture.recoveryIdentities.size, 0);
            assert.strictEqual(context.kernel.status, 'idle');
        } finally {
            await context.dispose();
        }
    }).timeout(10000);

    test('review regression: cold raw restart initializes an acknowledged transport once', async () => {
        const fixture = await new RawKernelStartupFixture(false, false, 1100).start();
        const context = createRawStartupTestContext(fixture, 1000);
        let initializations = 0;
        let started = 0;
        let restarted = 0;
        context.kernel.addHook('didStart', async () => {
            initializations += 1;
        });
        const startedListener = context.kernel.onStarted(() => (started += 1));
        const restartedListener = context.kernel.onRestarted(() => (restarted += 1));
        try {
            assert.isUndefined(context.kernel.session, 'The restart must begin without an existing session');
            await raceTimeoutError(
                10000,
                new Error('Cold raw restart did not finish after acknowledged startup work'),
                context.kernel.restart()
            );
            assert.strictEqual(
                initializations,
                1,
                'Cold restart must not initialize the session returned by start twice'
            );
            assert.strictEqual(started, 1);
            assert.strictEqual(restarted, 1);
            assert.strictEqual(
                fixture.executions.filter((code) => code.includes('_VSCODE_sys.executable')).length,
                1,
                'The executable startup hook must run once for the new raw transport'
            );
            assert.strictEqual(fixture.recoveryIdentities.size, 0);
            assert.strictEqual(context.kernel.status, 'idle');
        } finally {
            startedListener.dispose();
            restartedListener.dispose();
            await context.dispose();
        }
    }).timeout(15000);

    test('unrecoverable startup terminates and closes the owned session before rejecting', async () => {
        const fixture = await new RawKernelStartupFixture(true, true).start();
        const context = createRawStartupTestContext(fixture, 1500);
        let published = 0;
        const listener = context.kernel.onStarted(() => (published += 1));
        try {
            let outcome = 'pending';
            let error: unknown;
            void context.kernel.start(new DisplayOptions(true)).then(
                () => (outcome = 'resolved'),
                (failure: unknown) => {
                    outcome = 'rejected';
                    error = failure;
                }
            );
            await sleep(1900);
            assert.strictEqual(outcome, 'rejected', 'No-progress startup must reject within its configured budget');
            assert.instanceOf(error, KernelConnectionTimeoutError);
            assert.strictEqual(published, 0);
            assert.isUndefined(context.kernel.session);
            assert.isTrue(context.sessions[0].wrapped.isDisposed);
            assert.strictEqual(fixture.openSocketCount, 0);
            assert.isAtLeast(fixture.recoveryIdentities.size, 1);
        } finally {
            listener.dispose();
            await context.dispose();
        }
    }).timeout(6000);

    test('review regression: failed raw startup waits for gated backend termination', async () => {
        const fixture = await new RawKernelStartupFixture(true, true).start();
        const context = createRawStartupTestContext(fixture, 1500);
        const backendStopStarted = createDeferred<void>();
        const releaseBackendStop = createDeferred<void>();
        const stopFixture = fixture.stop.bind(fixture);
        let gatedBackendStop: Promise<void> | undefined;
        let backendStopCalls = 0;
        fixture.stop = () => {
            backendStopCalls += 1;
            if (!gatedBackendStop) {
                gatedBackendStop = (async () => {
                    backendStopStarted.resolve();
                    await releaseBackendStop.promise;
                    await stopFixture();
                })();
            }
            return gatedBackendStop;
        };

        let outcome: 'pending' | 'resolved' | 'rejected' = 'pending';
        let failure: unknown;
        const startup = context.kernel.start(new DisplayOptions(true));
        void startup.then(
            () => (outcome = 'resolved'),
            (error: unknown) => {
                outcome = 'rejected';
                failure = error;
            }
        );
        try {
            await raceTimeoutError(
                5000,
                new Error('Failed startup did not begin stopping its owned backend'),
                backendStopStarted.promise
            );
            await sleep(1200);
            assert.strictEqual(
                outcome,
                'pending',
                'Failed startup must remain pending after the wrapper shutdown timeout until the backend stops'
            );
            assert.strictEqual(
                fixture.openSocketCount,
                4,
                'The gated backend must still own its sockets before its actual stop completes'
            );
            assert.strictEqual(backendStopCalls, 1, 'Failed-start cleanup must join one owned backend stop');

            releaseBackendStop.resolve();
            const error = await raceTimeoutError(
                4000,
                new Error('Failed startup did not reject after its backend stop completed'),
                startup.then(
                    () => {
                        throw new Error('Unrecoverable startup unexpectedly resolved');
                    },
                    (reason: unknown) => reason
                )
            );
            assert.strictEqual(outcome, 'rejected');
            assert.strictEqual(failure, error);
            assert.instanceOf(error, KernelConnectionTimeoutError);
            assert.strictEqual(fixture.openSocketCount, 0);
            assert.isUndefined(context.kernel.session);
        } finally {
            releaseBackendStop.resolve();
            await context.dispose();
        }
    }).timeout(10000);

    test('review regression: failed-start cleanup deadline blocks retry until actual termination', async () => {
        const fixture = await new RawKernelStartupFixture(true, true).start();
        const context = createRawStartupTestContext(fixture, 1500, () => new RawKernelStartupFixture(false).start());
        const backendStopStarted = createDeferred<void>();
        const releaseBackendStop = createDeferred<void>();
        const stopFixture = fixture.stop.bind(fixture);
        let gatedBackendStop: Promise<void> | undefined;
        fixture.stop = () => {
            if (!gatedBackendStop) {
                gatedBackendStop = (async () => {
                    backendStopStarted.resolve();
                    await releaseBackendStop.promise;
                    await stopFixture();
                })();
            }
            return gatedBackendStop;
        };
        const startup = context.kernel.start(new DisplayOptions(true));
        startup.catch(noop);
        try {
            await raceTimeoutError(
                5000,
                new Error('Failed startup did not begin stopping its owned backend'),
                backendStopStarted.promise
            );
            await sleep(5100);
            const failure = await raceTimeoutError(
                1000,
                new Error('Failed startup did not reject when its cleanup budget expired'),
                startup.then(
                    () => {
                        throw new Error('Unrecoverable startup unexpectedly resolved');
                    },
                    (error: unknown) => error
                )
            );
            assert.instanceOf(failure, KernelConnectionTimeoutError);
            assert.strictEqual(fixture.openSocketCount, 4);
            assert.strictEqual(context.fixtures.length, 1);
            const retryFailure = await context.kernel.start(new DisplayOptions(true)).then(
                () => {
                    throw new Error('Retry unexpectedly created a replacement transport');
                },
                (error: unknown) => error
            );
            assert.instanceOf(retryFailure, KernelConnectionTimeoutError);
            assert.strictEqual(
                context.fixtures.length,
                1,
                'Retry must not create a replacement transport while cleanup is unresolved'
            );

            releaseBackendStop.resolve();
            await raceTimeoutError(3000, new Error('Gated backend did not stop after release'), gatedBackendStop!);
            await Promise.resolve();
            const restarted = await raceTimeoutError(
                6000,
                new Error('Raw startup remained blocked after actual termination'),
                context.kernel.start(new DisplayOptions(true))
            );
            assert.strictEqual(context.kernel.session, restarted);
            assert.strictEqual(context.fixtures.length, 2);
            assert.strictEqual(context.fixtures[1].openSocketCount, 4);
        } finally {
            releaseBackendStop.resolve();
            await context.dispose();
        }
    }).timeout(15000);

    test('cancellation while recovering closes the underlying work', async () => {
        const fixture = await new RawKernelStartupFixture(true, true).start();
        const context = createRawStartupTestContext(fixture);
        const startup = context.kernel.start(new DisplayOptions(true));
        startup.catch(noop);
        try {
            await raceTimeoutError(
                3000,
                new Error('No recovery attempt'),
                (async () => {
                    while (fixture.recoveryIdentities.size === 0) {
                        await sleep(10);
                    }
                })()
            );
            await context.kernel.dispose();
            const error = await startup.catch((error: unknown) => error);
            assert.instanceOf(error, CancellationError);
            assert.strictEqual(fixture.openSocketCount, 0);
            assert.isUndefined(context.kernel.session);
        } finally {
            await context.dispose();
        }
    }).timeout(6000);

    test('restart recovers on a fresh transport, without keeping the old peer alive', async () => {
        const fixture = await new RawKernelStartupFixture(true).start();
        const context = createRawStartupTestContext(fixture, 3000, () => fixture.fork());
        let restarted = 0;
        const listener = context.kernel.onRestarted(() => (restarted += 1));
        try {
            await context.kernel.start(new DisplayOptions(true));
            await context.kernel.restart();
            assert.strictEqual(restarted, 1);
            assert.strictEqual(context.fixtures.length, 2);
            assert.strictEqual(context.fixtures[0].openSocketCount, 0);
            assert.isAtLeast(context.fixtures[1].recoveryIdentities.size, 1);
            assert.strictEqual(context.kernel.status, 'idle');
        } finally {
            listener.dispose();
            await context.dispose();
        }
    }).timeout(8000);

    test('review regression: non-raw restart initialization failure preserves its published session', async () => {
        const fixture = await new RawKernelStartupFixture(false).start();
        const context = createRawStartupTestContext(fixture, 3000, () => fixture.fork());
        const expected = new Error('Non-raw restart initialization failed');
        let restarted = 0;
        const restartedListener = context.kernel.onRestarted(() => (restarted += 1));
        let kindStub: sinon.SinonStub | undefined;
        let idleStub: sinon.SinonStub | undefined;
        try {
            const published = await context.kernel.start(new DisplayOptions(true));
            const wrapped = context.sessions[0].wrapped;
            kindStub = sinon.stub(wrapped, 'kind').value('remoteJupyter');
            idleStub = sinon.stub(wrapped, 'waitForIdle').rejects(expected);

            const failure = await context.kernel.restart().catch((error: unknown) => error);
            assert.strictEqual(failure, expected);
            assert.strictEqual(context.kernel.session, published);
            assert.isFalse(wrapped.isDisposed);
            assert.strictEqual(restarted, 0);
            assert.strictEqual(context.fixtures.length, 2);
            assert.strictEqual(context.fixtures[1].openSocketCount, 4);
        } finally {
            idleStub?.restore();
            kindStub?.restore();
            restartedListener.dispose();
            await context.dispose();
        }
    }).timeout(8000);

    test('review regression: stale warm restart initialization cannot dispose the newer transport', async () => {
        const fixture = await new RawKernelStartupFixture(false).start();
        const context = createRawStartupTestContext(fixture, 3000, () => fixture.fork());
        const entered = createDeferred<void>();
        const gate = createDeferred<void>();
        let initializations = 0;
        let restarted = 0;
        let hook: { dispose(): void } | undefined;
        let restartedListener: { dispose(): void } | undefined;
        try {
            await context.kernel.start(new DisplayOptions(true));
            hook = context.kernel.addHook('didStart', async () => {
                if (++initializations === 1) {
                    entered.resolve();
                    await gate.promise;
                }
            });
            restartedListener = context.kernel.onRestarted(() => (restarted += 1));
            const firstRestart = context.kernel.restart();
            firstRestart.catch(noop);
            await raceTimeoutError(3000, new Error('First warm restart did not enter initialization'), entered.promise);
            const refused = await context.kernel.restart().catch((error: unknown) => error);
            assert.instanceOf(refused, KernelConnectionTimeoutError);
            assert.strictEqual(restarted, 0);
            gate.resolve();
            const firstFailure = await firstRestart.catch((error: unknown) => error);
            assert.instanceOf(firstFailure, CancellationError);
            await raceTimeoutError(
                8000,
                new Error('Fresh restart did not complete after old cleanup confirmed'),
                context.kernel.restart()
            );
            assert.strictEqual(restarted, 1);
            assert.isDefined(context.kernel.session);
            assert.strictEqual(context.kernel.status, 'idle');
            assert.strictEqual(context.fixtures.length, 3);
            assert.strictEqual(context.fixtures.filter((item) => item.openSocketCount === 4).length, 1);
            assert.strictEqual(context.fixtures[2].openSocketCount, 4);
        } finally {
            gate.resolve();
            hook?.dispose();
            restartedListener?.dispose();
            await context.dispose();
        }
    }).timeout(12000);

    test('a delayed auxiliary reply cannot defeat recovered long execution', async () => {
        const fixture = await new RawKernelStartupFixture(true, false, 1100).start();
        const context = createRawStartupTestContext(fixture, 2000);
        try {
            await raceTimeoutError(
                8000,
                new Error('Recovered busy startup was treated as failed'),
                context.kernel.start(new DisplayOptions(true))
            );
            assert.strictEqual(fixture.recoveryIdentities.size, 1);
            assert.strictEqual(context.kernel.status, 'idle');
            const statuses: string[] = [];
            const listener = context.kernel.onStatusChanged((status) => statuses.push(status));
            try {
                await sleep(600);
                assert.isEmpty(statuses, 'Owned auxiliary status must not arrive after startup publication');
            } finally {
                listener.dispose();
            }
        } finally {
            await context.dispose();
        }
    }).timeout(10000);

    test('startup owns submitted auxiliary work until its delayed server dispatch completes', async () => {
        const fixture = await new RawKernelStartupFixture().start();
        fixture.recoveryDispatchDelay = 500;
        const context = createRawStartupTestContext(fixture, 2000);
        try {
            await context.kernel.start(new DisplayOptions(true));
            assert.strictEqual(
                fixture.pendingRecoveryRequests,
                0,
                'Startup must not publish while its already-submitted auxiliary request remains queued'
            );
            assert.strictEqual(fixture.recoveryIdentities.size, 1);
            assert.strictEqual(context.kernel.status, 'idle');
        } finally {
            await context.dispose();
        }
    }).timeout(8000);

    test('a new original stall recovers while earlier submitted auxiliary work is still queued', async () => {
        const fixture = await new RawKernelStartupFixture().start();
        fixture.holdFirstRecovery = true;
        const context = createRawStartupTestContext(fixture, 4000);
        try {
            await context.kernel.start(new DisplayOptions(true));
            assert.strictEqual(fixture.recoveryIdentities.size, 2);
            assert.strictEqual(fixture.pendingRecoveryRequests, 0);
            assert.strictEqual(context.kernel.status, 'idle');
        } finally {
            await context.dispose();
        }
    }).timeout(7000);

    test('a new peer during the fresh readiness barrier requires another primary barrier', async () => {
        const fixture = await new RawKernelStartupFixture().start();
        fixture.stallSecondRecoveryInfo = true;
        const context = createRawStartupTestContext(fixture, 4000);
        try {
            await context.kernel.start(new DisplayOptions(true));
            assert.strictEqual(fixture.recoveryIdentities.size, 2);
            assert.isAtLeast(fixture.recoveryKernelInfoRequests, 3);
            assert.strictEqual(fixture.lastDispatched, 'primary-info');
            assert.strictEqual(fixture.pendingRecoveryRequests, 0);
            assert.strictEqual(context.kernel.status, 'idle');
        } finally {
            await context.dispose();
        }
    }).timeout(7000);

    for (const mode of ['incorrect parent', 'no reply', 'incorrect type', 'invalid signature'] as const) {
        test(`an auxiliary ${mode} cannot manufacture successful startup`, async () => {
            const fixture = await new RawKernelStartupFixture(true, true).start();
            fixture.invalidRecoveryReply = mode === 'incorrect parent';
            fixture.ignoreRecoveryReplies = mode === 'no reply';
            fixture.invalidRecoveryType = mode === 'incorrect type';
            fixture.invalidRecoverySignature = mode === 'invalid signature';
            const context = createRawStartupTestContext(fixture, 2500);
            try {
                await context.kernel.start(new DisplayOptions(true)).then(() => {
                    throw new Error('Invalid recovery falsely succeeded');
                }, noop);
                assert.isUndefined(context.kernel.session);
                assert.strictEqual(fixture.openSocketCount, 0);
                assert.isAtLeast(fixture.recoveryIdentities.size, 1);
            } finally {
                await context.dispose();
            }
        }).timeout(6000);
    }

    test('recovery does not remain active for ordinary post-startup execution', async () => {
        const fixture = await new RawKernelStartupFixture(false).start();
        const context = createRawStartupTestContext(fixture);
        try {
            const session = await context.kernel.start(new DisplayOptions(true));
            fixture.stallNextExecution = true;
            const request = session.kernel!.requestExecute({ code: 'pass' });
            request.done.catch(noop);
            let completed = false;
            void request.done.then(() => (completed = true), noop);
            await sleep(700);
            assert.isFalse(completed);
            assert.strictEqual(fixture.recoveryIdentities.size, 0);
        } finally {
            await context.dispose();
        }
    }).timeout(5000);

    test('an old swallowed hook cannot publish or dispose a newer successful attempt', async () => {
        const fixture = await new RawKernelStartupFixture(true, true).start();
        const context = createRawStartupTestContext(fixture, 1500, () => new RawKernelStartupFixture(false).start());
        const gate = createDeferred<void>();
        let calls = 0;
        context.kernel.addHook('didStart', async () => {
            if (++calls === 1) {
                await gate.promise;
            }
        });
        let published = 0;
        const listener = context.kernel.onStarted(() => (published += 1));
        try {
            await context.kernel.start(new DisplayOptions(true)).then(() => {
                throw new Error('Expected old startup failure');
            }, noop);
            const newer = await context.kernel.start(new DisplayOptions(true));
            gate.resolve();
            await sleep(50);
            assert.strictEqual(published, 1);
            assert.strictEqual(context.kernel.session, newer);
            assert.strictEqual(context.kernel.status, 'idle');
            assert.isTrue(context.sessions[0].wrapped.isDisposed);
            assert.strictEqual(context.fixtures[0].openSocketCount, 0);
            assert.strictEqual(context.fixtures[1].openSocketCount, 4);
        } finally {
            gate.resolve();
            listener.dispose();
            await context.dispose();
        }
    }).timeout(8000);
});
