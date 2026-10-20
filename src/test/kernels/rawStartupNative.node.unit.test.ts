// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as path from '../../platform/vscode-path/path';
import { raceTimeout } from '../../platform/common/utils/async';
import { generateUuid } from '../../platform/common/uuid';
import { logger } from '../../platform/logging';
import * as sinon from 'sinon';
import { resetVSCodeMocks } from '../vscode-mock';
import { NativeStartupFixture, NativeStartupProcess } from './rawStartupNative.node';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fsExtra = require('fs-extra') as typeof import('fs-extra');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const interpreterHelpers =
    require('../../platform/interpreter/helpers') as typeof import('../../platform/interpreter/helpers');

const initializationTimeout = 1_000;
const disposalTimeout = 1_000;

type InitializationOutcome = { kind: 'resolved' } | { kind: 'rejected'; error: unknown };

function createMissingInterpreterPath() {
    return path.join(process.cwd(), `.review-regression-native-spawn-${generateUuid()}.exe`);
}

function createUnusedRuntimePath() {
    return path.join(process.cwd(), `.review-regression-native-runtime-${generateUuid()}`);
}

async function captureInitialization(initialization: Promise<void>): Promise<InitializationOutcome | undefined> {
    const outcome = initialization.then<InitializationOutcome, InitializationOutcome>(
        () => ({ kind: 'resolved' }),
        (error: unknown) => ({ kind: 'rejected', error })
    );
    return raceTimeout(initializationTimeout, outcome);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
    return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string';
}

function assertMissingInterpreterFailure(outcome: InitializationOutcome | undefined) {
    assert.isDefined(outcome, 'The real missing-interpreter spawn did not settle inside its assertion guard');
    if (!outcome) {
        throw new Error('The real missing-interpreter spawn did not settle');
    }
    assert.strictEqual(outcome.kind, 'rejected', 'The real missing-interpreter spawn unexpectedly initialized');
    if (outcome.kind !== 'rejected') {
        throw new Error('The real missing-interpreter spawn unexpectedly initialized');
    }
    if (!isErrnoException(outcome.error)) {
        throw new Error('The real missing-interpreter spawn rejected with a non-system error');
    }
    assert.strictEqual(outcome.error.code, 'ENOENT', 'Initialization must preserve the original spawn error code');
}

async function assertDisposalSettles(disposal: Promise<void>, description: string) {
    const settled = await raceTimeout(
        disposalTimeout,
        disposal.then(() => true)
    );
    assert.strictEqual(settled, true, `${description} did not settle inside its explicit assertion guard`);
}

async function getCreatedRoot(spy: sinon.SinonSpy, callIndex: number): Promise<string> {
    assert.isAtLeast(spy.callCount, callIndex + 1, 'The fixture did not create its owned temporary root');
    const root = await spy.returnValues[callIndex];
    assert.isString(root, 'The fixture temporary root was not captured from fs.mkdtemp');
    if (typeof root !== 'string') {
        throw new Error('The fixture temporary root was not captured from fs.mkdtemp');
    }
    return root;
}

async function collectCreatedRoots(spy: sinon.SinonSpy, roots: Set<string>) {
    for (const root of spy.returnValues) {
        const resolvedRoot = await root;
        if (typeof resolvedRoot === 'string') {
            roots.add(resolvedRoot);
        }
    }
}

function isRestorableSpy(value: unknown): value is { restore(): void } {
    return typeof value === 'function' && 'restore' in value && typeof value.restore === 'function';
}

function restoreOwnedConnectionSpy(current: unknown, original: unknown) {
    if (current !== original && isRestorableSpy(current)) {
        current.restore();
    }
}

async function removeKnownEmptyRoots(roots: Iterable<string>) {
    for (const root of roots) {
        if (await fsExtra.pathExists(root)) {
            if ((await fsExtra.readdir(root)).length === 0) {
                await fsExtra.remove(root);
            }
        }
    }
}

suite('Review regression native spawn cleanup', function () {
    this.timeout(10_000);

    test('Review regression native spawn error and close settle process disposal without a successful exit', async () => {
        const interpreter = createMissingInterpreterPath();
        assert.isFalse(await fsExtra.pathExists(interpreter), 'The owned missing interpreter path unexpectedly exists');

        const process = new NativeStartupProcess(interpreter, createUnusedRuntimePath(), false);
        const exits: Array<{ exitCode?: number }> = [];
        const subscription = process.exited((event) => exits.push(event));
        try {
            assertMissingInterpreterFailure(await captureInitialization(process.initialize()));
            assert.isUndefined(process.pid, 'A missing executable must not start a child process');

            await assertDisposalSettles(process.dispose(), 'Failed native spawn process disposal');
            assert.isTrue(process.isDisposed, 'Failed native spawn error/close must reach terminal disposal');
            await assertDisposalSettles(process.dispose(), 'Repeated failed native spawn process disposal');

            assert.strictEqual(exits.length, 1, 'Failed native spawn must emit exactly one terminal exit event');
            assert.isTrue(
                exits.every((event) => event.exitCode !== 0),
                'Failed native spawn cleanup must not fabricate a successful exit code'
            );
        } finally {
            subscription.dispose();
        }
    });

    test('Review regression native spawn fixture disposal restores partial initialization resources', async () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const services =
            require('@jupyterlab/services/lib/kernel/default') as typeof import('@jupyterlab/services/lib/kernel/default');
        const originalSendShellMessage = services.KernelConnection.prototype.sendShellMessage;
        const mkdtempSpy = sinon.spy(fsExtra, 'mkdtemp');
        const pythonApiSetter = sinon.stub(interpreterHelpers, 'setPythonApi');
        const roots = new Set<string>();
        let firstFixture: NativeStartupFixture | undefined;
        let nextFixture: NativeStartupFixture | undefined;
        let hasTestFailure = false;

        try {
            const firstInterpreter = createMissingInterpreterPath();
            assert.isFalse(
                await fsExtra.pathExists(firstInterpreter),
                'The first owned missing interpreter path unexpectedly exists'
            );
            firstFixture = new NativeStartupFixture(firstInterpreter, false);
            const firstInitialization = await captureInitialization(firstFixture.initialize());
            const firstRoot = await getCreatedRoot(mkdtempSpy, 0);
            roots.add(firstRoot);
            assertMissingInterpreterFailure(firstInitialization);
            assert.isDefined(firstFixture.process, 'The fixture must expose the partially initialized process');
            assert.isUndefined(
                firstFixture.kernel,
                'The fixture must remain partially initialized after spawn failure'
            );
            assert.isTrue(
                await fsExtra.pathExists(firstRoot),
                'The partially initialized fixture must own its temporary root'
            );

            await assertDisposalSettles(firstFixture.dispose(), 'Partially initialized native fixture disposal');
            assert.isFalse(
                await fsExtra.pathExists(firstRoot),
                'Fixture disposal must remove its owned temporary root'
            );
            assert.strictEqual(
                services.KernelConnection.prototype.sendShellMessage,
                originalSendShellMessage,
                'Fixture disposal must restore its owned Services spy'
            );
            await assertDisposalSettles(
                firstFixture.dispose(),
                'Repeated partially initialized native fixture disposal'
            );

            const nextInterpreter = createMissingInterpreterPath();
            assert.isFalse(
                await fsExtra.pathExists(nextInterpreter),
                'The next owned missing interpreter path unexpectedly exists'
            );
            nextFixture = new NativeStartupFixture(nextInterpreter, false);
            const nextInitialization = await captureInitialization(nextFixture.initialize());
            const nextRoot = await getCreatedRoot(mkdtempSpy, 1);
            roots.add(nextRoot);
            assertMissingInterpreterFailure(nextInitialization);
            assert.isTrue(
                await fsExtra.pathExists(nextRoot),
                'The next partially initialized fixture must own its temporary root'
            );

            await assertDisposalSettles(
                nextFixture.dispose(),
                'Next native fixture disposal after Services spy restoration'
            );
            assert.isFalse(
                await fsExtra.pathExists(nextRoot),
                'Next fixture disposal must remove its owned temporary root'
            );
            assert.strictEqual(
                services.KernelConnection.prototype.sendShellMessage,
                originalSendShellMessage,
                'The next fixture must install and restore the same Services spy without wrapping errors'
            );
            await assertDisposalSettles(nextFixture.dispose(), 'Repeated next native fixture disposal');
        } catch (error) {
            hasTestFailure = true;
            throw error;
        } finally {
            let cleanupFailure: unknown;
            let hasCleanupFailure = false;
            const captureCleanupFailure = (error: unknown) => {
                if (!hasCleanupFailure) {
                    cleanupFailure = error;
                    hasCleanupFailure = true;
                }
                logger.error(
                    hasTestFailure
                        ? 'Native startup fixture test cleanup failed after a test failure'
                        : 'Native startup fixture test cleanup failed',
                    error
                );
            };

            if (firstFixture) {
                try {
                    await assertDisposalSettles(
                        firstFixture.dispose(),
                        'Partially initialized native fixture disposal'
                    );
                } catch (error) {
                    captureCleanupFailure(error);
                }
            }
            if (nextFixture) {
                try {
                    await assertDisposalSettles(
                        nextFixture.dispose(),
                        'Next native fixture disposal after Services spy restoration'
                    );
                } catch (error) {
                    captureCleanupFailure(error);
                }
            }
            try {
                await collectCreatedRoots(mkdtempSpy, roots);
            } catch (error) {
                captureCleanupFailure(error);
            }
            try {
                restoreOwnedConnectionSpy(
                    services.KernelConnection.prototype.sendShellMessage,
                    originalSendShellMessage
                );
            } catch (error) {
                captureCleanupFailure(error);
            }
            try {
                await removeKnownEmptyRoots(roots);
            } catch (error) {
                captureCleanupFailure(error);
            }
            try {
                mkdtempSpy.restore();
            } catch (error) {
                captureCleanupFailure(error);
            } finally {
                try {
                    pythonApiSetter.restore();
                } catch (error) {
                    captureCleanupFailure(error);
                } finally {
                    try {
                        resetVSCodeMocks();
                    } catch (error) {
                        captureCleanupFailure(error);
                    }
                }
            }
            if (hasCleanupFailure && !hasTestFailure) {
                throw cleanupFailure;
            }
        }
    });
});
