// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { DisplayOptions } from '../../displayOptions';
import { executeSilently } from '../../helpers';
import { PythonStartupFixture } from '../../../test/datascience/pythonStartupFixture.node';
import {
    createRawStartupTestContext,
    initializeRawStartupTestApi
} from '../../../test/datascience/rawKernelStartupTestContext.node';
import { raceTimeoutError } from '../../../platform/common/utils/async';
import { noop } from '../../../platform/common/utils/misc';

function getPython() {
    // eslint-disable-next-line local-rules/dont-use-process
    const python = process.env.VSC_JUPYTER_TEST_PYTHON;
    assert.isString(python, 'Set VSC_JUPYTER_TEST_PYTHON to an isolated Python with ipykernel/pyzmq/tornado');
    if (!python) {
        throw new Error('Native Python regression prerequisite missing');
    }
    return python;
}

async function captureFailure(promise: Promise<unknown>): Promise<Error> {
    let resolved = false;
    let failure: unknown;
    await promise.then(
        () => {
            resolved = true;
        },
        (error) => {
            failure = error;
        }
    );
    if (resolved) {
        assert.fail('Expected operation to reject');
    }
    if (!(failure instanceof Error)) {
        assert.fail('Expected operation to reject with an Error');
    }
    return failure;
}

(process.platform === 'win32' ? suite : suite.skip)('Raw startup real Python FD integration', () => {
    let api: ReturnType<typeof initializeRawStartupTestApi>;
    setup(() => {
        api = initializeRawStartupTestApi();
    });
    teardown(() => api.dispose());

    for (const unrecoverable of [false, true]) {
        test(
            unrecoverable
                ? 'exhaustion stops the real owned process and futures'
                : 'extension recovery releases the real queued FD request',
            async () => {
                const backend = new PythonStartupFixture(getPython(), unrecoverable);
                let dispose: (() => Promise<void>) | undefined;
                try {
                    await backend.start();
                    const context = createRawStartupTestContext(backend, 2500);
                    dispose = () => context.dispose();
                    context.kernel.addHook('didStart', async (session) => {
                        await backend.waitFor('queue-second');
                        if (!session?.kernel) {
                            throw new Error('Real fixture startup session is missing');
                        }
                        await executeSilently(session.kernel, 'pass');
                    });
                    if (unrecoverable) {
                        await context.kernel.start(new DisplayOptions(true)).then(() => {
                            throw new Error('Unresponsive real fixture falsely started');
                        }, noop);
                        assert.isUndefined(context.kernel.session);
                        assert.strictEqual(backend.exitCode, 0);
                        assert.isTrue(context.sessions[0].wrapped.isDisposed);
                    } else {
                        const session = await raceTimeoutError(
                            6000,
                            new Error('Actual native FD request was not recovered'),
                            context.kernel.start(new DisplayOptions(true))
                        );
                        await backend.waitFor('fault-staged');
                        assert.strictEqual(context.kernel.session, session);
                        assert.strictEqual(context.kernel.status, 'idle');
                    }
                } finally {
                    if (dispose) {
                        await dispose();
                    } else {
                        await backend.stop();
                    }
                }
                assert.strictEqual(backend.exitCode, 0);
            }
        ).timeout(15000);
    }

    test('missing readiness cleans its real owned child before start rejects', async () => {
        const backend = new PythonStartupFixture(getPython(), false, { omitReady: true });
        try {
            const failure = await captureFailure(backend.start());

            assert.strictEqual(failure.message, 'Python fixture did not initialize');
            assert.strictEqual(backend.exitCode, 0);
            await backend.termination;
        } finally {
            await backend.stop();
        }
    }).timeout(20000);

    test('ignored stdin stop force-stops the real owned child', async () => {
        const backend = new PythonStartupFixture(getPython(), false, { ignoreStop: true });
        try {
            await backend.start();
            const stopping = backend.stop();
            await backend.waitFor('stop-ignored');
            await stopping;

            assert.isTrue(backend.didForceStop);
            assert.notStrictEqual(backend.exitCode, undefined);
            await backend.termination;
        } finally {
            await backend.stop();
        }
    }).timeout(10000);

    test('stdin EOF stops the real owned child without a force-stop', async () => {
        const backend = new PythonStartupFixture(getPython(), false, { sendEofOnStop: true });
        try {
            await backend.start();
            const stopping = backend.stop();
            await backend.waitFor('stdin-eof');
            await stopping;

            assert.isFalse(backend.didForceStop);
            assert.strictEqual(backend.exitCode, 0);
            await backend.termination;
        } finally {
            await backend.stop();
        }
    }).timeout(10000);
});
