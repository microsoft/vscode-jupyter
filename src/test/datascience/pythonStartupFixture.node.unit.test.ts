// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import childProcess = require('child_process');
import type { ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { assert } from 'chai';
import * as sinon from 'sinon';
import { PythonStartupFixture } from './pythonStartupFixture.node';

interface FakeChild extends ChildProcessWithoutNullStreams {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    closed: boolean;
    stdinWrites: string[];
    killCalls: number;
    close(): void;
}

interface FakeChildOptions {
    readonly closeOnStopWrite?: boolean;
    readonly closeOnEof?: boolean;
    readonly closeOnKill?: boolean;
    readonly killError?: Error;
    readonly killResult?: boolean;
    readonly pid?: number;
}

function createFakeChild(options: FakeChildOptions = {}): FakeChild {
    const child = new EventEmitter() as FakeChild;
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.closed = false;
    child.stdinWrites = [];
    child.killCalls = 0;
    Object.defineProperty(child, 'pid', {
        configurable: true,
        value: 'pid' in options ? options.pid : 1234
    });
    Object.defineProperty(child, 'exitCode', {
        configurable: true,
        value: null,
        writable: true
    });
    child.close = () => {
        if (!child.closed) {
            child.closed = true;
            Object.defineProperty(child, 'exitCode', {
                configurable: true,
                value: 0,
                writable: true
            });
            child.emit('close', 0);
        }
    };
    child.stdin.on('data', (value: Buffer) => {
        child.stdinWrites.push(value.toString());
        if (options.closeOnStopWrite !== false && value.toString() === 'stop\n') {
            child.close();
        }
    });
    child.stdin.once('finish', () => {
        if (options.closeOnEof !== false) {
            child.close();
        }
    });
    child.kill = () => {
        child.killCalls += 1;
        if (options.killError) {
            throw options.killError;
        }
        if (options.closeOnKill !== false) {
            child.close();
        }
        return options.killResult ?? true;
    };
    return child;
}

function emitStarted(child: FakeChild) {
    child.stdout.write(
        JSON.stringify({
            event: 'started',
            pid: 4321,
            connection: {
                ip: '127.0.0.1',
                transport: 'tcp',
                key: 'fixture-key',
                signature_scheme: 'hmac-sha256',
                shell_port: 1,
                iopub_port: 2,
                control_port: 3,
                stdin_port: 4,
                hb_port: 5
            }
        }) + '\n'
    );
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
        assert.fail('Expected Python fixture operation to reject');
    }
    if (!(failure instanceof Error)) {
        assert.fail('Expected Python fixture operation to reject with an Error');
    }
    return failure;
}

async function flushPromises() {
    await Promise.resolve();
    await Promise.resolve();
}

function release(child: FakeChild) {
    child.close();
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
}

suite('Python startup fixture', () => {
    test('review regression: cleans its child before reporting readiness timeout', async () => {
        const child = createFakeChild();
        const clock = sinon.useFakeTimers();
        const spawnStub = sinon.stub(childProcess, 'spawn').returns(child);

        try {
            const startup = new PythonStartupFixture('python', false).start();
            clock.tick(10_000);

            const startupError = await captureFailure(startup);
            assert.strictEqual(startupError.message, 'Python fixture did not initialize');
            assert.isTrue(
                child.closed,
                'The fixture must close its spawned child before reporting a readiness failure'
            );
        } finally {
            release(child);
            spawnStub.restore();
            clock.restore();
        }
    });

    test('stops a ready child through stdin without force-stopping it', async () => {
        const child = createFakeChild();
        const spawnStub = sinon.stub(childProcess, 'spawn').returns(child);

        try {
            const fixture = new PythonStartupFixture('python', false);
            emitStarted(child);
            await fixture.start();

            await fixture.stop();

            assert.deepEqual(child.stdinWrites, ['stop\n']);
            assert.strictEqual(child.killCalls, 0);
            assert.isTrue(child.closed);
            await fixture.termination;
        } finally {
            release(child);
            spawnStub.restore();
        }
    });

    test('uses EOF to stop a ready child when requested', async () => {
        const child = createFakeChild({ closeOnStopWrite: false });
        const spawnStub = sinon.stub(childProcess, 'spawn').returns(child);

        try {
            const fixture = new PythonStartupFixture('python', false, { sendEofOnStop: true });
            emitStarted(child);
            await fixture.start();

            await fixture.stop();

            assert.deepEqual(child.stdinWrites, []);
            assert.strictEqual(child.killCalls, 0);
            assert.isTrue(child.closed);
            assert.isFalse(fixture.didForceStop);
        } finally {
            release(child);
            spawnStub.restore();
        }
    });

    test('force-stops only its captured child after the stdin grace period', async () => {
        const child = createFakeChild({ closeOnStopWrite: false });
        const clock = sinon.useFakeTimers();
        const spawnStub = sinon.stub(childProcess, 'spawn').returns(child);

        try {
            const fixture = new PythonStartupFixture('python', false);
            emitStarted(child);
            await fixture.start();

            const stopping = fixture.stop();
            assert.strictEqual(fixture.stop(), stopping);
            assert.deepEqual(child.stdinWrites, ['stop\n']);
            clock.tick(3_999);
            await flushPromises();
            assert.strictEqual(child.killCalls, 0);

            await clock.tickAsync(1);
            assert.strictEqual(child.killCalls, 1, 'The captured child must be force-stopped at the grace boundary');
            await stopping;

            assert.strictEqual(child.killCalls, 1);
            assert.isTrue(fixture.didForceStop);
            assert.isTrue(child.closed);
        } finally {
            release(child);
            spawnStub.restore();
            clock.restore();
        }
    });

    test('reports a false force-stop result after the captured child closes', async () => {
        const child = createFakeChild({ closeOnStopWrite: false, killResult: false });
        const clock = sinon.useFakeTimers();
        const spawnStub = sinon.stub(childProcess, 'spawn').returns(child);

        try {
            const fixture = new PythonStartupFixture('python', false);
            emitStarted(child);
            await fixture.start();

            const stopping = fixture.stop();
            clock.tick(4_000);
            await flushPromises();

            const failure = await captureFailure(stopping);
            assert.strictEqual(failure.message, 'Failed to force-stop owned Python fixture child');
            assert.strictEqual(fixture.lastCleanupError, failure);
            assert.strictEqual(child.killCalls, 1);
            assert.isTrue(child.closed);
        } finally {
            release(child);
            spawnStub.restore();
            clock.restore();
        }
    });

    test('reports a force-stop error when the captured child never closes', async () => {
        const killFailure = new Error('kill failed');
        const child = createFakeChild({
            closeOnStopWrite: false,
            closeOnKill: false,
            killError: killFailure
        });
        const clock = sinon.useFakeTimers();
        const spawnStub = sinon.stub(childProcess, 'spawn').returns(child);

        try {
            const fixture = new PythonStartupFixture('python', false);
            emitStarted(child);
            await fixture.start();

            const stopping = fixture.stop();
            clock.tick(4_000);
            await flushPromises();
            clock.tick(1_000);
            await flushPromises();

            const failure = await captureFailure(stopping);
            assert.include(failure.message, 'kill failed');
            assert.strictEqual(fixture.lastCleanupError, failure);
            assert.strictEqual(child.killCalls, 1);
        } finally {
            release(child);
            spawnStub.restore();
            clock.restore();
        }
    });

    test('retains a child error that arrives after readiness for cleanup', async () => {
        const child = createFakeChild();
        const spawnStub = sinon.stub(childProcess, 'spawn').returns(child);

        try {
            const fixture = new PythonStartupFixture('python', false);
            emitStarted(child);
            await fixture.start();

            const childFailure = new Error('child failed after readiness');
            child.emit('error', childFailure);
            child.close();

            const failure = await captureFailure(fixture.stop());
            assert.strictEqual(failure, childFailure);
            assert.strictEqual(fixture.lastCleanupError, childFailure);
            await fixture.termination;
        } finally {
            release(child);
            spawnStub.restore();
        }
    });

    test('retains a stream failure that arrives after readiness for cleanup', async () => {
        const child = createFakeChild();
        const spawnStub = sinon.stub(childProcess, 'spawn').returns(child);

        try {
            const fixture = new PythonStartupFixture('python', false);
            emitStarted(child);
            await fixture.start();

            child.stdout.emit('error', new Error('stdout failed after readiness'));

            const failure = await captureFailure(fixture.stop());
            assert.include(failure.message, 'stdout failed after readiness');
            assert.strictEqual(fixture.lastCleanupError, failure);
            assert.isTrue(child.closed);
        } finally {
            release(child);
            spawnStub.restore();
        }
    });

    test('preserves readiness failure and reports cleanup timeout without awaiting a never-closing child', async () => {
        const child = createFakeChild({ closeOnStopWrite: false, closeOnKill: false });
        const clock = sinon.useFakeTimers();
        const spawnStub = sinon.stub(childProcess, 'spawn').returns(child);

        try {
            const fixture = new PythonStartupFixture('python', false);
            const startup = fixture.start();
            let observedFailure: unknown;
            void startup.then(undefined, (error) => {
                observedFailure = error;
            });

            await clock.tickAsync(10_000);
            await clock.tickAsync(4_000);
            await clock.tickAsync(1_000);

            if (!(observedFailure instanceof Error)) {
                assert.fail('Readiness failure must settle after its bounded cleanup budget');
            }
            assert.strictEqual(observedFailure.message, 'Python fixture did not initialize');
            const cleanupFailure = (observedFailure as Error & { cleanupFailure?: Error }).cleanupFailure;
            assert.instanceOf(cleanupFailure, Error, 'The primary readiness error must include the cleanup diagnostic');
            assert.strictEqual(fixture.lastCleanupError, cleanupFailure);
            assert.strictEqual(child.killCalls, 1);
            assert.isFalse(child.closed);
            await captureFailure(startup);
        } finally {
            release(child);
            spawnStub.restore();
            clock.restore();
        }
    });

    test('does not wait for an impossible close after a failed spawn', async () => {
        const spawnFailure = new Error('spawn failed');
        const spawnStub = sinon.stub(childProcess, 'spawn').throws(spawnFailure);

        try {
            const fixture = new PythonStartupFixture('python', false);
            const failure = await captureFailure(fixture.start());

            assert.strictEqual(failure, spawnFailure);
            await fixture.termination;
        } finally {
            spawnStub.restore();
        }
    });

    test('settles an asynchronous spawn error without a pid', async () => {
        const child = createFakeChild({ pid: undefined });
        const spawnStub = sinon.stub(childProcess, 'spawn').returns(child);

        try {
            const fixture = new PythonStartupFixture('python', false);
            const spawnFailure = new Error('spawn failed asynchronously');
            child.emit('error', spawnFailure);

            const failure = await captureFailure(fixture.start());
            assert.strictEqual(failure, spawnFailure);
            await fixture.termination;
        } finally {
            release(child);
            spawnStub.restore();
        }
    });

    test('does not wait for an impossible close when spawn has no pid', async () => {
        const child = createFakeChild({ closeOnStopWrite: false, pid: undefined });
        const clock = sinon.useFakeTimers();
        const spawnStub = sinon.stub(childProcess, 'spawn').returns(child);

        try {
            const fixture = new PythonStartupFixture('python', false);
            const startup = fixture.start();
            clock.tick(10_000);

            const failure = await captureFailure(startup);
            assert.strictEqual(failure.message, 'Python fixture did not initialize');
            assert.strictEqual(child.killCalls, 0);
            await fixture.termination;
        } finally {
            release(child);
            spawnStub.restore();
            clock.restore();
        }
    });

    test('observes a child that closed before listeners were attached', async () => {
        const child = createFakeChild();
        child.close();
        const spawnStub = sinon.stub(childProcess, 'spawn').returns(child);

        try {
            const fixture = new PythonStartupFixture('python', false);
            const failure = await captureFailure(fixture.start());

            assert.strictEqual(failure.message, 'Python fixture failed to start: ');
            await fixture.termination;
        } finally {
            release(child);
            spawnStub.restore();
        }
    });
});
