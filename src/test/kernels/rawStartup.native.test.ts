// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { raceTimeout } from '../../platform/common/utils/async';
import { StopWatch } from '../../platform/common/utils/stopWatch';
import { getNativeStartupPython, NativeStartupFixture } from './rawStartupNative.node';
import * as sinon from 'sinon';
import * as telemetry from '../../kernels/telemetry/helper';
import { createDeferred } from '../../platform/common/utils/async';

suite('Raw Kernel Startup Native Contract', function () {
    this.timeout(20000);
    let fixture: NativeStartupFixture;
    let python: string;

    setup(() => {
        python = getNativeStartupPython();
    });
    teardown(async function () {
        await fixture?.dispose(this.currentTest?.state === 'passed');
    });

    test('the actual queued-input sender is recovered by production Node code and the first cell runs once', async () => {
        fixture = new NativeStartupFixture(python);
        await fixture.initialize();
        assert.strictEqual(fixture.process.versions.python, '3.14.6');
        assert.strictEqual(fixture.process.versions.ipykernel, '7.3.0');
        assert.strictEqual(fixture.process.versions.pyzmq, '27.1.0');
        assert.strictEqual(fixture.process.versions.jupyter_client, '8.10.0');
        const clock = new StopWatch();
        const session = await raceTimeout(4500, fixture.start());
        assert.isDefined(session, 'The real original startup request remained queued');
        const state = await fixture.state();
        assert.strictEqual(state.fd_before, true);
        assert.strictEqual(state.fd_after, false);
        assert.strictEqual(state.pollin, true);
        assert.strictEqual(state.executions, 1);
        assert.isUndefined(state.error);
        assert.strictEqual(fixture.startedEvents, 1);
        assert.strictEqual(fixture.kernel.session, session);
        const output = await fixture.firstCell();
        assert.isTrue(output.some((item) => item.output_type === 'stream' && String(item.text).includes('42')));
        assert.isTrue(clock.elapsedTime < 5000, 'Startup and first cell exceeded the explicit fixture bound');
        assert.strictEqual(fixture.cleanupForcedDispose, false);
    });

    test('an unmodified healthy kernel starts and runs its first cell without fixture intervention', async () => {
        fixture = new NativeStartupFixture(python, false);
        await fixture.initialize();
        assert.isDefined(await raceTimeout(5000, fixture.start()));
        const output = await fixture.firstCell();
        assert.isTrue(output.some((item) => item.output_type === 'stream' && String(item.text).includes('42')));
        assert.strictEqual(fixture.startedEvents, 1);
        assert.strictEqual(fixture.cleanupForcedDispose, false);
    });

    test('optional executable telemetry cannot consume the whole initialization budget', async () => {
        fixture = new NativeStartupFixture(python, false, 3000);
        await fixture.initialize();
        const pending = createDeferred<void>();
        const original = telemetry.trackKernelResourceInformation;
        const capture = sinon
            .stub(telemetry, 'trackKernelResourceInformation')
            .callsFake((resource, information) =>
                information.interpreterMatchesKernel === undefined ? original(resource, information) : pending.promise
            );
        try {
            assert.isDefined(await raceTimeout(3500, fixture.start()));
            assert.isTrue(capture.getCalls().some((call) => call.args[1].interpreterMatchesKernel !== undefined));
            await fixture.firstCell();
            assert.strictEqual(fixture.startedEvents, 1);
        } finally {
            pending.resolve();
            capture.restore();
        }
    });

    test('restart uses a new real sender and runs its first cell after recovery', async () => {
        fixture = new NativeStartupFixture(python);
        await fixture.initialize();
        await fixture.start();
        const originalProcess = fixture.process;
        let restarted = 0;
        fixture.kernel.onRestarted(() => restarted++);
        assert.isDefined(
            await raceTimeout(
                10000,
                fixture.kernel.restart().then(() => true)
            )
        );
        assert.notStrictEqual(fixture.process, originalProcess);
        assert.isTrue(originalProcess.isDisposed);
        const state = await fixture.state();
        assert.strictEqual(state.fd_before, true);
        assert.strictEqual(state.fd_after, false);
        assert.strictEqual(state.pollin, true);
        assert.strictEqual(state.executions, 1);
        await fixture.firstCell();
        assert.strictEqual(restarted, 1);
        assert.strictEqual(fixture.startedEvents, 1);
    });
});
