// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { KernelSocketMap } from '../../kernels/kernelSocket';
import { raceTimeout } from '../../platform/common/utils/async';
import { StopWatch } from '../../platform/common/utils/stopWatch';
import { getNativeStartupIterations, getNativeStartupPython, NativeStartupFixture } from './rawStartupNative.node';

// Slower real-stack contract tests: a real Python/ipykernel process exercises production
// recovery end to end, with pinned versions asserted in the gated recovery case.
suite('Raw Kernel Startup Native Contract', function () {
    this.timeout(20000);
    const iterations = getNativeStartupIterations();
    let fixture: NativeStartupFixture;
    let python: string;

    setup(() => {
        python = getNativeStartupPython();
    });
    teardown(async function () {
        const kernelId = fixture?.session?.kernel?.id;
        await fixture?.dispose(this.currentTest?.state === 'passed');
        if (kernelId) {
            assert.isFalse(KernelSocketMap.has(kernelId), 'Raw kernel socket leaked after fixture disposal');
        }
    });

    for (let iteration = 0; iteration < iterations; iteration++) {
        // The real queued-input race recovers, executes once, and leaves the first cell usable.
        test(`the actual queued-input sender is recovered by production Node code and the first cell runs once (iteration ${iteration})`, async () => {
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

        // An unmodified healthy real kernel starts and executes without fixture intervention.
        test(`an unmodified healthy kernel starts and runs its first cell without fixture intervention (iteration ${iteration})`, async () => {
            fixture = new NativeStartupFixture(python, false);
            await fixture.initialize();
            assert.isDefined(await raceTimeout(5000, fixture.start()));
            const output = await fixture.firstCell();
            assert.isTrue(output.some((item) => item.output_type === 'stream' && String(item.text).includes('42')));
            assert.strictEqual(fixture.startedEvents, 1);
            assert.strictEqual(fixture.cleanupForcedDispose, false);
        });

        // Note: the "stalled optional telemetry cannot starve startup" property is a deterministic Node
        // concern (a timer cancels the probe once the startup budget runs low). It is covered by the fast
        // fake-timer unit test in src/kernels/helpers.node.unit.test.ts rather than a real-Python test,
        // because tying it to real-process wall-clock timing made it flaky on slower CI runners.

        // Restart replaces the real process and recovers its new sender before executing a cell.
        test(`restart uses a new real sender and runs its first cell after recovery (iteration ${iteration})`, async () => {
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
    }
});
