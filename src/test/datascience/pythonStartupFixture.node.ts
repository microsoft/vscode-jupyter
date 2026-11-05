// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChildProcess, spawn } from 'child_process';
import { EventEmitter as NodeEventEmitter } from 'events';
import { createInterface, Interface } from 'readline';
import * as path from '../../platform/vscode-path/path';
import { EventEmitter } from 'vscode';
import { IKernelConnection, IKernelProcess } from '../../kernels/raw/types';
import { LocalKernelSpecConnectionMetadata } from '../../kernels/types';
import { ObservableDisposable } from '../../platform/common/utils/lifecycle';
import { createDeferred, raceTimeout, raceTimeoutError } from '../../platform/common/utils/async';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../constants.node';
import { noop } from '../../platform/common/utils/misc';

const startupTimeout = 10_000;
const gracefulStopTimeout = 4_000;
const cleanupTimeout = 5_000;

export interface PythonStartupFixtureOptions {
    readonly omitReady?: boolean;
    readonly ignoreStop?: boolean;
    readonly sendEofOnStop?: boolean;
}

interface PythonStartupFixtureStartupError extends Error {
    cleanupFailure?: Error;
}

function isConnection(value: unknown): value is IKernelConnection {
    return (
        typeof value === 'object' &&
        value !== null &&
        'ip' in value &&
        value.ip === '127.0.0.1' &&
        'transport' in value &&
        value.transport === 'tcp' &&
        'key' in value &&
        typeof value.key === 'string' &&
        'signature_scheme' in value &&
        value.signature_scheme === 'hmac-sha256' &&
        ['shell_port', 'iopub_port', 'control_port', 'stdin_port', 'hb_port'].every(
            (name) => Reflect.has(value, name) && typeof Reflect.get(value, name) === 'number'
        )
    );
}

function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

export class PythonStartupFixture {
    public connection!: IKernelConnection;
    public pid?: number;
    public exitCode?: number | null;
    private readonly ready = createDeferred<void>();
    private readonly exited = createDeferred<void>();
    public readonly termination: Promise<void> = this.exited.promise;
    private readonly events = new Set<string>();
    private readonly fixtureEvents = new NodeEventEmitter();
    private readonly streamFailure = createDeferred<Error>();
    private stderr = '';
    private child?: ChildProcess;
    private output?: Interface;
    private closed = false;
    private readyForUse = false;
    private streamsReleased = false;
    private stopPromise?: Promise<void>;
    private cleanupError?: Error;
    private childFailure?: Error;
    private forceStopFailure?: Error;
    private forceStopRequested = false;

    constructor(
        public readonly interpreter: string,
        unrecoverable: boolean,
        private readonly options: PythonStartupFixtureOptions = {}
    ) {
        this.ready.promise.catch(noop);
        try {
            const child = spawn(
                interpreter,
                [
                    '-u',
                    path.join(
                        EXTENSION_ROOT_DIR_FOR_TESTS,
                        'src',
                        'test',
                        'datascience',
                        'fixtures',
                        'rawKernelStartup.py'
                    ),
                    ...(unrecoverable ? ['--unrecoverable'] : []),
                    ...(options.omitReady ? ['--omit-ready'] : []),
                    ...(options.ignoreStop ? ['--ignore-stop'] : []),
                    ...(options.sendEofOnStop ? ['--expect-eof'] : [])
                ],
                { stdio: ['pipe', 'pipe', 'pipe'] }
            );
            this.child = child;
            this.observeChild(child);
        } catch (error) {
            this.failReadiness(asError(error));
            this.completeClose();
        }
    }

    public get didForceStop() {
        return this.forceStopRequested;
    }

    public get lastCleanupError() {
        return this.cleanupError;
    }

    public async start(): Promise<this> {
        try {
            await raceTimeoutError(startupTimeout, new Error('Python fixture did not initialize'), this.ready.promise);
            return this;
        } catch (error) {
            const primary = asError(error) as PythonStartupFixtureStartupError;
            try {
                await this.stop();
            } catch (cleanupError) {
                primary.cleanupFailure = asError(cleanupError);
            }
            throw primary;
        }
    }

    public async waitFor(event: string): Promise<void> {
        if (this.events.has(event)) {
            return;
        }
        if (this.closed) {
            throw new Error('Python fixture exited: ' + this.stderr);
        }

        const received = createDeferred<void>();
        const onEvent = (name: string) => {
            if (name === event) {
                received.resolve();
            }
        };
        const onClose = () => received.reject(new Error('Python fixture exited: ' + this.stderr));
        this.fixtureEvents.on('event', onEvent);
        this.fixtureEvents.once('closed', onClose);
        try {
            await raceTimeoutError(4000, new Error('Missing Python fixture event: ' + event), received.promise);
        } finally {
            this.fixtureEvents.removeListener('event', onEvent);
            this.fixtureEvents.removeListener('closed', onClose);
        }
    }

    public stop(): Promise<void> {
        this.stopPromise ??= this.stopInternal();
        return this.stopPromise;
    }

    public createProcess(metadata: LocalKernelSpecConnectionMetadata): IKernelProcess {
        const backend = this;
        return new (class extends ObservableDisposable implements IKernelProcess {
            public readonly connection = backend.connection;
            public readonly kernelConnectionMetadata = metadata;
            public readonly pid = backend.pid;
            public readonly canInterrupt = false;
            public readonly termination: Promise<void> = backend.termination;
            private readonly exitEvent = this._register(
                new EventEmitter<{ exitCode?: number; reason?: string; stderr: string }>()
            );
            public readonly exited = this.exitEvent.event;
            private stopping = false;
            public interrupt(): Promise<void> {
                return Promise.resolve();
            }
            public override dispose() {
                if (this.stopping) {
                    return;
                }
                this.stopping = true;
                void backend.stop().catch(noop);
                void this.termination.then(() => {
                    this.exitEvent.fire({
                        exitCode: backend.exitCode ?? -1,
                        reason: backend.lastCleanupError?.message,
                        stderr: backend.stderr
                    });
                    super.dispose();
                });
            }
        })();
    }

    private observeChild(child: ChildProcess) {
        child.on('error', this.onChildError);
        child.once('close', this.onChildClose);
        const { stdin, stdout, stderr } = child;
        if (!stdin || !stdout || !stderr) {
            this.onStreamError(new Error('Python fixture failed to open stdio'));
            if (child.pid === undefined) {
                this.completeClose();
            }
            return;
        }
        try {
            stderr.setEncoding('utf8');
            stderr.on('data', this.onStderr);
            stderr.on('error', this.onStreamError);
            stdout.on('error', this.onStreamError);
            stdin.on('error', this.onStreamError);
            this.output = createInterface({ input: stdout });
            this.output.on('line', this.onOutputLine);
            this.output.on('error', this.onStreamError);
        } catch (error) {
            this.onStreamError(asError(error));
        }

        if (this.hasAlreadyClosed(child)) {
            this.completeClose(child.exitCode);
        }
    }

    private readonly onStderr = (value: string | Buffer) => {
        this.stderr = (this.stderr + value.toString()).slice(-4000);
    };

    private readonly onOutputLine = (line: string) => {
        let event: unknown;
        try {
            event = JSON.parse(line);
        } catch {
            this.failReadiness(new Error('Invalid Python fixture protocol'));
            return;
        }
        if (typeof event !== 'object' || event === null || !('event' in event) || typeof event.event !== 'string') {
            this.failReadiness(new Error('Invalid Python fixture protocol'));
            return;
        }

        this.events.add(event.event);
        this.fixtureEvents.emit('event', event.event);
        if (event.event !== 'started') {
            return;
        }
        if (
            !('connection' in event) ||
            !isConnection(event.connection) ||
            !('pid' in event) ||
            typeof event.pid !== 'number'
        ) {
            this.failReadiness(new Error('Invalid Python fixture connection'));
            return;
        }
        this.connection = event.connection;
        this.pid = event.pid;
        this.readyForUse = true;
        this.ready.resolve();
    };

    private readonly onStreamError = (error: Error) => {
        const failure = asError(error);
        if (!this.streamFailure.completed) {
            this.streamFailure.resolve(failure);
        }
        this.failReadiness(failure);
    };

    private readonly onChildError = (error: Error) => {
        const failure = asError(error);
        if (this.readyForUse) {
            this.childFailure ??= failure;
        }
        this.failReadiness(failure);
        if (this.child?.pid === undefined) {
            this.completeClose();
        }
    };

    private readonly onChildClose = (code: number | null) => {
        this.completeClose(code);
    };

    private async stopInternal(): Promise<void> {
        const child = this.child;
        if (!child || this.closed || child.pid === undefined) {
            if (!this.closed) {
                this.completeClose(child?.exitCode);
            }
            if (this.childFailure) {
                this.cleanupError = this.childFailure;
                throw this.cleanupError;
            }
            return;
        }

        const timeoutFailure = new Error(`Owned Python fixture did not exit within ${cleanupTimeout}ms`);
        try {
            await raceTimeoutError(cleanupTimeout, timeoutFailure, this.stopCapturedChild(child));
        } catch (error) {
            this.cleanupError = error === timeoutFailure ? this.withCleanupDiagnostics(timeoutFailure) : asError(error);
            this.releaseStreams();
            throw this.cleanupError;
        }
    }

    private async stopCapturedChild(child: ChildProcess): Promise<void> {
        this.requestGracefulStop(child);
        const gracefulOutcome = await raceTimeout<'closed' | 'grace-timeout' | 'stream-failure'>(
            gracefulStopTimeout,
            'grace-timeout' as const,
            this.termination.then(() => 'closed' as const),
            this.streamFailure.promise.then(() => 'stream-failure' as const)
        );
        if (gracefulOutcome !== 'closed' && !this.closed) {
            this.requestForceStop(child);
            await this.termination;
        }
        if (this.childFailure) {
            throw this.childFailure;
        }
        if (this.streamFailure.completed) {
            throw new Error('Owned Python fixture stream failed: ' + this.streamFailure.value?.message);
        }
        if (this.forceStopFailure) {
            throw this.forceStopFailure;
        }
    }

    private requestGracefulStop(child: ChildProcess) {
        const stdin = child.stdin;
        if (!stdin) {
            this.onStreamError(new Error('Owned Python fixture has no stdin'));
            return;
        }
        try {
            if (this.options.sendEofOnStop) {
                stdin.end();
            } else {
                stdin.write('stop\n');
            }
        } catch (error) {
            this.onStreamError(asError(error));
        }
    }

    private requestForceStop(child: ChildProcess) {
        if (this.forceStopRequested) {
            return;
        }
        this.forceStopRequested = true;
        try {
            if (!child.kill('SIGKILL')) {
                this.forceStopFailure = new Error('Failed to force-stop owned Python fixture child');
            }
        } catch (error) {
            this.forceStopFailure = asError(error);
        }
    }

    private failReadiness(error: Error) {
        if (!this.ready.completed) {
            this.ready.reject(error);
        }
    }

    private completeClose(code?: number | null) {
        if (this.closed) {
            return;
        }
        this.closed = true;
        this.exitCode = code;
        this.failReadiness(new Error('Python fixture failed to start: ' + this.stderr));
        this.exited.resolve();
        this.fixtureEvents.emit('closed');
        this.releaseStreams();
    }

    private hasAlreadyClosed(child: ChildProcess) {
        return (
            (child.exitCode !== undefined && child.exitCode !== null) ||
            (child.signalCode !== undefined && child.signalCode !== null)
        );
    }

    private withCleanupDiagnostics(timeoutFailure: Error) {
        const diagnostics = [this.childFailure, this.streamFailure.value, this.forceStopFailure]
            .filter((error): error is Error => error !== undefined)
            .map((error) => error.message);
        return diagnostics.length ? new Error(timeoutFailure.message + ': ' + diagnostics.join('; ')) : timeoutFailure;
    }

    private releaseStreams() {
        if (this.streamsReleased) {
            return;
        }
        this.streamsReleased = true;
        const output = this.output;
        this.output = undefined;
        output?.removeListener('line', this.onOutputLine);
        output?.removeListener('error', this.onStreamError);
        output?.close();

        const child = this.child;
        if (!child) {
            return;
        }
        child.stderr?.removeListener('data', this.onStderr);
        child.stderr?.removeListener('error', this.onStreamError);
        child.stdout?.removeListener('error', this.onStreamError);
        child.stdin?.removeListener('error', this.onStreamError);
        child.stdin?.destroy();
        child.stdout?.destroy();
        child.stderr?.destroy();
    }
}
