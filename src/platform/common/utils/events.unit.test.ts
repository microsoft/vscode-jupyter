// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import { AsyncEmitter, IWaitUntil } from './events';
import * as fakeTimers from '@sinonjs/fake-timers';
import { Disposable, CancellationTokenSource } from 'vscode';
import { IDisposable } from '../types';
import { dispose } from './lifecycle';
import { createDeferredFromPromise } from './async';

suite('AsyncEmitter', async () => {
    let clock: fakeTimers.InstalledClock;
    let disposables: IDisposable[] = [];

    const timeout = (timeout: number) => new Promise((resolve) => setTimeout(resolve, timeout));

    setup(() => {
        clock = fakeTimers.install();
        console.error = sinon.stub(); // Errors in AsyncEmitter are logged, so we can suppress them here.
        disposables.push(new Disposable(() => clock.uninstall()));
    });

    teardown(() => {
        sinon.restore();
        disposables = dispose(disposables);
    });

    test('event has waitUntil-function', async function () {
        let called = false;

        interface E extends IWaitUntil {
            foo: boolean;
            bar: number;
        }

        const emitter = new AsyncEmitter<E>();
        disposables.push(emitter);
        disposables.push(
            emitter.event((e) => {
                called = true;
                assert.strictEqual(e.foo, true);
                assert.strictEqual(e.bar, 1);
                assert.strictEqual(typeof e.waitUntil, 'function');
            })
        );

        await emitter.fireAsync({ foo: true, bar: 1 }, new CancellationTokenSource().token);
        assert.strictEqual(called, true);
    });

    test('sequential delivery', async () => {
        interface E extends IWaitUntil {
            foo: boolean;
        }

        let globalState = 0;
        const emitter = new AsyncEmitter<E>();
        disposables.push(emitter);
        disposables.push(
            emitter.event((e) => {
                e.waitUntil(
                    timeout(10).then((_) => {
                        assert.strictEqual(globalState, 0);
                        globalState += 1;
                    })
                );
            })
        );
        disposables.push(
            emitter.event((e) => {
                e.waitUntil(
                    timeout(1).then((_) => {
                        assert.strictEqual(globalState, 1);
                        globalState += 1;
                    })
                );
            })
        );

        void clock.tickAsync(100);
        await emitter.fireAsync({ foo: true }, new CancellationTokenSource().token);
        assert.strictEqual(globalState, 2);
    });

    test('sequential, in-order delivery', async function () {
        interface E extends IWaitUntil {
            foo: number;
        }
        const events: number[] = [];
        let done = false;
        const emitter = new AsyncEmitter<E>();
        disposables.push(emitter);

        // e1
        disposables.push(
            emitter.event((e) => {
                e.waitUntil(
                    timeout(10).then(async (_) => {
                        if (e.foo === 1) {
                            await emitter.fireAsync({ foo: 2 }, new CancellationTokenSource().token);
                            assert.deepStrictEqual(events, [1, 2]);
                            done = true;
                        }
                    })
                );
            })
        );

        // e2
        disposables.push(
            emitter.event((e) => {
                events.push(e.foo);
                e.waitUntil(timeout(7));
            })
        );

        void clock.tickAsync(100);
        await emitter.fireAsync({ foo: 1 }, new CancellationTokenSource().token);
        assert.ok(done);
    });

    test('sequential, in-order delivery with proxied event emitter', async function () {
        interface E extends IWaitUntil {
            foo: number;
        }
        const events: Array<{ foo: number; bar: number }> = [];
        let done = false;
        const emitter = new AsyncEmitter<E>();
        disposables.push(emitter);

        let bar = 0;
        // set up emitter 2 as a proxied event emitter with an additional param
        const emitter2 = new AsyncEmitter<{ bar: number } & E>();
        disposables.push(emitter2);
        disposables.push(emitter.event((e) => e.waitUntil(emitter2.fireAsync({ foo: e.foo, bar: bar++ }, e.token))));

        // e1
        disposables.push(
            emitter2.event((e) => {
                e.waitUntil(
                    timeout(10).then(async (_) => {
                        if (e.foo === 1) {
                            await emitter.fireAsync({ foo: 2 }, new CancellationTokenSource().token);
                            assert.deepStrictEqual(events, [
                                { foo: 1, bar: 0 },
                                { foo: 2, bar: 1 }
                            ]);
                            done = true;
                        }
                    })
                );
            })
        );

        // e2
        disposables.push(
            emitter2.event((e) => {
                events.push({ foo: e.foo, bar: e.bar });
                e.waitUntil(timeout(7));
            })
        );

        const deferrable = createDeferredFromPromise(
            emitter.fireAsync({ foo: 1 }, new CancellationTokenSource().token)
        );

        // time: 9
        await clock.tickAsync(9);
        assert.deepStrictEqual(events, []);
        assert.strictEqual(deferrable.resolved, false);

        // time: 10 (e1 is unblocked, so e2 runs)
        await clock.tickAsync(1);
        assert.deepStrictEqual(events, [{ foo: 1, bar: 0 }]);
        assert.strictEqual(deferrable.resolved, false);

        // time: 17 (e2 is unblocked so second fireAsync can run)
        await clock.tickAsync(7);
        assert.deepStrictEqual(events, [{ foo: 1, bar: 0 }]);
        assert.strictEqual(deferrable.resolved, false);

        // time: 27 (e2 is unblocked again)
        await clock.tickAsync(10);
        assert.deepStrictEqual(events, [
            { foo: 1, bar: 0 },
            { foo: 2, bar: 1 }
        ]);
        assert.strictEqual(deferrable.resolved, false);

        // time: 34 (second fireAsync resolves)
        await clock.tickAsync(7);
        assert.deepStrictEqual(events, [
            { foo: 1, bar: 0 },
            { foo: 2, bar: 1 }
        ]);

        // make sure that the fireAsync from the parent resolves at this point
        assert.strictEqual(deferrable.resolved, true);
        assert.ok(done);
    });

    test('catch errors', async function () {
        interface E extends IWaitUntil {
            foo: boolean;
        }

        let globalState = 0;
        const emitter = new AsyncEmitter<E>();
        disposables.push(emitter);
        disposables.push(
            emitter.event((e) => {
                globalState += 1;
                e.waitUntil(new Promise((_r, reject) => reject(new Error())));
            })
        );
        disposables.push(
            emitter.event((e) => {
                globalState += 1;
                e.waitUntil(timeout(10));
                e.waitUntil(timeout(20).then(() => globalState++)); // multiple `waitUntil` are supported and awaited on
            })
        );

        void clock.tickAsync(100);
        await emitter
            .fireAsync({ foo: true }, new CancellationTokenSource().token)
            .then(() => {
                assert.strictEqual(globalState, 3);
            })
            .catch((e) => {
                console.log(e);
                assert.ok(false);
            });
    });
});
