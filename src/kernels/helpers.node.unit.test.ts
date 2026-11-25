// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import { CancellationTokenSource, Uri } from 'vscode';
import { createDeferred } from '../platform/common/utils/async';
import * as helpers from './helpers';
import * as telemetryHelper from './telemetry/helper';
import { sendTelemetryForPythonKernelExecutable } from './helpers.node';
import { IKernelSession, IKernelStartup, LocalKernelSpecConnectionMetadata } from './types';

/**
 * Deterministic coverage for the executable-telemetry budget cap in
 * `sendTelemetryForPythonKernelExecutable` (see helpers.node.ts). The probe runs in the awaited
 * `didStart` hook during startup, so a stalled telemetry call must never be able to starve startup.
 *
 * This replaces a flaky real-Python native contract test: the property is pure Node logic (a timer
 * cancels the wait once the remaining startup budget runs low), so it is verified here with fake
 * timers and fake session/startup objects — no real kernel, no wall-clock race. The test fails if the
 * cap/timer is removed (the probe would then hang forever on the stalled bookkeeping call).
 */
suite('sendTelemetryForPythonKernelExecutable - startup budget cap', () => {
    let clock: sinon.SinonFakeTimers;
    let executeSilentlyStub: sinon.SinonStub;
    let trackStub: sinon.SinonStub;
    let startupTokenSource: CancellationTokenSource;
    let hookTokenSource: CancellationTokenSource;

    // A local Python kernel spec, so the probe's guards (interpreter + Python + local spec) all pass.
    const metadata = LocalKernelSpecConnectionMetadata.create({
        id: 'test-kernel',
        interpreter: { id: 'python', uri: Uri.file('/usr/bin/python') },
        kernelSpec: {
            name: 'python3',
            language: 'python',
            display_name: 'Python 3',
            executable: '/usr/bin/python',
            argv: ['python']
        }
    });

    // Minimal local-raw session; only the kernel status and the startup coordinator are read.
    const makeSession = (startup: IKernelStartup): IKernelSession =>
        ({ kind: 'localRaw', kernel: { status: 'idle' }, startup }) as unknown as IKernelSession;

    // Minimal startup coordinator exposing only the remaining budget and a live token.
    const makeStartup = (remainingTime: number): IKernelStartup =>
        ({ remainingTime, token: startupTokenSource.token }) as unknown as IKernelStartup;

    setup(() => {
        clock = sinon.useFakeTimers();
        startupTokenSource = new CancellationTokenSource();
        hookTokenSource = new CancellationTokenSource();
        executeSilentlyStub = sinon.stub(helpers, 'executeSilently');
        // The probe prints sys.executable; return a matching stdout stream so parsing succeeds.
        executeSilentlyStub.resolves([{ output_type: 'stream', name: 'stdout', text: '/usr/bin/python' }] as never);
        trackStub = sinon.stub(telemetryHelper, 'trackKernelResourceInformation');
    });

    teardown(() => {
        startupTokenSource.dispose();
        hookTokenSource.dispose();
        sinon.restore();
    });

    test('cancels a stalled telemetry probe at the budget cap so startup is never starved', async () => {
        // remainingTime 3000 => cap = min(5000, max(0, 3000 - 1000)) = 2000ms.
        const bookkeeping = createDeferred<void>();
        // Never settles: without the cap the awaited probe would hang startup forever.
        trackStub.returns(bookkeeping.promise);

        let settled = false;
        const probe = sendTelemetryForPythonKernelExecutable(
            makeSession(makeStartup(3000)),
            Uri.file('/work/test.ipynb'),
            metadata,
            hookTokenSource.token
        ).then(() => (settled = true));

        // Let executeSilently resolve and the probe reach the (stalled) bookkeeping await.
        await clock.tickAsync(0);
        assert.isTrue(trackStub.calledOnce, 'The executable probe must actually run (entered bookkeeping)');
        assert.isDefined(
            trackStub.firstCall.args[1].interpreterMatchesKernel,
            'The probe must report an interpreter comparison result'
        );

        // Just before the cap elapses it is still waiting on the stalled bookkeeping call.
        await clock.tickAsync(1999);
        assert.isFalse(settled, 'The probe resolved before the cap elapsed');

        // At the cap the probe is cancelled and startup proceeds, even though bookkeeping never settled.
        await clock.tickAsync(1);
        assert.isTrue(settled, 'The cap did not release the stalled probe; startup would be starved if reverted');
        assert.isFalse(
            bookkeeping.completed,
            'The cap stops waiting on the probe; it does not settle the underlying work'
        );
        assert.isTrue(
            executeSilentlyStub.firstCall.args[3].isCancellationRequested,
            'The probe execution token should be cancelled at the cap'
        );

        await probe;
    });

    test('skips the probe entirely when there is no budget left to spend', async () => {
        // remainingTime 1000 => cap = min(5000, max(0, 1000 - 1000)) = 0 -> skip before touching the kernel.
        await sendTelemetryForPythonKernelExecutable(
            makeSession(makeStartup(1000)),
            Uri.file('/work/test.ipynb'),
            metadata,
            hookTokenSource.token
        );

        assert.isFalse(executeSilentlyStub.called, 'No executable probe should run when the cap is zero');
        assert.isFalse(trackStub.called, 'No telemetry should be recorded when the probe is skipped');
    });
});
