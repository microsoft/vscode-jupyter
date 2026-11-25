// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { createDeferred, raceTimeout, sleep } from '../../../platform/common/utils/async';
import { RawStartupFixture } from '../../../test/kernels/rawStartup.node';
import { KernelConnectionTimeoutError } from '../../errors/kernelConnectionTimeoutError';
import { KernelProcessExitedError } from '../../errors/kernelProcessExitedError';
import { StartOptions } from '../../displayOptions';
import { CancellationError, CancellationTokenSource } from 'vscode';

// Fast deterministic regression coverage of the production RawSocket, RawSessionConnection,
// and Kernel against StartupPeer over loopback ZMQ: handshake, no-progress budget, and restart supersession.
// The budget counts unacknowledged, non-busy time; acknowledged busy work pauses it.
suite('Raw Kernel Startup Recovery', function () {
    this.timeout(12000);
    let fixture: RawStartupFixture;

    teardown(async () => {
        await fixture?.dispose();
        assert.deepEqual(fixture?.errors, []);
    });

    // A fresh peer unblocks the withheld original request, which runs exactly once before the first cell.
    test('recovers the original startup execution through a fresh peer and runs the first cell', async () => {
        fixture = new RawStartupFixture('execute');
        await fixture.initialize();
        const started = await raceTimeout(4500, fixture.start());
        assert.isDefined(started, 'The original startup request remained queued without a fresh recovery peer');
        assert.isTrue(fixture.peer.peers.size > 0);
        assert.strictEqual(fixture.startedEvents, 1);
        assert.strictEqual(fixture.kernel.session, started);
        assert.strictEqual(fixture.peer.executionCounts.get(fixture.firstExecutionId!), 1);
        const peers = fixture.peer.peers.size;
        await fixture.firstCell();
        assert.strictEqual(fixture.peer.peers.size, peers, 'Recovery continued after startup');
        assert.strictEqual(fixture.kernel.status, 'idle');
    });

    // Cached kernel info cannot publish readiness while the fresh readiness request is withheld.
    test('does not publish cached readiness while a fresh kernel-info request is queued', async () => {
        fixture = new RawStartupFixture('final-info');
        await fixture.initialize();
        const startup = fixture.start();
        assert.isDefined(
            await raceTimeout(
                2000,
                fixture.peer.gated.promise.then(() => true)
            )
        );
        const early = await raceTimeout(
            100,
            startup.then(() => true)
        );
        assert.isUndefined(early, 'Cached kernel info bypassed the pending fresh readiness request');
        assert.isUndefined(fixture.kernel.session);
        assert.strictEqual(fixture.startedEvents, 0);
        assert.isDefined(await raceTimeout(4000, startup));
        await fixture.firstCell();
        assert.strictEqual(fixture.startedEvents, 1);
    });

    // Disabling recovery preserves normal startup and does not create a probe peer.
    test('a raw Python kernel without startup recovery starts normally', async () => {
        fixture = new RawStartupFixture('none', 6000, false);
        await fixture.initialize();
        assert.isDefined(await raceTimeout(5000, fixture.start()));
        assert.isUndefined(fixture.session.startup);
        assert.strictEqual(fixture.startedEvents, 1);
        assert.strictEqual(fixture.peer.peers.size, 0);
        await fixture.firstCell();
    });

    // Healthy startup completes without an unnecessary recovery peer.
    test('healthy startup does not create a recovery peer', async () => {
        fixture = new RawStartupFixture('none');
        await fixture.initialize();
        assert.isDefined(await raceTimeout(2500, fixture.start()));
        assert.strictEqual(fixture.peer.peers.size, 0);
        await fixture.firstCell();
        assert.strictEqual(fixture.startedEvents, 1);
    });

    // An unrecoverable stall exhausts the no-progress budget without publishing a session.
    test('an unrecoverable startup fails when the communication budget is exhausted without publishing', async () => {
        fixture = new RawStartupFixture('unrecoverable', 1800);
        await fixture.initialize();
        const error = await fixture.start().then(
            () => undefined,
            (reason) => reason
        );
        assert.instanceOf(error, KernelConnectionTimeoutError);
        assert.strictEqual(fixture.startedEvents, 0);
        assert.isUndefined(fixture.kernel.session);
        assert.isTrue(fixture.peer.isDisposed);
    });

    // A missing warm-up idle does not prevent a later fresh readiness exchange.
    test('an abandoned warm-up idle does not block a subsequent fresh readiness exchange', async () => {
        fixture = new RawStartupFixture('none');
        await fixture.initialize();
        fixture.peer.omitFirstWarmIdle = true;
        assert.isDefined(await raceTimeout(3000, fixture.start()));
        await fixture.firstCell();
        assert.strictEqual(fixture.startedEvents, 1);
    });

    // A probe without acknowledgement cannot bypass quiescence even if the original execution ran.
    test('an accepted auxiliary request with no acknowledgement cannot bypass quiescence', async () => {
        fixture = new RawStartupFixture('execute', 2800);
        await fixture.initialize();
        fixture.peer.omitFirstAuxiliaryAck = true;
        const error = await fixture.start().then(
            () => undefined,
            (reason) => reason
        );
        assert.instanceOf(error, KernelConnectionTimeoutError);
        assert.strictEqual(fixture.peer.executionCounts.get(fixture.firstExecutionId!), 1);
        assert.isUndefined(fixture.kernel.session);
        assert.strictEqual(fixture.startedEvents, 0);
    });

    // Process exit during readiness retains its specific error and lifecycle ordering.
    test('a real process-exit ordering during readiness preserves the process-exit error', async () => {
        fixture = new RawStartupFixture('none');
        await fixture.initialize();
        fixture.peer.exitOnRequest = true;
        const lifecycle: string[] = [];
        fixture.peer.exited(() => lifecycle.push('exited'));
        fixture.peer.onDidDispose(() => lifecycle.push('disposed'));
        const cancellation = new CancellationTokenSource();
        try {
            const error = await fixture.session.startKernel({ token: cancellation.token }).then(
                () => undefined,
                (reason) => reason
            );
            assert.instanceOf(error, KernelProcessExitedError);
            assert.deepEqual(lifecycle, ['exited', 'disposed']);
        } finally {
            cancellation.dispose();
        }
    });

    // Cancelling stalled startup disposes its process and never publishes the session.
    test('cancellation disposes the unpublished session and its pending future', async () => {
        fixture = new RawStartupFixture('execute');
        await fixture.initialize();
        const result = fixture.start().then(
            () => undefined,
            (error) => error
        );
        await fixture.peer.gated.promise;
        await fixture.kernel.dispose();
        assert.instanceOf(await result, Error);
        assert.isTrue(fixture.peer.isDisposed);
        assert.isUndefined(fixture.kernel.session);
        assert.strictEqual(fixture.startedEvents, 0);
    });

    // A late start hook cannot publish a session after cancellation.
    test('a late swallowed hook cannot publish a cancelled session', async () => {
        fixture = new RawStartupFixture('none', 1000);
        await fixture.initialize();
        const hook = createDeferred<void>();
        fixture.kernel.addHook('didStart', async () => hook.promise);
        const result = fixture.start().then(
            () => undefined,
            (reason) => reason
        );
        // Let startup reach the blocking hook, then cancel while it is still pending.
        await sleep(100);
        await fixture.kernel.dispose();
        hook.resolve();
        await sleep(10);
        const error = await result;
        assert.instanceOf(error, Error);
        assert.isUndefined(fixture.kernel.session);
        assert.strictEqual(fixture.startedEvents, 0);
    });

    // Restart uses the new socket and recovers its own queued execution.
    test('restart resolves the new socket and recovers the new original execution', async () => {
        fixture = new RawStartupFixture('execute');
        await fixture.initialize();
        await fixture.start();
        const original = fixture.peer;
        const originalPeers = original.peers.size;
        let restarted = 0;
        fixture.kernel.onRestarted(() => restarted++);
        assert.isDefined(
            await raceTimeout(
                5000,
                fixture.kernel.restart().then(() => true)
            )
        );
        assert.notStrictEqual(fixture.peer, original);
        assert.isTrue(fixture.peer.peers.size > 0);
        assert.strictEqual(original.peers.size, originalPeers);
        assert.strictEqual(restarted, 1);
        await fixture.firstCell();
    });

    // A later initialization stall requires another fresh recovery peer.
    test('a later initialization stall requires a different fresh peer', async () => {
        fixture = new RawStartupFixture('execute');
        await fixture.initialize();
        fixture.peer.additionalExecutionGate = 3;
        await fixture.start();
        assert.isTrue(fixture.peer.peers.size >= 2);
        await fixture.firstCell();
    });

    // A cold restart initializes and publishes its completed context only once.
    test('restarting before the first start does not initialize the completed context twice', async () => {
        fixture = new RawStartupFixture('execute');
        await fixture.initialize();
        await fixture.kernel.restart();
        assert.strictEqual(fixture.startedEvents, 1);
        assert.isDefined(fixture.kernel.session);
        await fixture.firstCell();
    });

    // A newer restart cancels the hook-blocked older one without duplicate launches or success events.
    test('a newer restart supersedes one waiting for willRestart hooks', async () => {
        fixture = new RawStartupFixture('none');
        fixture.startupCommands.push('review-restart-command');
        await fixture.initialize();
        await fixture.start();

        const hookEntered = createDeferred<void>();
        const releaseHook = createDeferred<void>();
        let willRestartCalls = 0;
        let didStartCalls = 0;
        let restartedEvents = 0;
        fixture.kernel.addHook('willRestart', async () => {
            willRestartCalls += 1;
            if (willRestartCalls === 1) {
                hookEntered.resolve();
                await releaseHook.promise;
            }
        });
        fixture.kernel.addHook('didStart', async () => {
            didStartCalls += 1;
        });
        fixture.kernel.onRestarted(() => (restartedEvents += 1));

        const baselineLaunches = fixture.launches;
        const baselineCommands = fixture.executionCount('review-restart-command');
        const first = fixture.kernel.restart().then(
            () => undefined,
            (error) => error
        );
        assert.isTrue(
            await raceTimeout(
                2000,
                hookEntered.promise.then(() => true)
            )
        );
        const second = fixture.kernel.restart().then(
            () => true,
            (error) => error
        );
        try {
            assert.instanceOf(await raceTimeout(4000, first), CancellationError);
            assert.isTrue(await raceTimeout(4000, second));
        } finally {
            releaseHook.resolve();
        }
        assert.strictEqual(willRestartCalls, 2);
        assert.strictEqual(didStartCalls, 1);
        assert.strictEqual(restartedEvents, 1);
        assert.strictEqual(fixture.launches, baselineLaunches + 1);
        assert.strictEqual(fixture.executionCount('review-restart-command'), baselineCommands + 1);
        await fixture.firstCell();
    });

    // A newer restart shares the in-flight transport but cancels older initialization without duplicate events.
    test('a newer restart shares an in-flight transport but supersedes initialization', async () => {
        fixture = new RawStartupFixture('none');
        await fixture.initialize();
        await fixture.start();

        let didStartCalls = 0;
        let restartedEvents = 0;
        fixture.kernel.addHook('didStart', async () => {
            didStartCalls += 1;
        });
        fixture.kernel.onRestarted(() => (restartedEvents += 1));
        const baselineLaunches = fixture.launches;
        const transport = fixture.deferNextLaunch();
        const secondHookEntered = createDeferred<void>();
        let hookCalls = 0;
        fixture.kernel.addHook('willRestart', async () => {
            hookCalls += 1;
            if (hookCalls === 2) {
                secondHookEntered.resolve();
            }
        });
        const first = fixture.kernel.restart().then(
            () => undefined,
            (error) => error
        );
        assert.isTrue(
            await raceTimeout(
                2000,
                transport.entered.then(() => true)
            )
        );
        const second = fixture.kernel.restart().then(
            () => undefined,
            (error) => error
        );
        try {
            assert.isTrue(
                await raceTimeout(
                    2000,
                    secondHookEntered.promise.then(() => true)
                )
            );
            await sleep(20);
        } finally {
            transport.release();
        }

        const results = await raceTimeout(4000, Promise.all([first, second]));
        assert.isDefined(results);
        assert.instanceOf(results![0], CancellationError);
        assert.isUndefined(results![1]);
        assert.strictEqual(fixture.launches, baselineLaunches + 1);
        assert.strictEqual(didStartCalls, 1);
        assert.strictEqual(restartedEvents, 1);
        await fixture.firstCell();
    });

    // A newer restart supersedes stuck initialization without losing its session or firing extra events.
    test('a never-settling initialization does not wedge later restarts', async () => {
        fixture = new RawStartupFixture('none');
        await fixture.initialize();
        await fixture.start();

        const entered = createDeferred<void>();
        const release = createDeferred<void>();
        let calls = 0;
        let restarted = 0;
        fixture.kernel.addHook('didStart', async () => {
            calls += 1;
            if (calls === 1) {
                entered.resolve();
                await release.promise;
            }
        });
        fixture.kernel.onRestarted(() => restarted++);
        const first = fixture.kernel.restart().then(
            () => undefined,
            (error) => error
        );
        try {
            assert.isTrue(
                await raceTimeout(
                    2000,
                    entered.promise.then(() => true)
                )
            );
            assert.isUndefined(
                await raceTimeout(
                    100,
                    first.then(() => true)
                )
            );
            const second = fixture.kernel.restart().then(
                () => true,
                (error) => error
            );
            assert.instanceOf(await raceTimeout(4000, first), CancellationError);
            assert.isTrue(await raceTimeout(4000, second));
            const session = fixture.kernel.session;
            const peer = fixture.peer;
            assert.isDefined(session);
            await fixture.firstCell();
            release.resolve();
            await sleep(50);
            assert.strictEqual(fixture.kernel.session, session);
            assert.isFalse(peer.isDisposed);
            assert.strictEqual(restarted, 1);
            assert.strictEqual(fixture.startedEvents, 1);
            await fixture.firstCell();
        } finally {
            release.resolve();
        }
    });

    // A newer cold restart cancels the unpublished initializer without disturbing its replacement session.
    test('a superseding cold restart releases a stuck unpublished initializer', async () => {
        fixture = new RawStartupFixture('none');
        await fixture.initialize();
        const entered = createDeferred<void>();
        const release = createDeferred<void>();
        let calls = 0;
        let restarted = 0;
        fixture.kernel.addHook('didStart', async () => {
            calls += 1;
            if (calls === 1) {
                entered.resolve();
                await release.promise;
            }
        });
        fixture.kernel.onRestarted(() => restarted++);
        const first = fixture.kernel.restart().then(
            () => undefined,
            (error) => error
        );
        try {
            assert.isTrue(
                await raceTimeout(
                    2000,
                    entered.promise.then(() => true)
                )
            );
            const second = fixture.kernel.restart().then(
                () => true,
                (error) => error
            );
            assert.instanceOf(await raceTimeout(4000, first), CancellationError);
            assert.isTrue(await raceTimeout(4000, second));
            const session = fixture.kernel.session;
            const peer = fixture.peer;
            await fixture.firstCell();
            release.resolve();
            await sleep(50);
            assert.strictEqual(fixture.kernel.session, session);
            assert.isFalse(peer.isDisposed);
            assert.strictEqual(fixture.startedEvents, 1);
            assert.strictEqual(restarted, 1);
        } finally {
            release.resolve();
        }
    });

    // A restart whose owned session dies rejects, cleans up, and emits no success event.
    test('restart rejects and disposes the generation when its owned raw session dies during initialization', async () => {
        fixture = new RawStartupFixture('none');
        await fixture.initialize();
        await fixture.start();

        const initializationEntered = createDeferred<void>();
        const releaseInitialization = createDeferred<void>();
        const peerDisposed = createDeferred<void>();
        let restartedEvents = 0;
        fixture.kernel.addHook('didStart', async () => {
            initializationEntered.resolve();
            await releaseInitialization.promise;
        });
        fixture.kernel.onRestarted(() => (restartedEvents += 1));
        fixture.peer.onDidDispose(() => peerDisposed.resolve());

        const restart = fixture.kernel.restart().then(
            () => undefined,
            (error) => error
        );
        try {
            assert.isTrue(
                await raceTimeout(
                    2000,
                    initializationEntered.promise.then(() => true)
                )
            );
            const ownedSession = fixture.kernel.session;
            assert.isDefined(ownedSession);
            ownedSession!.dispose();
            assert.isTrue(
                await raceTimeout(
                    2000,
                    peerDisposed.promise.then(() => true)
                )
            );
        } finally {
            releaseInitialization.resolve();
            await raceTimeout(4000, restart);
        }

        assert.instanceOf(
            await raceTimeout(4000, restart),
            Error,
            'The restart operation succeeded after its owned session died during initialization'
        );
        assert.strictEqual(restartedEvents, 0);
        assert.isUndefined(fixture.kernel.session);
    });

    // A newer restart supersedes a stuck post-start wait without disrupting its replacement session.
    test('a never-settling post-start waitUntil does not wedge later restarts', async () => {
        fixture = new RawStartupFixture('none');
        await fixture.initialize();
        await fixture.start();

        const entered = createDeferred<void>();
        const release = createDeferred<void>();
        let postInitializedEvents = 0;
        let restarted = 0;
        fixture.kernel.onRestarted(() => restarted++);
        fixture.kernel.onPostInitialized((event) => {
            postInitializedEvents += 1;
            const firstEvent = postInitializedEvents === 1;
            event.waitUntil(
                (async () => {
                    await fixture.kernel.restarting;
                    await fixture.kernel.start(new StartOptions(false, true));
                    await fixture.executeCell('review-post-initialized-handler');
                    if (firstEvent) {
                        entered.resolve();
                        await release.promise;
                    }
                })()
            );
        });

        const first = fixture.kernel.restart().then(
            () => undefined,
            (error) => error
        );
        try {
            assert.isTrue(
                await raceTimeout(
                    2000,
                    entered.promise.then(() => true)
                )
            );
            assert.isUndefined(
                await raceTimeout(
                    100,
                    first.then(() => true)
                )
            );
            const second = fixture.kernel.restart().then(
                () => true,
                (error) => error
            );
            assert.instanceOf(await raceTimeout(4000, first), CancellationError);
            assert.isTrue(await raceTimeout(4000, second));
            const session = fixture.kernel.session;
            const peer = fixture.peer;
            await fixture.firstCell();
            release.resolve();
            await sleep(50);
            assert.strictEqual(fixture.kernel.session, session);
            assert.isFalse(peer.isDisposed);
            assert.strictEqual(postInitializedEvents, 2);
            assert.strictEqual(restarted, 2);
            assert.strictEqual(fixture.executionCount('review-post-initialized-handler'), 2);
            assert.isFalse(fixture.kernel.isPostInitializedInProgress);
        } finally {
            release.resolve();
        }
    });

    // Late completion from a superseded restart cannot clear the newer post-start handler.
    test('a late post-start completion does not clear a newer handler in progress', async () => {
        fixture = new RawStartupFixture('none');
        await fixture.initialize();
        await fixture.start();
        const entered = [createDeferred<void>(), createDeferred<void>()];
        const release = [createDeferred<void>(), createDeferred<void>()];
        let count = 0;
        fixture.kernel.onPostInitialized((event) => {
            const index = count++;
            entered[index].resolve();
            event.waitUntil(release[index].promise);
        });
        const first = fixture.kernel.restart().then(
            () => undefined,
            (error) => error
        );
        try {
            assert.isTrue(
                await raceTimeout(
                    2000,
                    entered[0].promise.then(() => true)
                )
            );
            const second = fixture.kernel.restart().then(
                () => true,
                (error) => error
            );
            assert.instanceOf(await raceTimeout(4000, first), CancellationError);
            assert.isTrue(
                await raceTimeout(
                    4000,
                    entered[1].promise.then(() => true)
                )
            );
            release[0].resolve();
            await sleep(20);
            assert.isTrue(fixture.kernel.isPostInitializedInProgress);
            release[1].resolve();
            assert.isTrue(await raceTimeout(4000, second));
            await fixture.firstCell();
        } finally {
            release.forEach((item) => item.resolve());
        }
    });

    // Disposal cancels a restart blocked in a post-start handler.
    test('disposing releases a restart blocked in a post-start handler', async () => {
        fixture = new RawStartupFixture('none');
        await fixture.initialize();
        await fixture.start();
        const entered = createDeferred<void>();
        const release = createDeferred<void>();
        fixture.kernel.onPostInitialized((event) => {
            entered.resolve();
            event.waitUntil(release.promise);
        });
        const restart = fixture.kernel.restart().then(
            () => undefined,
            (error) => error
        );
        try {
            assert.isTrue(
                await raceTimeout(
                    2000,
                    entered.promise.then(() => true)
                )
            );
            await fixture.kernel.dispose();
            assert.instanceOf(await raceTimeout(4000, restart), CancellationError);
        } finally {
            release.resolve();
        }
    });

    // Disposal during transport cancels restart without emitting a success event.
    test('Review regression restart cancellation during transport rejects without a success event', async () => {
        fixture = new RawStartupFixture('none');
        await fixture.initialize();
        await fixture.start();

        const transport = fixture.deferNextLaunch();
        let restartedEvents = 0;
        fixture.kernel.onRestarted(() => (restartedEvents += 1));
        const restart = fixture.kernel.restart().then(
            () => undefined,
            (error) => error
        );
        assert.isTrue(
            await raceTimeout(
                2000,
                transport.entered.then(() => true)
            )
        );
        const disposal = fixture.kernel.dispose().then(
            () => undefined,
            (error) => error
        );
        transport.release();

        const restartError = await raceTimeout(4000, restart);
        assert.instanceOf(restartError, CancellationError);
        assert.strictEqual(restartedEvents, 0);
        assert.isTrue(fixture.kernel.disposed);
        assert.isTrue(
            await raceTimeout(
                4000,
                disposal.then(() => true)
            )
        );
    });

    // A failed superseding restart leaves the kernel able to retry successfully.
    test('a failed superseding restart permits a fresh retry', async () => {
        fixture = new RawStartupFixture('none');
        await fixture.initialize();
        await fixture.start();

        const entered = createDeferred<void>();
        const release = createDeferred<void>();
        const expectedFailure = new Error('review restart failure');
        let shouldFail = true;
        let hooks = 0;
        fixture.kernel.addHook('willRestart', async () => {
            hooks += 1;
            if (hooks === 1) {
                entered.resolve();
                await release.promise;
            }
            if (shouldFail) {
                throw expectedFailure;
            }
        });
        const first = fixture.kernel.restart().then(
            () => undefined,
            (error) => error
        );
        try {
            assert.isTrue(
                await raceTimeout(
                    2000,
                    entered.promise.then(() => true)
                )
            );
            const second = fixture.kernel.restart().then(
                () => undefined,
                (error) => error
            );
            assert.instanceOf(await raceTimeout(4000, first), CancellationError);
            assert.strictEqual(await raceTimeout(4000, second), expectedFailure);
            release.resolve();
            shouldFail = false;
            assert.isTrue(
                await raceTimeout(
                    4000,
                    fixture.kernel.restart().then(() => true)
                )
            );
            await fixture.firstCell();
        } finally {
            release.resolve();
        }
        assert.strictEqual(hooks, 3);
    });

    // Signed widget traffic after restart still triggers version detection without recovery probes.
    test('Review regression widget detects a signed post-restart message after the startup token is cancelled', async () => {
        fixture = new RawStartupFixture('none');
        await fixture.initialize();
        await fixture.start();
        assert.isTrue(
            await raceTimeout(
                5000,
                fixture.kernel.restart().then(() => true)
            )
        );

        const versions: (7 | 8 | undefined)[] = [];
        const resolved = createDeferred<7 | 8 | undefined>();
        const disposable = fixture.kernel.onIPyWidgetVersionResolved((version) => {
            versions.push(version);
            resolved.resolve(version);
        });
        try {
            fixture.peer.widgetVersion = 8;
            const requests = fixture.widgetVersionRequests;
            const peers = fixture.peer.peers.size;
            assert.isTrue(
                await raceTimeout(
                    2000,
                    fixture.peer.emitWidgetDisplayData().then(() => true)
                )
            );

            assert.strictEqual(
                await raceTimeout(2000, resolved.promise),
                8,
                'The post-restart widget message did not issue a live version-detection request'
            );
            assert.strictEqual(fixture.widgetVersionRequests, requests + 1);
            assert.strictEqual(fixture.peer.peers.size, peers);
            assert.deepEqual(versions, [8]);
            assert.strictEqual(fixture.kernel.ipywidgetsVersion, 8);
        } finally {
            disposable.dispose();
        }
    });

    // Acknowledged busy startup work pauses the no-progress budget even when it outlasts the budget.
    test('an acknowledged slow startup command pauses the budget instead of failing', async () => {
        fixture = new RawStartupFixture('none', 1200);
        fixture.startupCommands.push('startup_work');
        await fixture.initialize();
        fixture.peer.delayedCommand = { code: 'startup_work', delay: 1500 };
        // The command's delay (1500ms) exceeds the configured budget (1200ms); because the kernel
        // acknowledges the request, the no-progress budget pauses and startup must still succeed.
        const started = await raceTimeout(5000, fixture.start());
        assert.isDefined(started, 'Acknowledged slow startup work was failed by the communication budget');
        assert.strictEqual(fixture.peer.peers.size, 0);
        assert.strictEqual(fixture.startedEvents, 1);
        await fixture.firstCell();
    });

    // Acknowledged slow startup work completes without probes under a larger deadline.
    test('a larger configured deadline permits acknowledged slow startup without probes', async () => {
        fixture = new RawStartupFixture('none', 4000);
        fixture.startupCommands.push('startup_work');
        await fixture.initialize();
        fixture.peer.delayedCommand = { code: 'startup_work', delay: 1500 };
        await fixture.start();
        assert.strictEqual(fixture.peer.peers.size, 0);
        await fixture.firstCell();
    });

    for (const reply of ['mismatch', 'bad-signature'] as const) {
        // Recovery rejects a fresh-peer kernel_info reply with a mismatched parent id or bad signature, never publishing readiness.
        test(`an invalid ${reply} auxiliary reply cannot publish readiness`, async () => {
            fixture = new RawStartupFixture('execute');
            await fixture.initialize();
            fixture.peer.auxiliaryReply = reply;
            const error = await fixture.start().then(
                () => undefined,
                (reason) => reason
            );
            assert.instanceOf(error, Error);
            assert.isUndefined(fixture.kernel.session);
            assert.strictEqual(fixture.startedEvents, 0);
            assert.isTrue(fixture.peer.isDisposed);
        });
    }
});
