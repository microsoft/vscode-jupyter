// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { IDisposable } from '@fluentui/react';
import type { KernelMessage } from '@jupyterlab/services';
import * as uuid from 'uuid/v4';
import * as WebSocketWS from 'ws';
import { createSockets } from 'enchannel-zmq-backend';
import * as JMP from 'jmp';
import { traceError } from '../../../platform/logging';
import { noop } from '../../../platform/common/utils/misc';
import { IWebSocketLike } from '../../common/kernelSocketWrapper';
import { IKernelSocket } from '../../types';
import { IKernelConnection } from '../types';
import type { Channel } from '@jupyterlab/services/lib/kernel/messages';
import { EventEmitter } from 'vscode';

interface IChannels {
    shell: JMP.Socket;
    control: JMP.Socket;
    stdin: JMP.Socket;
    iopub: JMP.Socket;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * This class creates a WebSocket front end on a ZMQ set of connections. It is special in that
 * it does all serialization/deserialization itself.
 */
export class RawSocket implements IWebSocketLike, IKernelSocket, IDisposable {
    private _onAnyMessage = new EventEmitter<{ msg: string; direction: 'send' }>();
    public onAnyMessage = this._onAnyMessage.event;
    public onopen: (event: { target: any }) => void = noop;
    public onerror: (event: { error: any; message: string; type: string; target: any }) => void = noop;
    public onclose: (event: { wasClean: boolean; code: number; reason: string; target: any }) => void = noop;
    public onmessage: (event: { data: WebSocketWS.Data; type: string; target: any }) => void = noop;
    private receiveHooks: ((data: WebSocketWS.Data) => Promise<void>)[] = [];
    private sendHooks: ((data: any, cb?: (err?: Error) => void) => Promise<void>)[] = [];
    private msgChain: Promise<any> = Promise.resolve();
    private sendChain: Promise<any> = Promise.resolve();
    private channelsPromise: Promise<IChannels>;
    private channels: IChannels | undefined;
    private closed = false;

    constructor(
        connection: IKernelConnection,
        private serialize: (msg: KernelMessage.IMessage) => string | ArrayBuffer,
        private deserialize: (data: ArrayBuffer | string) => KernelMessage.IMessage
    ) {
        // Setup our ZMQ channels now
        this.channelsPromise = this.generateChannels(connection).then((c) => (this.channels = c));
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
        if (this.channels) {
            closer(this.channels.control);
            closer(this.channels.iopub);
            closer(this.channels.shell);
            closer(this.channels.stdin);
        }
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
    public sendToRealKernel(data: any, _callback: any): void {
        // If from ipywidgets, this will be serialized already, so turn it back into a message so
        // we can add the special hash to it.
        const message = this.deserialize(data);
        // These messages are sent directly to the kernel bypassing the Jupyter lab npm libraries.
        // As a result, we don't get any notification that messages were sent (on the anymessage signal).
        // To ensure those signals can still be used to monitor such messages, send them via a callback so that we can emit these messages on the anymessage signal.
        this._onAnyMessage.fire({ msg: data, direction: 'send' });
        // Send this directly (don't call back into the hooks)
        this.sendMessage(message, true);
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
    private processSocketMessages(channel: Channel, socket: JMP.Socket) {
        socket.on('message', (data) => {
            this.onIncomingMessage(channel, data);
        });
    }

    private async generateChannels(connection: IKernelConnection) {
        // Need a routing id for them to share.
        const routingId = uuid();
        const result = await createSockets({ ...connection, version: 1 }, undefined, routingId);

        // What about hb port? Enchannel didn't use this one.

        // Subscribe to all messages
        this.processSocketMessages('control', result.control);
        this.processSocketMessages('shell', result.shell);
        this.processSocketMessages('iopub', result.iopub);
        this.processSocketMessages('stdin', result.stdin);

        return result;
    }

    private onIncomingMessage(channel: Channel, data: any) {
        // Decode the message if still possible.
        const message: KernelMessage.IMessage = this.closed ? {} : data;

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
        // Then send through our hooks, and then post to the real zmq socket
        if (!bypassHooking && this.sendHooks.length) {
            // Separate encoding for ipywidgets. It expects the same result a WebSocket would generate.
            const hookData = this.serialize(msg);

            this.sendChain = this.sendChain
                .then(() => Promise.all(this.sendHooks.map((s) => s(hookData, noop))))
                .then(() => this.postToSocket(msg.channel, msg));
        } else {
            this.sendChain = this.sendChain.then(() => {
                return this.postToSocket(msg.channel, msg);
            });
        }
        // Ensure we don't have any unhandled exceptions (swallow exceptions as we're not awaiting on this promise).
        this.sendChain.catch(noop);
    }

    private async postToSocket(channel: Channel, message: KernelMessage.IMessage) {
        const channels = await this.channelsPromise;
        const socket = (channels as any)[channel] as JMP.Socket;
        if (socket) {
            const jmpMessage = new JMP.Message({ ...message, buffers: undefined });
            socket.send(jmpMessage, undefined, (err) => {
                if (err) {
                    traceError(`Error communicating with the kernel`, err);
                }
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
