// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import { AsyncEmitter, IWaitUntil } from './events';
import * as fakeTimers from '@sinonjs/fake-timers';
import { Disposable, CancellationTokenSource } from 'vscode';
import { IDisposable } from '../types';
import { dispose } from './lifecycle';

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
