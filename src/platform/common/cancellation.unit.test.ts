// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { CancellationError, CancellationTokenSource } from 'vscode';
import { noop, sleep } from '../../test/core';
import { raceCancellation, raceCancellationError } from './cancellation';
import { disposeAllDisposables } from './helpers';
import { IDisposable } from './types';
use(chaiAsPromised);

suite('Cancellation', () => {
    const disposables: IDisposable[] = [];
    suiteTeardown(() => disposeAllDisposables(disposables));
    test('raceCancellation', async () => {
        const cts = new CancellationTokenSource();
        disposables.push(cts);
        let triggered = false;
        const p = raceCancellation(
            cts.token,
            sleep(100)
                .catch(noop)
                .finally(() => (triggered = true))
        );
        cts.cancel();

        await p;

        assert.ok(!triggered);
    });
    test('raceCancellation returns value', async () => {
        const cts = new CancellationTokenSource();
        disposables.push(cts);

        const p = raceCancellation(cts.token, Promise.resolve('HelloWorld'));

        assert.equal(await p, 'HelloWorld');
    });
    test('raceCancellation returns value without a token', async () => {
        const p = raceCancellation(undefined, Promise.resolve('HelloWorld'));

        assert.equal(await p, 'HelloWorld');
    });
    test('raceCancellation returns default value when cancelled', async () => {
        const cts = new CancellationTokenSource();
        disposables.push(cts);
        let triggered = false;

        const p = raceCancellation(
            cts.token,
            'HelloWorld',
            sleep(100)
                .catch(noop)
                .then(() => 'timeout')
                .finally(() => (triggered = true))
        );
        cts.cancel();

        assert.equal(await p, 'HelloWorld');
        assert.ok(!triggered);
    });
    test('raceCancellation does not return default value when not cancelled', async () => {
        const cts = new CancellationTokenSource();
        disposables.push(cts);

        const p = raceCancellation(cts.token, 'Default Value', Promise.resolve('HelloWorld'));

        assert.equal(await p, 'HelloWorld');
    });
    test('raceCancellation does not return default value when there is no token', async () => {
        const p = raceCancellation(undefined, 'Default Value', Promise.resolve('HelloWorld'));

        assert.equal(await p, 'HelloWorld');
    });
    test('raceCancellation multiple promises', async () => {
        const cts = new CancellationTokenSource();
        disposables.push(cts);

        let triggered = false;
        const p = raceCancellation(
            cts.token,
            sleep(100)
                .catch(noop)
                .finally(() => (triggered = true)),
            sleep(100)
                .catch(noop)
                .finally(() => (triggered = true)),
            sleep(100)
                .catch(noop)
                .finally(() => (triggered = true))
        );
        cts.cancel();

        await p;

        assert.ok(!triggered);
    });

    test('raceCancellation multiple promises and returns value', async () => {
        const cts = new CancellationTokenSource();
        disposables.push(cts);

        const p = raceCancellation(
            cts.token,
            sleep(100)
                .catch(noop)
                .then(() => 'timeout'),
            sleep(100)
                .catch(noop)
                .then(() => 'timeout'),
            sleep(100)
                .catch(noop)
                .then(() => 'timeout'),
            Promise.resolve('HelloWorld')
        );

        assert.equal(await p, 'HelloWorld');
    });
    test('raceCancellation multiple promises and returns value when there is no token', async () => {
        const p = raceCancellation(
            undefined,
            sleep(100)
                .catch(noop)
                .then(() => 'timeout'),
            sleep(100)
                .catch(noop)
                .then(() => 'timeout'),
            sleep(100)
                .catch(noop)
                .then(() => 'timeout'),
            Promise.resolve('HelloWorld')
        );

        assert.equal(await p, 'HelloWorld');
    });
    test('raceCancellation multiple promises and returns default value when cancelled', async () => {
        const cts = new CancellationTokenSource();
        disposables.push(cts);
        let triggered = false;

        const p = raceCancellation(
            cts.token,
            'HelloWorld',
            sleep(100)
                .catch(noop)
                .then(() => 'timeout')
                .finally(() => (triggered = true)),
            sleep(100)
                .catch(noop)
                .then(() => 'timeout')
                .finally(() => (triggered = true)),
            sleep(100)
                .catch(noop)
                .then(() => 'timeout')
                .finally(() => (triggered = true))
        );
        cts.cancel();

        assert.equal(await p, 'HelloWorld');
        assert.ok(!triggered);
    });

    test('raceCancellation error', async () => {
        const cts = new CancellationTokenSource();
        disposables.push(cts);
        let triggered = false;

        const p = raceCancellationError(
            cts.token,
            sleep(100)
                .catch(noop)
                .then(() => 'timeout')
                .finally(() => (triggered = true))
        );
        cts.cancel();

        await assert.isRejected(p, new CancellationError().message);
        assert.ok(!triggered);
    });

    test('raceCancellation error without a token', async () => {
        const p = raceCancellationError(
            undefined,
            sleep(100)
                .catch(noop)
                .then(() => 'timeout')
        );

        assert.equal(await p, 'timeout');
    });

    test('raceCancellation error with multiple promises', async () => {
        const cts = new CancellationTokenSource();
        disposables.push(cts);
        let triggered = false;

        const p = raceCancellationError(
            cts.token,
            sleep(100)
                .catch(noop)
                .then(() => 'timeout')
                .finally(() => (triggered = true)),
            sleep(100)
                .catch(noop)
                .then(() => 'timeout')
                .finally(() => (triggered = true)),
            sleep(100)
                .catch(noop)
                .then(() => 'timeout')
                .finally(() => (triggered = true))
        );
        cts.cancel();

        await assert.isRejected(p, new CancellationError().message);
        assert.ok(!triggered);
    });
    test('raceCancellation error with multiple promises and without a token', async () => {
        const p = raceCancellationError(
            undefined,
            sleep(100)
                .catch(noop)
                .then(() => 'timeout'),
            sleep(100)
                .catch(noop)
                .then(() => 'timeout'),
            sleep(100)
                .catch(noop)
                .then(() => 'timeout')
        );

        assert.equal(await p, 'timeout');
    });
});
