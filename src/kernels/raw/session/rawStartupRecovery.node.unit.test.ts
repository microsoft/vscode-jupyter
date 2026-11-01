// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { createDeferred, raceTimeout, sleep } from '../../../platform/common/utils/async';
import { RawStartupFixture } from '../../../test/kernels/rawStartup.node';
import { KernelConnectionTimeoutError } from '../../errors/kernelConnectionTimeoutError';
import { KernelProcessExitedError } from '../../errors/kernelProcessExitedError';
import { StartOptions } from '../../displayOptions';
import { CancellationError, CancellationTokenSource } from 'vscode';

suite('Raw Kernel Startup Recovery', function () {
    this.timeout(12000);
    let fixture: RawStartupFixture;

    teardown(async () => {
        await fixture?.dispose();
        assert.deepEqual(fixture?.errors, []);
    });

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

    test('healthy startup does not create a recovery peer', async () => {
        fixture = new RawStartupFixture('none');
        await fixture.initialize();
        assert.isDefined(await raceTimeout(2500, fixture.start()));
        assert.strictEqual(fixture.peer.peers.size, 0);
        await fixture.firstCell();
        assert.strictEqual(fixture.startedEvents, 1);
    });

    test('an unrecoverable startup fails at the shared deadline without publishing', async () => {
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

    test('an abandoned warm-up idle does not block a subsequent fresh readiness exchange', async () => {
        fixture = new RawStartupFixture('none');
        await fixture.initialize();
        fixture.peer.omitFirstWarmIdle = true;
        assert.isDefined(await raceTimeout(3000, fixture.start()));
        await fixture.firstCell();
        assert.strictEqual(fixture.startedEvents, 1);
    });

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

    test('a late swallowed hook cannot publish a timed-out session', async () => {
        fixture = new RawStartupFixture('none', 1000);
        await fixture.initialize();
        const hook = createDeferred<void>();
        fixture.kernel.addHook('didStart', async () => hook.promise);
        const error = await fixture.start().then(
            () => undefined,
            (reason) => reason
        );
        hook.resolve();
        await sleep(10);
        assert.instanceOf(error, KernelConnectionTimeoutError);
        assert.isUndefined(fixture.kernel.session);
        assert.strictEqual(fixture.startedEvents, 0);
    });

    test('an old hook resolving during a newer attempt cannot overwrite its session', async () => {
        fixture = new RawStartupFixture('none', 1200);
        await fixture.initialize();
        const hook = createDeferred<void>();
        let calls = 0;
        fixture.kernel.addHook('didStart', async () => {
            if (++calls === 1) {
                await hook.promise;
            }
        });
        const error = await fixture.start().then(
            () => undefined,
            (reason) => reason
        );
        assert.instanceOf(error, KernelConnectionTimeoutError);
        const next = fixture.start();
        hook.resolve();
        const session = await raceTimeout(2500, next);
        assert.isDefined(session);
        assert.strictEqual(fixture.kernel.session, session);
        assert.strictEqual(fixture.startedEvents, 1);
        await fixture.firstCell();
    });

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

    test('a later initialization stall requires a different fresh peer', async () => {
        fixture = new RawStartupFixture('execute');
        await fixture.initialize();
        fixture.peer.additionalExecutionGate = 3;
        await fixture.start();
        assert.isTrue(fixture.peer.peers.size >= 2);
        await fixture.firstCell();
    });

    test('restarting before the first start does not initialize the completed context twice', async () => {
        fixture = new RawStartupFixture('execute');
        await fixture.initialize();
        await fixture.kernel.restart();
        assert.strictEqual(fixture.startedEvents, 1);
        assert.isDefined(fixture.kernel.session);
        await fixture.firstCell();
    });

    test('Review regression restart joins callers while willRestart hooks are pending', async () => {
        fixture = new RawStartupFixture('none');
        fixture.startupCommands.push('review-restart-command');
        await fixture.initialize();
        await fixture.start();

        const hookEntered = createDeferred<void>();
        const duplicateHookEntered = createDeferred<void>();
        const releaseHook = createDeferred<void>();
        let willRestartCalls = 0;
        let didStartCalls = 0;
        let restartCompletedCalls = 0;
        let restartedEvents = 0;
        fixture.kernel.addHook('willRestart', async () => {
            willRestartCalls += 1;
            if (willRestartCalls === 1) {
                hookEntered.resolve();
            } else {
                duplicateHookEntered.resolve();
            }
            await releaseHook.promise;
        });
        fixture.kernel.addHook('didStart', async () => {
            didStartCalls += 1;
        });
        fixture.kernel.addHook('restartCompleted', async () => {
            restartCompletedCalls += 1;
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
            () => undefined,
            (error) => error
        );

        try {
            assert.isUndefined(
                await raceTimeout(
                    500,
                    duplicateHookEntered.promise.then(() => true)
                ),
                'A joining restart reran the willRestart hooks'
            );
        } finally {
            releaseHook.resolve();
            await raceTimeout(4000, Promise.all([first, second]));
        }

        assert.deepEqual(await raceTimeout(4000, Promise.all([first, second])), [undefined, undefined]);
        assert.strictEqual(willRestartCalls, 1);
        assert.strictEqual(didStartCalls, 1);
        assert.strictEqual(restartCompletedCalls, 1);
        assert.strictEqual(restartedEvents, 1);
        assert.strictEqual(fixture.launches, baselineLaunches + 1);
        assert.strictEqual(fixture.executionCount('review-restart-command'), baselineCommands + 1);
    });

    test('Review regression restart joins callers through a deferred transport restart', async () => {
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
        transport.release();

        assert.deepEqual(await raceTimeout(4000, Promise.all([first, second])), [undefined, undefined]);
        assert.strictEqual(fixture.launches, baselineLaunches + 1);
        assert.strictEqual(didStartCalls, 1);
        assert.strictEqual(restartedEvents, 1);
    });

    test('Review regression restart keeps readiness pending and joins during mandatory initialization', async () => {
        fixture = new RawStartupFixture('none');
        await fixture.initialize();
        await fixture.start();

        const initializationEntered = createDeferred<void>();
        const releaseInitialization = createDeferred<void>();
        let initializationCalls = 0;
        fixture.kernel.addHook('didStart', async () => {
            initializationCalls += 1;
            initializationEntered.resolve();
            await releaseInitialization.promise;
        });

        const baselineLaunches = fixture.launches;
        const first = fixture.kernel.restart().then(
            () => undefined,
            (error) => error
        );
        assert.isTrue(
            await raceTimeout(
                2000,
                initializationEntered.promise.then(() => true)
            )
        );
        let second: Promise<unknown> | undefined;
        let nextLaunch: ReturnType<RawStartupFixture['deferNextLaunch']> | undefined;
        try {
            assert.isUndefined(
                await raceTimeout(
                    500,
                    fixture.kernel.restarting.then(() => true)
                ),
                'Readiness resolved before mandatory restart initialization completed'
            );

            nextLaunch = fixture.deferNextLaunch();
            second = fixture.kernel.restart().then(
                () => undefined,
                (error) => error
            );
            assert.isUndefined(
                await raceTimeout(
                    1000,
                    nextLaunch.entered.then(() => true)
                ),
                'A caller arriving during initialization started a second transport restart'
            );
        } finally {
            nextLaunch?.release();
            releaseInitialization.resolve();
            await raceTimeout(4000, Promise.all([first, ...(second ? [second] : [])]));
        }

        assert.deepEqual(await raceTimeout(4000, Promise.all([first, second!])), [undefined, undefined]);
        assert.strictEqual(initializationCalls, 1);
        assert.strictEqual(fixture.launches, baselineLaunches + 1);
    });

    test('Review regression restart shutdown during mandatory initialization rejects readiness and completion', async () => {
        fixture = new RawStartupFixture('none');
        await fixture.initialize();
        await fixture.start();

        const initializationEntered = createDeferred<void>();
        const releaseInitialization = createDeferred<void>();
        let restartedEvents = 0;
        fixture.kernel.addHook('didStart', async () => {
            initializationEntered.resolve();
            await releaseInitialization.promise;
        });
        fixture.kernel.onRestarted(() => (restartedEvents += 1));

        const restart = fixture.kernel.restart().then(
            () => undefined,
            (error) => error
        );
        let readiness: Promise<unknown> | undefined;
        let shutdown: Promise<unknown> | undefined;
        try {
            assert.isTrue(
                await raceTimeout(
                    2000,
                    initializationEntered.promise.then(() => true)
                )
            );
            readiness = fixture.kernel.restarting.then(
                () => undefined,
                (error) => error
            );
            shutdown = fixture.kernel.shutdown().then(
                () => undefined,
                (error) => error
            );
        } finally {
            releaseInitialization.resolve();
            await raceTimeout(4000, Promise.all([restart, ...(readiness ? [readiness] : [])]));
        }

        assert.instanceOf(
            await raceTimeout(4000, restart),
            CancellationError,
            'The complete restart operation succeeded after shutdown removed its owned session'
        );
        assert.instanceOf(
            await raceTimeout(4000, readiness!),
            CancellationError,
            'Restart readiness succeeded after shutdown removed its owned session'
        );
        assert.isTrue(
            await raceTimeout(
                4000,
                shutdown!.then(() => true)
            )
        );
        assert.strictEqual(restartedEvents, 0);
        assert.isUndefined(fixture.kernel.session);
    });

    test('Review regression restart rejects when its owned session dies before commit', async () => {
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
        let readiness: Promise<unknown> | undefined;
        try {
            assert.isTrue(
                await raceTimeout(
                    2000,
                    initializationEntered.promise.then(() => true)
                )
            );
            readiness = fixture.kernel.restarting.then(
                () => undefined,
                (error) => error
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
            await raceTimeout(4000, Promise.all([restart, ...(readiness ? [readiness] : [])]));
        }

        assert.instanceOf(
            await raceTimeout(4000, restart),
            Error,
            'The complete restart operation succeeded after its owned session died'
        );
        assert.instanceOf(
            await raceTimeout(4000, readiness!),
            Error,
            'Restart readiness succeeded after its owned session died'
        );
        assert.strictEqual(restartedEvents, 0);
        assert.isUndefined(fixture.kernel.session);
    });

    test('Review regression restart cold fallback cancellation rejects readiness and completion', async () => {
        fixture = new RawStartupFixture('none');
        await fixture.initialize();

        const transport = fixture.deferNextLaunch();
        let restartedEvents = 0;
        fixture.kernel.onRestarted(() => (restartedEvents += 1));
        const restart = fixture.kernel.restart().then(
            () => undefined,
            (error) => error
        );
        const readiness = fixture.kernel.restarting.then(
            () => undefined,
            (error) => error
        );
        assert.isTrue(
            await raceTimeout(
                2000,
                transport.entered.then(() => true)
            )
        );
        const shutdown = fixture.kernel.shutdown().then(
            () => undefined,
            (error) => error
        );
        transport.release();

        assert.instanceOf(await raceTimeout(4000, restart), CancellationError);
        assert.instanceOf(await raceTimeout(4000, readiness), CancellationError);
        assert.isTrue(
            await raceTimeout(
                4000,
                shutdown.then(() => true)
            )
        );
        assert.strictEqual(restartedEvents, 0);
        assert.isUndefined(fixture.kernel.session);
    });

    test('Review regression restart joins the awaited post-initialized handler after readiness', async () => {
        fixture = new RawStartupFixture('none');
        await fixture.initialize();
        await fixture.start();

        const handlerEntered = createDeferred<void>();
        const releaseHandler = createDeferred<void>();
        let postInitializedEvents = 0;
        fixture.kernel.onPostInitialized((event) => {
            postInitializedEvents += 1;
            event.waitUntil(
                (async () => {
                    await fixture.kernel.restarting;
                    await fixture.kernel.start(new StartOptions(false, true));
                    await fixture.executeCell('review-post-initialized-handler');
                    handlerEntered.resolve();
                    await releaseHandler.promise;
                })()
            );
        });

        const first = fixture.kernel.restart().then(
            () => undefined,
            (error) => error
        );
        assert.isTrue(
            await raceTimeout(
                2000,
                handlerEntered.promise.then(() => true)
            )
        );
        const nextLaunch = fixture.deferNextLaunch();
        const second = fixture.kernel.restart().then(
            () => undefined,
            (error) => error
        );
        try {
            assert.isUndefined(
                await raceTimeout(
                    1000,
                    nextLaunch.entered.then(() => true)
                ),
                'A caller arriving during post-initialization started another restart'
            );
            const ordinary = fixture.executeCellThroughStartGate('review-ordinary-after-post-initialization').then(
                () => true,
                (error) => error
            );
            assert.isUndefined(
                await raceTimeout(500, ordinary),
                'Ordinary code bypassed the held post-initialization handler'
            );
            releaseHandler.resolve();
            assert.isTrue(await raceTimeout(2000, ordinary));
        } finally {
            nextLaunch.release();
            releaseHandler.resolve();
            await raceTimeout(4000, Promise.all([first, second]));
        }

        assert.deepEqual(await raceTimeout(4000, Promise.all([first, second])), [undefined, undefined]);
        assert.strictEqual(postInitializedEvents, 1);
        assert.strictEqual(fixture.executionCount('review-post-initialized-handler'), 1);
        assert.strictEqual(fixture.executionCount('review-ordinary-after-post-initialization'), 1);
        const commands = fixture.peer.executionCodes;
        assert.isBelow(
            commands.indexOf('review-post-initialized-handler'),
            commands.indexOf('review-ordinary-after-post-initialization')
        );
    });

    test('Review regression restart cold fallback before first start dispatches one post-initialized handler with its start bypass', async () => {
        fixture = new RawStartupFixture('none');
        await fixture.initialize();

        let postInitializedEvents = 0;
        fixture.kernel.onPostInitialized((event) => {
            postInitializedEvents += 1;
            event.waitUntil(
                (async () => {
                    await fixture.kernel.restarting;
                    await fixture.kernel.start(new StartOptions(false, true));
                    await fixture.executeCell('review-cold-post-initialized-handler');
                })()
            );
        });

        const result = await raceTimeout(
            5000,
            fixture.kernel.restart().then(
                () => true,
                (error) => error
            )
        );

        assert.isTrue(result);
        assert.strictEqual(postInitializedEvents, 1);
        assert.strictEqual(fixture.executionCount('review-cold-post-initialized-handler'), 1);
        assert.strictEqual(fixture.startedEvents, 1);
    });

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

    test('Review regression restart joins a failed attempt and permits a fresh retry', async () => {
        fixture = new RawStartupFixture('none');
        await fixture.initialize();
        await fixture.start();

        const hookEntered = createDeferred<void>();
        const duplicateHookEntered = createDeferred<void>();
        const releaseHook = createDeferred<void>();
        const expectedFailure = new Error('review restart failure');
        let shouldFail = true;
        let hooks = 0;
        fixture.kernel.addHook('willRestart', async () => {
            hooks += 1;
            if (hooks === 1) {
                hookEntered.resolve();
            } else {
                duplicateHookEntered.resolve();
            }
            await releaseHook.promise;
            if (shouldFail) {
                throw expectedFailure;
            }
        });

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
            () => undefined,
            (error) => error
        );
        try {
            assert.isUndefined(
                await raceTimeout(
                    500,
                    duplicateHookEntered.promise.then(() => true)
                ),
                'A joining failed restart reran the willRestart hooks'
            );
        } finally {
            releaseHook.resolve();
            await raceTimeout(4000, Promise.all([first, second]));
        }

        assert.deepEqual(await raceTimeout(4000, Promise.all([first, second])), [expectedFailure, expectedFailure]);
        assert.strictEqual(hooks, 1);
        shouldFail = false;
        assert.isTrue(
            await raceTimeout(
                4000,
                fixture.kernel.restart().then(
                    () => true,
                    (error) => error
                )
            )
        );
    });

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

    test('a configured startup command cannot escape the hard deadline', async () => {
        fixture = new RawStartupFixture('none', 1200);
        fixture.startupCommands.push('startup_work');
        await fixture.initialize();
        fixture.peer.delayedCommand = { code: 'startup_work', delay: 1500 };
        const error = await fixture.start().then(
            () => undefined,
            (reason) => reason
        );
        assert.instanceOf(error, KernelConnectionTimeoutError);
        assert.isUndefined(fixture.kernel.session);
        assert.strictEqual(fixture.startedEvents, 0);
    });

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
