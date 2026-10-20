// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as wire from '@nteract/messaging/lib/wire-protocol';
import { anything, instance, mock, when } from 'ts-mockito';
import { CancellationToken, EventEmitter, Memento, NotebookDocument, Uri, WorkspaceConfiguration } from 'vscode';
import type { Publisher, Router } from 'zeromq';
import { Kernel } from '../../kernels/kernel';
import { executeSilently } from '../../kernels/helpers';
import { DisplayOptions } from '../../kernels/displayOptions';
import { RawSessionConnection } from '../../kernels/raw/session/rawSessionConnection.node';
import { RawJupyterSessionWrapper } from '../../kernels/raw/session/rawJupyterSession.node';
import { getZeroMQ } from '../../kernels/raw/session/zeromq.node';
import { IKernelConnection, IKernelLauncher, IKernelProcess } from '../../kernels/raw/types';
import { IKernelController, IKernelSessionFactory, LocalKernelSpecConnectionMetadata } from '../../kernels/types';
import { createDeferred } from '../../platform/common/utils/async';
import type { Deferred } from '../../platform/common/utils/async';
import { ObservableDisposable } from '../../platform/common/utils/lifecycle';
import { generateUuid } from '../../platform/common/uuid';
import { WIDGET_MIMETYPE } from '../../platform/common/constants';
import { mockedVSCodeNamespaces, resetVSCodeMocks } from '../vscode-mock';

type Message = wire.RawJupyterMessage;
export type StartupGate = 'none' | 'execute' | 'final-info' | 'unrecoverable';
const widgetVersionOutPrefix = 'e976ee50-99ed-4aba-9b6b-9dcd5634d07d:IPyWidgets:';

export function initializeStartupMocks() {
    resetVSCodeMocks();
    const config = mock<WorkspaceConfiguration>();
    when(config.get(anything(), anything())).thenCall((_, fallback) => fallback);
    when(mockedVSCodeNamespaces.workspace.getConfiguration(anything())).thenReturn(instance(config));
}

export function createStartupKernel(
    uri: Uri,
    metadata: LocalKernelSpecConnectionMetadata,
    factory: IKernelSessionFactory,
    timeout: number,
    commands: string[] = []
) {
    const notebook = mock<NotebookDocument>();
    when(notebook.uri).thenReturn(uri);
    const storage = mock<Memento>();
    when(storage.get(anything(), anything())).thenCall((_, fallback) => fallback);
    return new Kernel(
        uri,
        instance(notebook),
        metadata,
        factory,
        {
            launchTimeout: timeout,
            interruptTimeout: 1000,
            themeMatplotlibPlots: false,
            enableExtendedPythonKernelCompletions: false,
            runStartupCommands: commands
        },
        instance(mock<IKernelController>()),
        [],
        instance(storage),
        undefined,
        { isSupported: true }
    );
}

export class StartupPeer extends ObservableDisposable implements IKernelProcess {
    public readonly canInterrupt = false;
    public readonly exitedEmitter = this._register(
        new EventEmitter<{ exitCode?: number; reason?: string; stderr: string }>()
    );
    public readonly exited = this.exitedEmitter.event;
    public readonly gated = createDeferred<void>();
    public readonly peers = new Set<string>();
    public readonly executionCounts = new Map<string, number>();
    public readonly executionCodes: string[] = [];
    public auxiliaryReply: 'normal' | 'mismatch' | 'bad-signature' = 'normal';
    public additionalExecutionGate?: number;
    public delayedCommand?: { code: string; delay: number };
    public widgetVersion?: 7 | 8;
    public widgetVersionRequests = 0;
    public exitOnRequest = false;
    public omitFirstWarmIdle = false;
    public omitFirstAuxiliaryAck = false;
    public readonly errors: unknown[] = [];
    public connection!: IKernelConnection;
    public kernelConnectionMetadata!: LocalKernelSpecConnectionMetadata;
    private shell!: Router;
    private control!: Router;
    private publisher!: Publisher;
    private primary?: string;
    private queued: { message: Message; channel: 'shell' | 'control' }[] = [];
    private opened: boolean;
    private shellInfos = 0;
    private executions = 0;
    private stopping = false;
    private additionalGateUsed = false;
    private warmIdleOmitted = false;
    private auxiliaryAckOmitted = false;
    private publishing = Promise.resolve();
    private readers: Promise<void>[] = [];
    private latestShellMessage?: Message;

    constructor(public readonly gate: StartupGate) {
        super();
        this.opened = gate === 'none';
    }

    public async initialize() {
        const zmq = getZeroMQ();
        this.shell = new zmq.Router({ linger: 0 });
        this.control = new zmq.Router({ linger: 0 });
        this.publisher = new zmq.Publisher({ linger: 0 });
        await Promise.all([
            this.shell.bind('tcp://127.0.0.1:0'),
            this.control.bind('tcp://127.0.0.1:0'),
            this.publisher.bind('tcp://127.0.0.1:0')
        ]);
        const port = (socket: Router | Publisher) => Number(socket.lastEndpoint!.split(':').pop());
        this.connection = {
            transport: 'tcp',
            ip: '127.0.0.1',
            key: generateUuid(),
            signature_scheme: 'hmac-sha256',
            shell_port: port(this.shell),
            control_port: port(this.control),
            iopub_port: port(this.publisher),
            stdin_port: port(this.control),
            hb_port: port(this.control)
        };
        this.readers = [this.read(this.shell, 'shell'), this.read(this.control, 'control')];
    }

    private async read(socket: Router, channel: 'shell' | 'control') {
        try {
            for await (const frames of socket) {
                const message = wire.decode(frames, this.connection.key, this.connection.signature_scheme);
                if (this.exitOnRequest) {
                    this.dispose();
                    break;
                }
                const identity = message.idents[0].toString('hex');
                if (channel === 'shell') {
                    this.latestShellMessage = message;
                    this.primary ??= identity;
                    if (identity !== this.primary) {
                        this.peers.add(identity);
                        if (this.gate !== 'unrecoverable') {
                            await this.release();
                        }
                        if (this.omitFirstAuxiliaryAck && !this.auxiliaryAckOmitted) {
                            this.auxiliaryAckOmitted = true;
                            continue;
                        }
                    }
                    if (identity === this.primary && message.header.msg_type === 'kernel_info_request') {
                        this.shellInfos += 1;
                    }
                }
                if (
                    message.header.msg_type === 'execute_request' &&
                    !this.additionalGateUsed &&
                    this.additionalExecutionGate === this.executions + 1
                ) {
                    this.opened = false;
                    this.additionalGateUsed = true;
                }
                const block =
                    channel === 'shell' &&
                    identity === this.primary &&
                    !this.opened &&
                    (((this.gate === 'execute' || this.gate === 'unrecoverable') &&
                        message.header.msg_type === 'execute_request') ||
                        (this.gate === 'final-info' && this.shellInfos >= 3));
                if (block) {
                    this.queued.push({ message, channel });
                    this.gated.resolve();
                } else if (!(this.gate === 'unrecoverable' && identity !== this.primary)) {
                    await this.respond(message, channel);
                }
            }
        } catch (error) {
            if (!this.stopping) {
                this.errors.push(error);
                this.gated.reject(error);
            }
        }
    }

    public async release() {
        this.opened = true;
        for (const item of this.queued.splice(0)) {
            await this.respond(item.message, item.channel);
        }
    }

    private message(request: Message, type: Message['header']['msg_type'], content: object): Message {
        return {
            header: { ...request.header, msg_id: generateUuid(), msg_type: type, session: 'test-kernel' },
            parent_header: request.header,
            content,
            metadata: {},
            buffers: [],
            idents: request.idents
        };
    }

    private publish(request: Message, execution_state: string) {
        return this.publishOutput(request, 'status', { execution_state });
    }

    private publishOutput(request: Message, type: Message['header']['msg_type'], content: object) {
        const message = this.message(request, type, content);
        message.idents = [];
        this.publishing = this.publishing.then(() =>
            this.publisher.send(wire.encode(message, this.connection.key, this.connection.signature_scheme))
        );
        return this.publishing;
    }

    public async emitWidgetDisplayData() {
        if (!this.latestShellMessage) {
            throw new Error('Cannot emit widget display data before a shell request');
        }
        await this.publishOutput(this.latestShellMessage, 'display_data', {
            data: { [WIDGET_MIMETYPE]: {} },
            metadata: {}
        });
    }

    private async respond(message: Message, channel: 'shell' | 'control') {
        await this.publish(message, 'busy');
        let response: Message;
        if (message.header.msg_type === 'kernel_info_request') {
            response = this.message(message, 'kernel_info_reply', {
                status: 'ok',
                banner: '',
                implementation: 'ipython',
                implementation_version: '9.0',
                protocol_version: '5.3',
                language_info: { name: 'python', version: '3.14.6' },
                help_links: []
            });
        } else if (message.header.msg_type === 'execute_request') {
            this.executionCodes.push(message.content.code);
            if (this.delayedCommand && message.content.code === this.delayedCommand.code) {
                await new Promise<void>((resolve) => setTimeout(resolve, this.delayedCommand!.delay));
            }
            this.executionCounts.set(message.header.msg_id, (this.executionCounts.get(message.header.msg_id) || 0) + 1);
            response = this.message(message, 'execute_reply', {
                status: 'ok',
                execution_count: ++this.executions,
                payload: [],
                user_expressions: {}
            });
            if (message.content.code.includes(widgetVersionOutPrefix)) {
                this.widgetVersionRequests += 1;
                if (this.widgetVersion) {
                    await this.publishOutput(message, 'stream', {
                        name: 'stdout',
                        text: `${widgetVersionOutPrefix}${this.widgetVersion}.0.0\n`
                    });
                }
            }
        } else {
            throw new Error(`Unexpected startup fixture request: ${message.header.msg_type}`);
        }
        const auxiliary = channel === 'shell' && message.idents[0].toString('hex') !== this.primary;
        if (auxiliary && this.auxiliaryReply === 'mismatch') {
            response.parent_header = { ...response.parent_header, msg_id: 'not-the-probe' };
        }
        await (channel === 'shell' ? this.shell : this.control).send(
            wire.encode(
                response,
                auxiliary && this.auxiliaryReply === 'bad-signature' ? 'incorrect-signing-key' : this.connection.key,
                this.connection.signature_scheme
            )
        );
        if (
            this.omitFirstWarmIdle &&
            !this.warmIdleOmitted &&
            channel === 'shell' &&
            message.header.msg_type === 'kernel_info_request'
        ) {
            this.warmIdleOmitted = true;
        } else {
            await this.publish(message, 'idle');
        }
    }

    public async interrupt() {
        throw new Error('The startup fixture does not support interrupts');
    }

    public override dispose() {
        if (this.isDisposed || this.stopping) {
            return;
        }
        this.stopping = true;
        this.shell.close();
        this.control.close();
        this.publisher.close();
        this.exitedEmitter.fire({ exitCode: 0, stderr: '' });
        super.dispose();
    }

    public async stopped() {
        await Promise.all(this.readers);
    }
}

export class RawStartupFixture {
    public kernel!: Kernel;
    public session!: RawSessionConnection;
    public startup?: ReturnType<Kernel['start']>;
    public peer: StartupPeer;
    public startedEvents = 0;
    public firstExecutionId?: string;
    public launches = 0;
    public readonly startupCommands: string[] = [];
    private readonly generations: StartupPeer[] = [];
    private nextLaunchGate?: { entered: Deferred<void>; release: Deferred<void> };

    constructor(
        gate: StartupGate = 'execute',
        private readonly timeout = 6000
    ) {
        this.peer = new StartupPeer(gate);
        this.generations.push(this.peer);
    }

    public async initialize() {
        initializeStartupMocks();
        await this.peer.initialize();
        const metadata = LocalKernelSpecConnectionMetadata.create({
            id: generateUuid(),
            kernelSpec: {
                name: 'python3',
                language: 'python',
                display_name: 'Startup fixture',
                executable: 'python',
                argv: ['python', '-m', 'ipykernel_launcher', '-f', '{connection_file}']
            }
        });
        this.peer.kernelConnectionMetadata = metadata;
        const uri = Uri.file(`startup-${generateUuid()}.ipynb`);
        const launcher = mock<IKernelLauncher>();
        when(launcher.launch(anything(), anything(), anything(), anything(), anything())).thenCall(async () => {
            this.launches += 1;
            const launchGate = this.nextLaunchGate;
            this.nextLaunchGate = undefined;
            if (launchGate) {
                launchGate.entered.resolve();
                await launchGate.release.promise;
            }
            if (this.peer.isDisposed) {
                this.peer = new StartupPeer(this.peer.gate);
                this.generations.push(this.peer);
                await this.peer.initialize();
                this.peer.kernelConnectionMetadata = metadata;
            }
            return this.peer;
        });
        this.session = new RawSessionConnection(
            uri,
            instance(launcher),
            Uri.file(''),
            metadata,
            this.timeout,
            'notebook'
        );
        const factory = mock<IKernelSessionFactory>();
        when(factory.create(anything())).thenCall(async (options: { token: CancellationToken }) => {
            if (this.session.isDisposed) {
                this.session = new RawSessionConnection(
                    uri,
                    instance(launcher),
                    Uri.file(''),
                    metadata,
                    this.timeout,
                    'notebook'
                );
            }
            await this.session.startKernel(options);
            return new RawJupyterSessionWrapper(this.session, uri, metadata);
        });
        this.kernel = createStartupKernel(uri, metadata, instance(factory), this.timeout, this.startupCommands);
        this.kernel.onStarted(() => this.startedEvents++);
        this.kernel.addHook('didStart', async (session) => {
            const future = session.kernel.requestExecute(
                {
                    code: 'pass',
                    silent: true,
                    store_history: false,
                    allow_stdin: false,
                    stop_on_error: false
                },
                true
            );
            this.firstExecutionId = future.msg.header.msg_id;
            await future.done;
        });
    }

    public start() {
        this.startup = this.kernel.start(new DisplayOptions(true));
        return this.startup;
    }

    public async firstCell() {
        await this.executeCell('pass');
    }

    public async executeCell(code: string) {
        await executeSilently(this.session.kernel!, code);
    }

    public async executeCellThroughStartGate(code: string) {
        const session = await this.kernel.restarting.then(() => this.kernel.start(new DisplayOptions(false)));
        await executeSilently(session.kernel!, code);
    }

    public deferNextLaunch() {
        const entered = createDeferred<void>();
        const release = createDeferred<void>();
        this.nextLaunchGate = { entered, release };
        return {
            entered: entered.promise,
            release: () => release.resolve()
        };
    }

    public executionCount(code: string) {
        return this.generations.flatMap((generation) => generation.executionCodes).filter((item) => item === code)
            .length;
    }

    public get widgetVersionRequests() {
        return this.generations.reduce((count, generation) => count + generation.widgetVersionRequests, 0);
    }

    public async dispose() {
        this.nextLaunchGate?.release.resolve();
        if (!this.peer.isDisposed) {
            await this.peer.release();
        }
        await this.startup?.catch(() => undefined);
        await this.kernel.dispose();
        for (const generation of this.generations) {
            generation.dispose();
            await generation.stopped();
        }
    }

    public get errors() {
        return this.generations.flatMap((generation) => generation.errors);
    }
}
