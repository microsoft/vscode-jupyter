// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { createDeferred, raceTimeout, raceTimeoutError } from './async';
import { CancellationError } from 'vscode';
use(chaiAsPromised);

suite('async', () => {
    suite('Deferred', () => {
        test('Resolve', (done) => {
            const valueToSent = new Date().getTime();
            const def = createDeferred<number>();
            def.promise
                .then((value) => {
                    assert.equal(value, valueToSent);
                    assert.equal(def.resolved, true, 'resolved property value is not `true`');
                })
                .then(done)
                .catch(done);

            assert.equal(def.resolved, false, 'Promise is resolved even when it should not be');
            assert.equal(def.rejected, false, 'Promise is rejected even when it should not be');
            assert.equal(def.completed, false, 'Promise is completed even when it should not be');

            def.resolve(valueToSent);

            assert.equal(def.resolved, true, 'Promise is not resolved even when it should not be');
            assert.equal(def.rejected, false, 'Promise is rejected even when it should not be');
            assert.equal(def.completed, true, 'Promise is not completed even when it should not be');
        });
        test('Reject', (done) => {
            const errorToSend = new Error('Something');
            const def = createDeferred<number>();
            def.promise
                .then(() => {
                    assert.fail('Error', 'Was expecting promise to get rejected, however it was resolved', '');
                    done();
                })
                .catch((reason) => {
                    assert.equal(reason, errorToSend, 'Error received is not the same');
                    done();
                })
                .catch(done);

            assert.equal(def.resolved, false, 'Promise is resolved even when it should not be');
            assert.equal(def.rejected, false, 'Promise is rejected even when it should not be');
            assert.equal(def.completed, false, 'Promise is completed even when it should not be');

            def.reject(errorToSend);

            assert.equal(def.resolved, false, 'Promise is resolved even when it should not be');
            assert.equal(def.rejected, true, 'Promise is not rejected even when it should not be');
            assert.equal(def.completed, true, 'Promise is not completed even when it should not be');
        });
    });
    suite('raceTimeout', () => {
        let timeoutsToClear: (NodeJS.Timeout | number)[] = [];
        teardown(() => {
            timeoutsToClear.forEach(clearTimeout);
            timeoutsToClear = [];
        });
        function createTimeout(timeout: number, value: unknown) {
            return new Promise((resolve) => {
                const timeoutId = setTimeout(() => resolve(value), timeout);
                timeoutsToClear.push(timeoutId);
            });
        }
        test('timeout', async () => {
            const result = raceTimeout(10, createTimeout(200, 'Hello World'));

            assert.equal(await result, undefined);
        });
        test('timeout with default value', async () => {
            const result = raceTimeout(10, 'Foo Bar', createTimeout(200, 'Hello World'));

            assert.equal(await result, 'Foo Bar');
        });
        test('timeout with multiple promises', async () => {
            const result = raceTimeout(
                10,
                createTimeout(200, 'Hello World'),
                createTimeout(200, 'Hello World'),
                createTimeout(200, 'Hello World')
            );

            assert.equal(await result, undefined);
        });
        test('timeout with multiple promises and default value', async () => {
            const result = raceTimeout(
                10,
                'Foo Bar',
                createTimeout(200, 'Hello World'),
                createTimeout(200, 'Hello World'),
                createTimeout(200, 'Hello World')
            );

            assert.equal(await result, 'Foo Bar');
        });
        test('does not timeout with multiple promises', async () => {
            const result = raceTimeout(
                1000,
                createTimeout(100, 'Hello World'),
                createTimeout(10, 'Hello World2'),
                createTimeout(100, 'Hello World3')
            );

            assert.equal(await result, 'Hello World2');
        });
        test('does not timeout with multiple promises and a default value', async () => {
            const result = raceTimeout(
                1000,
                'Foo Bar',
                createTimeout(100, 'Hello World'),
                createTimeout(10, 'Hello World2'),
                createTimeout(100, 'Hello World3')
            );

            assert.equal(await result, 'Hello World2');
        });
        test('timeout error', async () => {
            const result = raceTimeoutError(10, new CancellationError(), createTimeout(100, 'Hello World'));

            await assert.isRejected(result, new CancellationError().message);
        });
        test('no timeout error', async () => {
            const result = raceTimeoutError(100, new CancellationError(), createTimeout(10, 'Hello World'));

            assert.equal(await result, 'Hello World');
        });
        test('timeout error wih multiple promises', async () => {
            const result = raceTimeoutError(
                10,
                new CancellationError(),
                createTimeout(100, 'Hello World'),
                createTimeout(100, 'Hello World'),
                createTimeout(100, 'Hello World')
            );

            await assert.isRejected(result, new CancellationError().message);
        });
        test('no timeout error wih multiple promises', async () => {
            const result = raceTimeoutError(
                100,
                new CancellationError(),
                createTimeout(100, 'Hello World'),
                createTimeout(10, 'Hello World2'),
                createTimeout(100, 'Hello World3')
            );

            assert.equal(await result, 'Hello World2');
        });
    });
});
