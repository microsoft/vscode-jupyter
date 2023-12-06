// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IDisposable } from '@fluentui/react';
import type { KernelMessage } from '@jupyterlab/services';
import * as wireProtocol from '@nteract/messaging/lib/wire-protocol';
import uuid from 'uuid/v4';
import * as WebSocketWS from 'ws';
import type { Dealer, Subscriber } from 'zeromq';
import { traceError } from '../../../platform/logging';
import { noop } from '../../../platform/common/utils/misc';
import { IWebSocketLike } from '../../common/kernelSocketWrapper';
import { IKernelSocket } from '../../types';
import { IKernelConnection } from '../types';
import type { Channel } from '@jupyterlab/services/lib/kernel/messages';
import { getZeroMQ } from './zeromq.node';

function formConnectionString(config: IKernelConnection, channel: string) {
    const portDelimiter = config.transport === 'tcp' ? ':' : '-';
    const port = config[`${channel}_port` as keyof IKernelConnection];
    if (!port) {
        throw new Error(`Port not found for channel "${channel}"`);
    }
    return `${config.transport}://${config.ip}${portDelimiter}${port}`;
}
interface IChannels {
    shell: Dealer;
    control: Dealer;
    stdin: Dealer;
    iopub: Subscriber;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * This class creates a WebSocket front end on a ZMQ set of connections. It is special in that
 * it does all serialization/deserialization itself.
 */
export class RawSocket implements IWebSocketLike, IKernelSocket, IDisposable {
    public onopen: (event: { target: any }) => void = noop;
    public onerror: (event: { error: any; message: string; type: string; target: any }) => void = noop;
    public onclose: (event: { wasClean: boolean; code: number; reason: string; target: any }) => void = noop;
    public onmessage: (event: { data: WebSocketWS.Data; type: string; target: any }) => void = noop;
    private receiveHooks: ((data: WebSocketWS.Data) => Promise<void>)[] = [];
    private sendHooks: ((data: any, cb?: (err?: Error) => void) => Promise<void>)[] = [];
    private msgChain: Promise<any> = Promise.resolve();
    private sendChain: Promise<any> = Promise.resolve();
    private channels: IChannels;
    private closed = false;

    constructor(
        private connection: IKernelConnection,
        private serialize: (msg: KernelMessage.IMessage) => string | ArrayBuffer
    ) {
        // Setup our ZMQ channels now
        this.channels = this.generateChannels(connection);
    }

    public dispose() {
        if (!this.closed) {
            this.close();
        }
    }

    public close(): void {
        this.closed = true;
        // When the socket is completed / disposed, close all the event
        // listeners and shutdown the socket
        const closer = (closable: { close(): void }) => {
            try {
                closable.close();
            } catch (ex) {
                traceError(`Error during socket shutdown`, ex);
            }
        };
        closer(this.channels.control);
        closer(this.channels.iopub);
        closer(this.channels.shell);
        closer(this.channels.stdin);
    }

    public emit(event: string | symbol, ...args: any[]): boolean {
        switch (event) {
            case 'message':
                this.onmessage({ data: args[0], type: 'message', target: this });
                break;
            case 'close':
                this.onclose({ wasClean: true, code: 0, reason: '', target: this });
                break;
            case 'error':
                this.onerror({ error: '', message: 'to do', type: 'error', target: this });
                break;
            case 'open':
                this.onopen({ target: this });
                break;
            default:
                break;
        }
        return true;
    }
    public send(data: any, _callback: any): void {
        // This comes directly from the jupyter lab kernel. It should be a message already
        this.sendMessage(data as KernelMessage.IMessage, false);
    }

    public addReceiveHook(hook: (data: WebSocketWS.Data) => Promise<void>): void {
        this.receiveHooks.push(hook);
    }
    public removeReceiveHook(hook: (data: WebSocketWS.Data) => Promise<void>): void {
        this.receiveHooks = this.receiveHooks.filter((l) => l !== hook);
    }
    public addSendHook(hook: (data: any, cb?: ((err?: Error | undefined) => void) | undefined) => Promise<void>): void {
        this.sendHooks.push(hook);
    }
    public removeSendHook(
        hook: (data: any, cb?: ((err?: Error | undefined) => void) | undefined) => Promise<void>
    ): void {
        this.sendHooks = this.sendHooks.filter((p) => p !== hook);
    }
    private generateChannel<T extends Subscriber | Dealer>(
        connection: IKernelConnection,
        channel: Channel,
        ctor: () => T
    ): T {
        const result = ctor();
        result.connect(formConnectionString(connection, channel));
        this.processSocketMessages(channel, result).catch(
            traceError.bind(`Failed to read messages from channel ${channel}`)
        );
        return result;
    }
    private async processSocketMessages(channel: Channel, readable: Subscriber | Dealer) {
        // eslint-disable-next-line @typescript-eslint/await-thenable
        for await (const msg of readable) {
            // Make sure to quit if we are disposed.
            if (this.closed) {
                break;
            } else {
                this.onIncomingMessage(channel, msg);
            }
        }
    }

    private generateChannels(connection: IKernelConnection): IChannels {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const zmq = getZeroMQ();

        // Need a routing id for them to share.
        const routingId = uuid();

        // Wire up all of the different channels.
        const result: IChannels = {
            iopub: this.generateChannel(
                connection,
                'iopub',
                () =>
                    new zmq.Subscriber({
                        maxMessageSize: -1,
                        // If we get messages too fast and we're too slow in reading/handling the messages,
                        // then Node will stop reading messages from the stream & we'll stop getting the messages.
                        // See below comments on this config item:
                        // The high water mark is a hard limit on the maximum number of incoming messages ØMQ
                        // shall queue in memory for any single peer that the specified socket is communicating with.
                        // A value of zero means no limit.
                        // If this limit has been reached the socket shall enter an exceptional state and
                        // depending on the socket type, ØMQ shall take appropriate action such as blocking or dropping sent messages.
                        receiveHighWaterMark: 0
                    })
            ),
            shell: this.generateChannel(
                connection,
                'shell',
                () =>
                    new zmq.Dealer({
                        routingId,
                        sendHighWaterMark: 0,
                        receiveHighWaterMark: 0,
                        maxMessageSize: -1
                    })
            ),
            control: this.generateChannel(
                connection,
                'control',
                () =>
                    new zmq.Dealer({
                        routingId,
                        sendHighWaterMark: 0,
                        receiveHighWaterMark: 0,
                        maxMessageSize: -1
                    })
            ),
            stdin: this.generateChannel(
                connection,
                'stdin',
                () =>
                    new zmq.Dealer({
                        routingId,
                        sendHighWaterMark: 0,
                        receiveHighWaterMark: 0,
                        maxMessageSize: -1
                    })
            )
        };
        // What about hb port? Enchannel didn't use this one.

        // Make sure to subscribe to general iopub messages (this is stuff like status changes)
        result.iopub.subscribe();

        return result;
    }

    private onIncomingMessage(channel: Channel, data: any) {
        // Decode the message if still possible.
        const message: KernelMessage.IMessage = this.closed
            ? {}
            : (wireProtocol.decode(data, this.connection.key, this.connection.signature_scheme) as any);

        // Make sure it has a channel on it
        message.channel = channel as any;

        if (this.receiveHooks.length) {
            // Stick the receive hooks into the message chain. We use chain
            // to ensure that:
            // a) Hooks finish before we fire the event for real
            // b) Event fires
            // c) Next message happens after this one (so this side can handle the message before another event goes through)
            this.msgChain = this.msgChain
                .then(() => {
                    // Hooks expect serialized data as this normally comes from a WebSocket
                    const serialized = this.serialize(message);
                    return Promise.all(this.receiveHooks.map((p) => p(serialized)));
                })
                .then(() => this.fireOnMessage(message, channel));
        } else {
            this.msgChain = this.msgChain.then(() => this.fireOnMessage(message, channel));
        }
    }

    private fireOnMessage(message: KernelMessage.IMessage, channel: Channel) {
        if (!this.closed) {
            try {
                ensureFields(message, channel);
                this.onmessage({ data: message as any, type: 'message', target: this });
            } catch (ex) {
                // Swallow this error, so that other messages get processed.
                traceError(`Failed to handle message in Jupyter Kernel package ${JSON.stringify(message)}`, ex);
            }
        }
    }

    private sendMessage(msg: KernelMessage.IMessage, bypassHooking: boolean) {
        // First encode the message.
        const data = wireProtocol.encode(msg as any, this.connection.key, this.connection.signature_scheme);

        // Then send through our hooks, and then post to the real zmq socket
        if (!bypassHooking && this.sendHooks.length) {
            // Separate encoding for ipywidgets. It expects the same result a WebSocket would generate.
            const hookData = this.serialize(msg);

            this.sendChain = this.sendChain
                .then(() => Promise.all(this.sendHooks.map((s) => s(hookData, noop))))
                .then(async () => {
                    try {
                        await this.postToSocket(msg.channel, data);
                    } catch (ex) {
                        traceError(`Failed to write data to the kernel channel ${msg.channel}`, data, ex);
                        throw ex;
                    }
                });
        } else {
            this.sendChain = this.sendChain.then(() => {
                this.postToSocket(msg.channel, data);
            });
        }
        // Ensure we don't have any unhandled exceptions (swallow exceptions as we're not awaiting on this promise).
        this.sendChain.catch(noop);
    }

    private postToSocket(channel: string, data: any) {
        const socket = (this.channels as any)[channel];
        if (socket) {
            (socket as Dealer).send(data).catch((exc) => {
                traceError(`Error communicating with the kernel`, exc);
            });
        } else {
            traceError(`Attempting to send message on invalid channel: ${channel}`);
        }
    }
}

/**
 * Required fields for `IKernelHeader`.
 */
const HEADER_FIELDS = ['username', 'version', 'session', 'msg_id', 'msg_type'];
/**
 * Required fields and types for contents of various types of `kernel.IMessage`
 * messages on the iopub channel.
 */
const IOPUB_CONTENT_FIELDS = {
    stream: { name: 'string', text: 'string' },
    display_data: { data: 'object', metadata: 'object' },
    execute_input: { code: 'string', execution_count: 'number' },
    execute_result: {
        execution_count: 'number',
        data: 'object',
        metadata: 'object'
    },
    error: { ename: 'string', evalue: 'string', traceback: 'object' },
    status: {
        execution_state: ['string', ['starting', 'idle', 'busy', 'restarting', 'dead']]
    },
    clear_output: { wait: 'boolean' },
    comm_open: { comm_id: 'string', target_name: 'string', data: 'object' },
    comm_msg: { comm_id: 'string', data: 'object' },
    comm_close: { comm_id: 'string' },
    shutdown_reply: { restart: 'boolean' } // Emitted by the IPython kernel.
};

/**
 * Sometimes we get responses from kernels that don't send the required information.
 * Python starts the kernels (e.g. java kernels), and java sends information to python.
 * Python then takes this and formats those messages to be sent to the front end.
 * The front end uses Jupyter Lab npm package which validates the data & that's what we also use.
 * Unfortunately the data is not formatted by python in our case as we take the raw output from
 * the kernel and sent that to the npm package & things fall over.
 * So we need to format the data ourselves.
 *
 * An excellent example is the `Ganymede` kernel.
 * This kernel doesn't send all of the fields the npm package expects.
 *
 * If we do not add the necessary fields, the npm package throws errors, as it validates the incoming data.
 * Validation can be found here node_modules/@jupyterlab/services/lib/kernel/validate.js
 */
function ensureFields(message: KernelMessage.IMessage, channel: Channel) {
    const header = message.header as any;
    HEADER_FIELDS.forEach((field) => {
        if (typeof header[field] !== 'string') {
            header[field] = '';
        }
    });
    if (typeof message.channel !== 'string') {
        message.channel = channel;
    }
    if (!message.content) {
        message.content = {};
    }
    if (!message.metadata) {
        message.metadata = {};
    }
    if (message.channel === 'iopub') {
        ensureIOPubContent(message);
    }
}

function ensureIOPubContent(message: KernelMessage.IMessage) {
    if (message.channel !== 'iopub') {
        return;
    }
    const messageType = message.header.msg_type as keyof typeof IOPUB_CONTENT_FIELDS;
    if (messageType in IOPUB_CONTENT_FIELDS) {
        const fields = IOPUB_CONTENT_FIELDS[messageType] as Record<string, any>;
        // Check for unknown message type.
        if (fields === undefined) {
            return;
        }
        const names = Object.keys(fields);
        const content = message.content as Record<string, any>;
        for (let i = 0; i < names.length; i++) {
            let args = fields[names[i]];
            if (!Array.isArray(args)) {
                args = [args];
            }
            const fieldName = names[i];
            if (!(fieldName in content) || typeof content[fieldName] !== args[0]) {
                // Looks like a mandatory field is missing, add the field with a default value.
                switch (args[0]) {
                    case 'string':
                        content[fieldName] = '';
                        break;
                    case 'boolean':
                        content[fieldName] = false;
                        break;
                    case 'object':
                        content[fieldName] = {};
                        break;
                    case 'number':
                        content[fieldName] = 0;
                        break;
                }
            }
        }
    }
}
