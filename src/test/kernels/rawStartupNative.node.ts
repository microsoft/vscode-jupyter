// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from '../../platform/vscode-path/path';
import { createInterface } from 'readline';
import { anything, instance, mock, when } from 'ts-mockito';
import { PythonExtension, type Environment } from '@vscode/python-extension';
import * as sinon from 'sinon';
import { CancellationError, CancellationToken, EventEmitter, Uri } from 'vscode';
import * as ports from 'tcp-port-used';
import { Kernel } from '../../kernels/kernel';
import { KernelSocketMap } from '../../kernels/kernelSocket';
import { KernelStartupTelemetry } from '../../kernels/kernelStartupTelemetry.node';
import { DisplayOptions } from '../../kernels/displayOptions';
import { executeSilently } from '../../kernels/helpers';
import { RawSessionConnection } from '../../kernels/raw/session/rawSessionConnection.node';
import { RawJupyterSessionWrapper } from '../../kernels/raw/session/rawJupyterSession.node';
import { RawSocket } from '../../kernels/raw/session/rawSocket.node';
import { IKernelConnection, IKernelLauncher, IKernelProcess } from '../../kernels/raw/types';
import {
    IKernel,
    IKernelProvider,
    IKernelSessionFactory,
    LocalKernelSpecConnectionMetadata
} from '../../kernels/types';
import { createDeferred, raceTimeout, sleep } from '../../platform/common/utils/async';
import { ObservableDisposable } from '../../platform/common/utils/lifecycle';
import { generateUuid } from '../../platform/common/uuid';
import { setPythonApi } from '../../platform/interpreter/helpers';
import { logger } from '../../platform/logging';
import { resolvableInstance } from '../datascience/helpers';
import { createStartupKernel, initializeStartupMocks } from './rawStartup.node';

interface Started {
    event: 'started';
    connection: IKernelConnection;
    runtime: string;
    pid: number;
    versions: Record<string, string>;
}

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

export function getNativeStartupPython() {
    const python = process.env.RAW_KERNEL_STARTUP_PYTHON;
    if (!python) {
        throw new Error('RAW_KERNEL_STARTUP_PYTHON must name the private pinned test interpreter');
    }
    return python;
}

export class NativeStartupProcess extends ObservableDisposable implements IKernelProcess {
    public readonly canInterrupt = false;
    public readonly exitedEmitter = this._register(
        new EventEmitter<{ exitCode?: number; reason?: string; stderr: string }>()
    );
    public readonly exited = this.exitedEmitter.event;
    public kernelConnectionMetadata!: LocalKernelSpecConnectionMetadata;
    public connection!: IKernelConnection;
    public runtime!: string;
    public pid?: number;
    public versions: Record<string, string> = {};
    private child?: ChildProcessWithoutNullStreams;
    private cleanupListeners?: () => void;
    private readonly stopped = createDeferred<void>();
    private requestedStop = false;
    private disposeFailure?: { error: unknown };
    private finished = false;
    private stderr = '';

    constructor(
        private readonly python: string,
        private readonly root: string,
        private readonly gate: boolean
    ) {
        super();
    }

    public async initialize() {
        if (this.isDisposed) {
            throw new Error('The owned native startup process was disposed before initialization');
        }
        const started = createDeferred<Started>();
        const driver = path.join(process.cwd(), 'src', 'test', 'kernels', 'rawStartupDriver.py');
        const child = spawn(this.python, ['-u', driver], {
            windowsHide: true,
            env: {
                ...process.env,
                RAW_KERNEL_STARTUP_RUNTIME_ROOT: this.root,
                RAW_KERNEL_STARTUP_GATE: this.gate ? '1' : '0'
            }
        });
        this.child = child;
        const lines = createInterface({ input: child.stdout });
        const onStderr = (data: Buffer) => {
            this.stderr = (this.stderr + data.toString()).slice(-4000);
        };
        const onError = (error: Error) => {
            if (!started.completed) {
                started.reject(error);
            }
            if (child.pid === undefined) {
                this.finish(undefined, getErrorMessage(error));
            }
        };
        const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
            if (!started.completed) {
                started.reject(new Error(`Owned Python startup driver exited (${code}): ${this.stderr}`));
            }
            this.finish(code ?? -1, signal || undefined);
        };
        const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
            if (!started.completed) {
                started.reject(new Error(`Owned Python startup driver closed (${code}): ${this.stderr}`));
            }
            this.finish(code ?? -1, signal || undefined);
        };
        const onStdinError = (error: Error) => {
            if (!this.requestedStop) {
                if (!started.completed) {
                    started.reject(error);
                }
            }
        };
        const onLine = (line: string) => {
            try {
                const record: Started = JSON.parse(line);
                if (
                    record.event !== 'started' ||
                    record.connection.transport !== 'tcp' ||
                    typeof record.connection.key !== 'string' ||
                    !record.runtime
                ) {
                    throw new Error('Invalid owned Python startup driver response');
                }
                started.resolve(record);
            } catch (error) {
                started.reject(error);
            }
        };
        this.cleanupListeners = () => {
            child.stderr.removeListener('data', onStderr);
            child.removeListener('error', onError);
            child.removeListener('exit', onExit);
            child.removeListener('close', onClose);
            child.stdin.removeListener('error', onStdinError);
            lines.removeListener('line', onLine);
            lines.close();
        };
        child.stderr.on('data', onStderr);
        child.once('error', onError);
        child.once('exit', onExit);
        child.once('close', onClose);
        child.stdin.on('error', onStdinError);
        lines.on('line', onLine);
        const record = await started.promise;
        this.connection = record.connection;
        this.runtime = record.runtime;
        this.pid = record.pid;
        this.versions = record.versions;
        await Promise.all([
            ports.waitUntilUsed(this.connection.shell_port, 10, 10000),
            ports.waitUntilUsed(this.connection.iopub_port, 10, 10000)
        ]);
    }

    public async interrupt() {
        throw new Error('The owned native startup fixture does not support interrupts');
    }

    public override dispose(): Promise<void> {
        if (this.disposeFailure) {
            return Promise.reject(this.disposeFailure.error);
        }
        if (this.finished) {
            return this.stopped.promise;
        }
        if (!this.requestedStop) {
            this.requestedStop = true;
            if (!this.child) {
                this.finish();
            } else {
                try {
                    this.child.stdin.end('stop\n');
                } catch (error) {
                    this.disposeFailure = { error };
                    return Promise.reject(error);
                }
            }
        }
        return this.stopped.promise;
    }

    private finish(exitCode?: number, reason?: string) {
        if (this.finished) {
            return;
        }
        this.finished = true;
        const cleanupListeners = this.cleanupListeners;
        this.cleanupListeners = undefined;
        try {
            cleanupListeners?.();
        } finally {
            try {
                this.exitedEmitter.fire({ exitCode, reason, stderr: this.stderr });
            } finally {
                try {
                    super.dispose();
                } finally {
                    this.stopped.resolve();
                }
            }
        }
    }
}

export class NativeStartupFixture {
    public kernel!: Kernel;
    public process!: NativeStartupProcess;
    public session!: RawSessionConnection;
    public startup?: ReturnType<Kernel['start']>;
    public cleanupForcedDispose = false;
    public startedEvents = 0;
    private root!: string;
    private settled = false;
    private readonly disposables: { dispose(): void }[] = [];
    private connectionObserver?: sinon.SinonSpy;
    private connectionType?: typeof import('@jupyterlab/services/lib/kernel/default').KernelConnection;
    private disposePromise?: Promise<void>;

    constructor(
        private readonly python: string,
        private readonly gate = true,
        private readonly timeout = 6000
    ) {}

    public async initialize() {
        initializeStartupMocks();
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const services =
            require('@jupyterlab/services/lib/kernel/default') as typeof import('@jupyterlab/services/lib/kernel/default');
        this.connectionType = services.KernelConnection;
        this.connectionObserver = sinon.spy(services.KernelConnection.prototype, 'sendShellMessage');
        const api = mock<PythonExtension>();
        const environments = mock<PythonExtension['environments']>();
        const environment = mock<Environment>();
        const version = mock<NonNullable<Environment['version']>>();
        when(version.major).thenReturn(3);
        when(version.minor).thenReturn(14);
        when(version.micro).thenReturn(6);
        when(environment.id).thenReturn(this.python);
        when(environment.version).thenReturn(resolvableInstance(version));
        when(environment.tools).thenReturn([]);
        when(environments.known).thenReturn([instance(environment)]);
        when(api.environments).thenReturn(instance(environments));
        setPythonApi(instance(api));
        this.root = await fs.mkdtemp(path.join(os.tmpdir(), 'jupyter-startup-contract-'));
        this.process = new NativeStartupProcess(this.python, this.root, this.gate);
        await this.process.initialize();
        const uri = Uri.file(path.join(this.root, 'startup.ipynb'));
        const metadata = LocalKernelSpecConnectionMetadata.create({
            id: generateUuid(),
            interpreter: { id: this.python, uri: Uri.file(this.python) },
            kernelSpec: {
                name: 'python3',
                language: 'python',
                display_name: 'Owned native startup fixture',
                executable: this.python,
                argv: [this.python, '-m', 'ipykernel_launcher', '-f', '{connection_file}']
            }
        });
        this.process.kernelConnectionMetadata = metadata;
        const launcher = mock<IKernelLauncher>();
        let launched = false;
        when(launcher.launch(anything(), anything(), anything(), anything(), anything())).thenCall(async () => {
            if (launched) {
                await this.process.dispose();
                this.process = new NativeStartupProcess(this.python, this.root, this.gate);
                await this.process.initialize();
                this.process.kernelConnectionMetadata = metadata;
            }
            launched = true;
            return this.process;
        });
        const factory = mock<IKernelSessionFactory>();
        when(factory.create(anything())).thenCall(async (options: { token: CancellationToken }) => {
            this.session = new RawSessionConnection(
                uri,
                instance(launcher),
                Uri.file(this.root),
                metadata,
                this.timeout,
                'notebook'
            );
            await this.session.startKernel(options);
            return new RawJupyterSessionWrapper(this.session, uri, metadata);
        });
        this.kernel = createStartupKernel(uri, metadata, instance(factory), this.timeout);
        this.kernel.onStarted(() => this.startedEvents++);
        this.kernel.addHook('didStart', async (_session, token: CancellationToken) => {
            if (this.gate) {
                this.installGate(token);
            }
        });
        const created = new EventEmitter<IKernel>();
        const provider = mock<IKernelProvider>();
        when(provider.onDidCreateKernel).thenReturn(created.event);
        this.disposables.push(created);
        new KernelStartupTelemetry(instance(provider), this.disposables).activate();
        created.fire(this.kernel);
    }

    private installGate(token: CancellationToken) {
        const socket = KernelSocketMap.get(this.session.kernel!.id);
        if (!socket) {
            throw new Error('Native fixture could not find the production raw socket');
        }
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const serializer =
            require('@jupyterlab/services/lib/kernel/serialize') as typeof import('@jupyterlab/services/lib/kernel/serialize');
        const runtime = this.process.runtime;
        let gated = false;
        socket.addSendHook(async (data) => {
            const message = serializer.deserialize(data);
            if (gated || message.header.msg_type !== 'execute_request') {
                return;
            }
            gated = true;
            const ready = path.join(runtime, 'sender-ready');
            const until = Date.now() + 4000;
            while (!(await fs.pathExists(ready))) {
                if (token.isCancellationRequested) {
                    throw new CancellationError();
                }
                if (Date.now() >= until) {
                    throw new Error('The actual Python sender scheduling gate was not reached');
                }
                await sleep(1);
            }
            await fs.writeFile(
                path.join(runtime, 'startup-request-ready'),
                createHash('sha256').update(message.header.msg_id).digest('hex').slice(0, 16)
            );
        });
    }

    public start() {
        this.startup = this.kernel.start(new DisplayOptions(true));
        this.startup.then(
            () => (this.settled = true),
            () => (this.settled = true)
        );
        return this.startup;
    }

    public async firstCell() {
        return executeSilently(this.session.kernel!, 'print(42)');
    }

    public async state(): Promise<{
        fd_before: boolean;
        fd_after: boolean;
        pollin: boolean;
        executions: number;
        request_hash: string;
        error?: string;
    }> {
        return fs.readJSON(path.join(this.process.runtime, 'fixture-state.json'));
    }

    public dispose(passed = false): Promise<void> {
        this.disposePromise ??= this.disposeImpl(passed);
        return this.disposePromise;
    }

    private async disposeImpl(passed: boolean) {
        const nativeProcess = this.process;
        let state: Awaited<ReturnType<NativeStartupFixture['state']>> | undefined;
        let primaryFailure: unknown;
        let cleanupFailure: unknown;
        let processStopped = !nativeProcess || nativeProcess.isDisposed;
        let cleanupSettled = false;
        let runtimeClean = !nativeProcess;
        let rootClean = !this.root;
        const captureCleanupFailure = (error: unknown) => {
            cleanupFailure ??= error;
        };
        const settledBeforeCleanup = this.settled;
        let disposing: Promise<unknown> | undefined;

        try {
            try {
                state =
                    nativeProcess?.runtime &&
                    (await fs.pathExists(path.join(nativeProcess.runtime, 'fixture-state.json')))
                        ? await this.state()
                        : undefined;
            } catch (error) {
                primaryFailure = error;
            }

            if (this.startup && !settledBeforeCleanup) {
                try {
                    for (const future of this.connectionObserver?.returnValues || []) {
                        future.dispose();
                    }
                    for (const connection of this.connectionObserver?.thisValues || []) {
                        if (
                            this.connectionType &&
                            connection instanceof this.connectionType &&
                            connection.id === this.session?.kernel?.id
                        ) {
                            this.cleanupForcedDispose = true;
                            connection.dispose();
                        }
                    }
                } catch (error) {
                    captureCleanupFailure(error);
                }
            }

            try {
                const kernelDisposal = this.kernel?.dispose();
                disposing = Promise.resolve(kernelDisposal).catch((error) => {
                    captureCleanupFailure(error);
                });
            } catch (error) {
                captureCleanupFailure(error);
            }

            try {
                const socket = KernelSocketMap.get(this.session?.kernel?.id || '');
                if (socket instanceof RawSocket) {
                    socket.dispose();
                    if (KernelSocketMap.get(this.session?.kernel?.id || '') === socket) {
                        KernelSocketMap.delete(this.session.kernel!.id);
                    }
                }
            } catch (error) {
                captureCleanupFailure(error);
            }

            if (!processStopped && nativeProcess) {
                try {
                    const disposed = await raceTimeout(
                        1000,
                        nativeProcess.dispose().then(() => true)
                    );
                    processStopped = disposed === true && nativeProcess.isDisposed;
                    if (!processStopped) {
                        throw new Error('Native startup process disposal did not settle within 1000ms');
                    }
                } catch (error) {
                    processStopped = nativeProcess.isDisposed;
                    captureCleanupFailure(error);
                }
            }

            try {
                cleanupSettled =
                    (await raceTimeout(
                        1000,
                        Promise.all([this.startup?.catch(() => undefined), disposing]).then(() => true)
                    )) === true;
            } catch (error) {
                captureCleanupFailure(error);
            }

            if (processStopped) {
                try {
                    runtimeClean = !nativeProcess?.runtime || !(await fs.pathExists(nativeProcess.runtime));
                } catch (error) {
                    captureCleanupFailure(error);
                }
            }
        } finally {
            try {
                this.connectionObserver?.restore();
            } catch (error) {
                captureCleanupFailure(error);
            } finally {
                this.connectionObserver = undefined;
                this.connectionType = undefined;
            }
            for (const disposable of this.disposables.splice(0)) {
                try {
                    disposable.dispose();
                } catch (error) {
                    captureCleanupFailure(error);
                }
            }
            if (processStopped && (!nativeProcess?.runtime || runtimeClean) && this.root) {
                try {
                    await fs.remove(this.root);
                    rootClean = !(await fs.pathExists(this.root));
                } catch (error) {
                    captureCleanupFailure(error);
                }
            }
            const output = process.env.RAW_KERNEL_STARTUP_RESULTS;
            if (output) {
                try {
                    await fs.ensureDir(output);
                    await fs.writeJSON(
                        path.join(output, `contract-${generateUuid()}.json`),
                        {
                            variant: process.env.RAW_KERNEL_STARTUP_VARIANT || 'workspace',
                            passed,
                            versions: nativeProcess?.versions,
                            fixture_state: state,
                            settled_before_cleanup: settledBeforeCleanup,
                            started_events: this.startedEvents,
                            cleanup_network_poke_used: false,
                            cleanup_forced_connection_dispose: this.cleanupForcedDispose,
                            cleanup_promises_settled: cleanupSettled,
                            driver_stopped: nativeProcess?.isDisposed,
                            runtime_clean: runtimeClean,
                            root_clean: rootClean,
                            state_capture_error: primaryFailure && getErrorMessage(primaryFailure),
                            cleanup_error: cleanupFailure && getErrorMessage(cleanupFailure)
                        },
                        { spaces: 2 }
                    );
                } catch (error) {
                    captureCleanupFailure(error);
                }
            }
        }

        if (primaryFailure) {
            if (cleanupFailure !== undefined) {
                logger.error('Native startup fixture cleanup failed after state capture failed', cleanupFailure);
            }
            throw primaryFailure;
        }
        if (cleanupFailure) {
            throw cleanupFailure;
        }
        if (!runtimeClean || !rootClean || (passed && (this.cleanupForcedDispose || !cleanupSettled))) {
            throw new Error('Native startup contract did not finish with clean owned resources');
        }
    }
}
