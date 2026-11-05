// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as wire from '@nteract/messaging/lib/wire-protocol';
import type { Router, Publisher } from 'zeromq';
import { EventEmitter } from 'vscode';
import { randomBytes } from 'crypto';
import { getZeroMQ } from '../../kernels/raw/session/zeromq.node';
import { IKernelConnection, IKernelProcess } from '../../kernels/raw/types';
import { LocalKernelConnectionMetadata } from '../../kernels/types';
import { generateUuid } from '../../platform/common/uuid';
import { ObservableDisposable } from '../../platform/common/utils/lifecycle';
import { createDeferred } from '../../platform/common/utils/async';

type Message = wire.RawJupyterMessage;

/** A protocol model; the separate Python fixture verifies the real missed-FD mechanism. */
export class RawKernelStartupFixture {
    private readonly shell: Router;
    private readonly control: Router;
    private readonly stdin: Router;
    private readonly publisher: Publisher;
    private readonly readers: Promise<void>[] = [];
    private readonly timers = new Map<ReturnType<typeof setTimeout>, () => void>();
    private blocked?: Message;
    private primaryIdentity?: string;
    private heldRecovery?: Message;
    private blockNextRequest = false;
    private closed = false;
    private executionCount = 0;
    public readonly executions: string[] = [];
    public readonly executionIds = new Map<string, number>();
    public readonly recoveryIdentities = new Set<string>();
    public stallNextExecution = false;
    public ignoreRecoveryReplies = false;
    public invalidRecoveryReply = false;
    public invalidRecoveryType = false;
    public invalidRecoverySignature = false;
    public supportsSubshells = true;
    public implementation = 'ipython';
    public recoveryDispatchDelay = 0;
    public pendingRecoveryRequests = 0;
    public holdFirstRecovery = false;
    public stallSecondRecoveryInfo = false;
    public recoveryKernelInfoRequests = 0;
    public lastDispatched?: 'primary-info' | 'auxiliary-info' | 'execute';
    public connection!: IKernelConnection;
    public readonly interpreter = 'C:\\fixture\\python.exe';
    public get openSocketCount() {
        return [this.shell, this.control, this.stdin, this.publisher].filter((socket) => !socket.closed).length;
    }

    constructor(
        private readonly stall = true,
        private readonly unrecoverable = false,
        private readonly executionDelay = 0
    ) {
        const zmq = getZeroMQ();
        this.shell = new zmq.Router({ linger: 0 });
        this.control = new zmq.Router({ linger: 0 });
        this.stdin = new zmq.Router({ linger: 0 });
        this.publisher = new zmq.Publisher({ linger: 0 });
    }

    public async start() {
        const endpoints = await Promise.all(
            [this.shell, this.control, this.stdin, this.publisher].map(async (socket) => {
                await socket.bind('tcp://127.0.0.1:*');
                return Number(socket.lastEndpoint?.split(':').pop());
            })
        );
        this.connection = {
            shell_port: endpoints[0],
            control_port: endpoints[1],
            stdin_port: endpoints[2],
            iopub_port: endpoints[3],
            hb_port: 0,
            ip: '127.0.0.1',
            transport: 'tcp',
            key: randomBytes(32).toString('hex'),
            signature_scheme: 'hmac-sha256'
        };
        this.readers.push(this.read(this.shell, 'shell'), this.read(this.control, 'control'));
        return this;
    }

    public fork() {
        return new RawKernelStartupFixture(this.stall, this.unrecoverable, this.executionDelay).start();
    }

    public createProcess(metadata: LocalKernelConnectionMetadata): IKernelProcess {
        const fixture = this;
        return new (class extends ObservableDisposable implements IKernelProcess {
            public readonly connection = fixture.connection;
            public readonly kernelConnectionMetadata = metadata;
            public readonly pid = process.pid;
            public readonly canInterrupt = false;
            private readonly exitEvent = this._register(
                new EventEmitter<{ exitCode?: number; reason?: string; stderr: string }>()
            );
            public readonly exited = this.exitEvent.event;
            private readonly actualTermination = createDeferred<void>();
            public readonly termination = this.actualTermination.promise;
            private stopping = false;
            public interrupt(): Promise<void> {
                return Promise.resolve();
            }
            public override dispose() {
                if (this.stopping) {
                    return;
                }
                this.stopping = true;
                void fixture.stop().then(() => {
                    this.actualTermination.resolve();
                    this.exitEvent.fire({ exitCode: 0, stderr: '' });
                    super.dispose();
                });
            }
        })();
    }

    public async stop() {
        if (!this.closed) {
            this.closed = true;
            if (this.heldRecovery) {
                this.heldRecovery = undefined;
                this.pendingRecoveryRequests -= 1;
            }
            this.timers.forEach((resolve, timer) => {
                clearTimeout(timer);
                resolve();
            });
            this.timers.clear();
            this.shell.close();
            this.control.close();
            this.stdin.close();
            this.publisher.close();
        }
        await Promise.all(this.readers);
    }

    private async read(socket: Router, channel: 'shell' | 'control') {
        try {
            for await (const frames of socket) {
                const message = wire.decode(frames, this.connection.key, this.connection.signature_scheme);
                const identity = message.idents[0].toString('hex');
                if (channel === 'shell') {
                    this.primaryIdentity ??= identity;
                    if (
                        identity === this.primaryIdentity &&
                        (message.header.msg_type === 'kernel_info_request' ||
                            message.header.msg_type === 'execute_request')
                    ) {
                        if (message.header.msg_type === 'kernel_info_request' && this.recoveryIdentities.size) {
                            this.recoveryKernelInfoRequests += 1;
                        }
                        if (
                            this.blockNextRequest ||
                            (this.stallSecondRecoveryInfo &&
                                message.header.msg_type === 'kernel_info_request' &&
                                this.recoveryKernelInfoRequests === 2)
                        ) {
                            this.blockNextRequest = false;
                            this.blocked = message;
                            continue;
                        }
                    }
                    if (
                        this.blocked &&
                        identity !== this.primaryIdentity &&
                        message.header.msg_type === 'kernel_info_request'
                    ) {
                        this.recoveryIdentities.add(identity);
                        if (this.heldRecovery) {
                            const previous = this.heldRecovery;
                            this.heldRecovery = undefined;
                            try {
                                await this.dispatch(socket, channel, previous);
                            } finally {
                                this.pendingRecoveryRequests -= 1;
                            }
                        }
                        if (!this.unrecoverable) {
                            const original = this.blocked;
                            this.blocked = undefined;
                            await this.dispatch(this.shell, 'shell', original);
                        }
                        if (this.ignoreRecoveryReplies) {
                            continue;
                        }
                        if (this.invalidRecoveryReply) {
                            await this.dispatch(socket, channel, {
                                ...message,
                                header: { ...message.header, msg_id: generateUuid() }
                            });
                            continue;
                        }
                        if (this.invalidRecoveryType || this.invalidRecoverySignature) {
                            const response = this.message(
                                message,
                                this.invalidRecoveryType ? 'execute_reply' : 'kernel_info_reply',
                                channel,
                                {}
                            );
                            await socket.send([
                                ...message.idents,
                                ...wire.encode(
                                    response,
                                    this.invalidRecoverySignature ? 'incorrect-fixture-key' : this.connection.key
                                )
                            ]);
                            continue;
                        }
                        if (this.recoveryDispatchDelay) {
                            this.pendingRecoveryRequests += 1;
                            this.readers.push(
                                (async () => {
                                    try {
                                        await this.delay(this.recoveryDispatchDelay);
                                        if (!this.closed) {
                                            await this.dispatch(socket, channel, message);
                                        }
                                    } finally {
                                        this.pendingRecoveryRequests -= 1;
                                    }
                                })()
                            );
                            continue;
                        }
                        if (this.holdFirstRecovery && this.recoveryIdentities.size === 1) {
                            this.pendingRecoveryRequests += 1;
                            this.heldRecovery = message;
                            this.blockNextRequest = true;
                            continue;
                        }
                    }
                    if (
                        (this.stallNextExecution || (this.stall && this.executionCount === 0)) &&
                        message.header.msg_type === 'execute_request' &&
                        !this.blocked
                    ) {
                        this.stallNextExecution = false;
                        this.blocked = message;
                        continue;
                    }
                }
                await this.dispatch(socket, channel, message);
            }
        } catch (error) {
            if (!this.closed) {
                throw error;
            }
        }
    }

    private message(parent: Message, type: Message['header']['msg_type'], channel: string, content: object) {
        return {
            header: {
                msg_id: generateUuid(),
                msg_type: type,
                session: 'fixture-kernel',
                username: 'fixture',
                version: '5.3',
                date: new Date().toISOString()
            },
            parent_header: parent.header,
            metadata: {},
            content,
            buffers: [],
            channel
        };
    }

    private async status(parent: Message, state: 'busy' | 'idle') {
        await this.publisher.send(
            wire.encode(this.message(parent, 'status', 'iopub', { execution_state: state }), this.connection.key)
        );
    }

    private delay(timeout: number) {
        return new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
                this.timers.delete(timer);
                resolve();
            }, timeout);
            this.timers.set(timer, resolve);
        });
    }

    private async dispatch(socket: Router, channel: 'shell' | 'control', request: Message) {
        await this.status(request, 'busy');
        if (request.header.msg_type === 'kernel_info_request') {
            const response = this.message(request, 'kernel_info_reply', channel, {
                status: 'ok',
                protocol_version: '5.3',
                implementation: this.implementation,
                implementation_version: '9.17.1',
                language_info: { name: 'python', version: '3.14.6' },
                supported_features: this.supportsSubshells ? ['kernel subshells'] : [],
                banner: '',
                help_links: []
            });
            await socket.send([...request.idents, ...wire.encode(response, this.connection.key)]);
        } else if (request.header.msg_type === 'execute_request') {
            this.executionCount += 1;
            this.executionIds.set(request.header.msg_id, (this.executionIds.get(request.header.msg_id) || 0) + 1);
            const code = typeof request.content.code === 'string' ? request.content.code : '';
            this.executions.push(code);
            if (this.executionDelay) {
                await this.delay(this.executionDelay);
            }
            if (this.closed) {
                return;
            }
            if (code.includes('_VSCODE_sys.executable')) {
                await this.publisher.send(
                    wire.encode(
                        this.message(request, 'stream', 'iopub', { name: 'stdout', text: this.interpreter + '\n' }),
                        this.connection.key
                    )
                );
            }
            await socket.send([
                ...request.idents,
                ...wire.encode(
                    this.message(request, 'execute_reply', channel, {
                        status: 'ok',
                        execution_count: this.executionCount,
                        payload: [],
                        user_expressions: {}
                    }),
                    this.connection.key
                )
            ]);
        }
        this.lastDispatched =
            request.header.msg_type === 'kernel_info_request'
                ? request.idents[0].toString('hex') === this.primaryIdentity
                    ? 'primary-info'
                    : 'auxiliary-info'
                : 'execute';
        await this.status(request, 'idle');
    }
}
