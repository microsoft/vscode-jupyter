// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { DisplayOptions } from '../../displayOptions';
import { executeSilently } from '../../helpers';
import { RawKernelStartupFixture } from '../../../test/datascience/rawKernelStartupFixture.node';
import {
    createRawStartupTestContext,
    initializeRawStartupTestApi
} from '../../../test/datascience/rawKernelStartupTestContext.node';
import { raceTimeoutError } from '../../../platform/common/utils/async';
import { noop } from '../../../platform/common/utils/misc';

(process.platform === 'win32' ? suite : suite.skip)('Raw kernel startup recovery (native transport)', () => {
    let api: ReturnType<typeof initializeRawStartupTestApi>;
    setup(() => {
        api = initializeRawStartupTestApi();
    });
    teardown(() => api.dispose());

    for (let repetition = 0; repetition < 20; repetition += 1) {
        test(`recovers original startup and first cell without replay (${repetition + 1})`, async () => {
            const fixture = await new RawKernelStartupFixture().start();
            const context = createRawStartupTestContext(fixture);
            let published = 0;
            const listener = context.kernel.onStarted(() => (published += 1));
            const startedAt = performance.now();
            const startup = context.kernel.start(new DisplayOptions(true));
            startup.catch(noop);
            try {
                const session = await raceTimeoutError(
                    5000,
                    new Error('Original queued startup execution remained pending instead of recovering'),
                    startup
                );
                assert.strictEqual(context.kernel.session, session);
                assert.strictEqual(context.kernel.status, 'idle');
                assert.strictEqual(published, 1);
                assert.isAtLeast(fixture.recoveryIdentities.size, 1);
                assert.strictEqual(
                    fixture.executions.filter((code) => code.includes('_VSCODE_sys.executable')).length,
                    1
                );
                assert.isTrue([...fixture.executionIds.values()].every((count) => count === 1));
                const before = fixture.executions.length;
                await raceTimeoutError(
                    1000,
                    new Error('First cell did not complete'),
                    executeSilently(session.kernel!, 'pass')
                );
                assert.strictEqual(fixture.executions.length, before + 1);
                assert.isBelow(
                    performance.now() - startedAt,
                    2000,
                    'Fast fixture startup and first cell must finish within two seconds'
                );
            } finally {
                listener.dispose();
                await context.dispose();
            }
        }).timeout(9000);
    }
});
