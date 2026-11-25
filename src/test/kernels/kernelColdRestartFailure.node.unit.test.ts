// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import { CancellationError, Uri } from 'vscode';
import { createDeferred, raceTimeout } from '../../platform/common/utils/async';
import { noop } from '../../platform/common/utils/misc';
import { generateUuid } from '../../platform/common/uuid';
import { createStartupKernel, initializeStartupMocks } from './rawStartup.node';
import { IKernelSession, IKernelSessionFactory, LocalKernelSpecConnectionMetadata } from '../../kernels/types';

/**
 * Regression coverage for review comment #2: a COLD kernel restart (no live session to reuse) whose
 * fresh start fails must surface the REAL startup error, not a CancellationError.
 *
 * The restart tracks its liveness with a dedicated "lifecycle" cancellation token, separate from
 * `startCancellation`. `startJupyterSession()` cancels `startCancellation` on a failed start, but that
 * no longer trips the restart's lifecycle token, so the real error propagates. Genuine external
 * cancellation (a newer restart, or shutdown/dispose) cancels the lifecycle token and still aborts the
 * restart as a CancellationError.
 */
suite('Kernel cold restart failure attribution', () => {
    const metadata = LocalKernelSpecConnectionMetadata.create({
        id: generateUuid(),
        kernelSpec: {
            name: 'python3',
            language: 'python',
            display_name: 'Cold restart fixture',
            executable: 'python',
            argv: ['python', '-m', 'ipykernel_launcher', '-f', '{connection_file}']
        }
    });

    setup(() => initializeStartupMocks());

    test('a cold restart whose fresh start fails surfaces the real error, not a cancellation', async () => {
        const boom = new Error('kernel failed to launch');
        const factory = mock<IKernelSessionFactory>();
        when(factory.create(anything())).thenCall(async () => {
            throw boom;
        });
        const kernel = createStartupKernel(Uri.file('cold.ipynb'), metadata, instance(factory), 5000);
        let restarted = 0;
        kernel.onRestarted(() => (restarted += 1));
        try {
            const error = await kernel.restart().then(
                () => undefined,
                (e) => e
            );
            assert.notInstanceOf(
                error,
                CancellationError,
                'The real startup error must not be masked as a CancellationError'
            );
            assert.strictEqual(
                (error as { originalException?: unknown }).originalException,
                boom,
                'The real startup error must be preserved (wrapped) and propagated'
            );
            assert.strictEqual(restarted, 0, 'A failed restart must not fire a restarted event');
        } finally {
            await kernel.dispose();
        }
    });

    test('a cold restart superseded by a newer restart reports cancellation', async () => {
        const entered = createDeferred<void>();
        const gate = createDeferred<IKernelSession>();
        const factory = mock<IKernelSessionFactory>();
        when(factory.create(anything())).thenCall(() => {
            entered.resolve();
            return gate.promise;
        });
        const kernel = createStartupKernel(Uri.file('cold-supersede.ipynb'), metadata, instance(factory), 5000);
        const first = kernel.restart().then(
            () => undefined,
            (e) => e
        );
        try {
            // Wait until the first cold restart is blocked inside the fresh start.
            await raceTimeout(2000, entered.promise);
            // A newer restart supersedes the first; it must report cancellation, not the stalled start.
            const second = kernel.restart().then(
                () => undefined,
                (e) => e
            );
            assert.instanceOf(
                await raceTimeout(2000, first),
                CancellationError,
                'A superseded cold restart must report cancellation'
            );
            gate.reject(new CancellationError());
            await Promise.allSettled([first, second]);
        } finally {
            gate.reject(new CancellationError());
            await first.catch(noop);
            await kernel.dispose();
        }
    });

    test('shutdown during a blocked cold restart reports cancellation', async () => {
        const entered = createDeferred<void>();
        const gate = createDeferred<IKernelSession>();
        const factory = mock<IKernelSessionFactory>();
        when(factory.create(anything())).thenCall(() => {
            entered.resolve();
            return gate.promise;
        });
        const kernel = createStartupKernel(Uri.file('cold-shutdown.ipynb'), metadata, instance(factory), 5000);
        const restart = kernel.restart().then(
            () => undefined,
            (e) => e
        );
        try {
            await raceTimeout(2000, entered.promise);
            // Shutdown cancels the restart lifecycle synchronously before awaiting the stalled session.
            const shutdown = kernel.shutdown().catch(noop);
            assert.instanceOf(
                await raceTimeout(2000, restart),
                CancellationError,
                'A cold restart aborted by shutdown must report cancellation'
            );
            gate.reject(new CancellationError());
            await Promise.allSettled([restart, shutdown]);
        } finally {
            gate.reject(new CancellationError());
            await restart.catch(noop);
            await kernel.dispose();
        }
    });
});
