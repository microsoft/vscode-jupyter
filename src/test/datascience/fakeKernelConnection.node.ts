// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Kernel, KernelMessage } from '@jupyterlab/services';
import { KernelConnection } from '@jupyterlab/services/lib/kernel/default';
import * as jupyterLabSerialize from '@jupyterlab/services/lib/kernel/serialize';
import { Event, EventEmitter } from 'vscode';
import { JupyterRequestCreator } from '../../kernels/jupyter/session/jupyterRequestCreator.node';
import {
    IStreamMsg,
    IExecuteReplyMsg,
    IExecuteInputMsg,
    IStatusMsg,
    IDisplayDataMsg,
    IUpdateDisplayDataMsg,
    IInfoReplyMsg
} from '@jupyterlab/services/lib/kernel/messages';

function deserialize(msg: string | ArrayBuffer): KernelMessage.IMessage {
    return typeof msg === 'string'
        ? JSON.parse(msg)
        : msg instanceof ArrayBuffer
        ? jupyterLabSerialize.deserialize(msg)
        : msg;
}
function serialize(msg: KernelMessage.IMessage): string | ArrayBuffer {
    return jupyterLabSerialize.serialize(msg);
}

export interface IFakeSocket {
    onSend: Event<KernelMessage.IMessage>;
    emitOnMessage(msg: KernelMessage.IMessage): void;
}

export function createKernelConnection(requestCreator: JupyterRequestCreator): {
    connection: KernelConnection;
    socket: IFakeSocket;
} {
    class FakeSocket implements WebSocket, IFakeSocket {
        public static instance: FakeSocket;
        public onopen: ((this: WebSocket, ev: any) => any) | null;
        public onmessage: ((this: WebSocket, ev: MessageEvent<any>) => any) | null;
        public onclose: ((this: WebSocket, ev: CloseEvent) => any) | null;
        public onerror: ((this: WebSocket, ev: any) => any) | null;

        private _onSend = new EventEmitter<KernelMessage.IMessage>();
        readonly CONNECTING: 0;
        readonly OPEN: 1;
        readonly CLOSING: 2;
        readonly CLOSED: 3;
        // eslint-disable-next-line @typescript-eslint/no-useless-constructor
        constructor(_url: string | URL, _protocols?: string | string[] | undefined) {
            FakeSocket.instance = this;
        }
        binaryType: BinaryType;
        bufferedAmount: number;
        extensions: string;
        protocol: string;
        readyState: number;
        url: string;
        addEventListener<K extends keyof WebSocketEventMap>(
            _type: K,
            _listener: (_this: WebSocket, _ev: WebSocketEventMap[K]) => any,
            _options?: boolean | AddEventListenerOptions | undefined
        ): void;
        addEventListener(
            _type: string,
            _listener: EventListenerOrEventListenerObject,
            _options?: boolean | AddEventListenerOptions | undefined
        ): void;
        addEventListener(_type: unknown, _listener: unknown, _options?: unknown): void {
            throw new Error('Method not implemented.');
        }
        removeEventListener<K extends keyof WebSocketEventMap>(
            type: K,
            listener: (this: WebSocket, ev: WebSocketEventMap[K]) => any,
            options?: boolean | EventListenerOptions | undefined
        ): void;
        removeEventListener(
            type: string,
            listener: EventListenerOrEventListenerObject,
            options?: boolean | EventListenerOptions | undefined
        ): void;
        removeEventListener(_type: unknown, _listener: unknown, _options?: unknown): void {
            throw new Error('Method not implemented.');
        }
        dispatchEvent(_event: any): boolean {
            throw new Error('Method not implemented.');
        }
        public onSend = this._onSend.event;
        public send(msg: string) {
            this._onSend.fire(deserialize(msg));
        }
        public emitOnMessage(msg: KernelMessage.IMessage) {
            if (this.onmessage) {
                this.onmessage(new MessageEvent('xyz', { data: serialize(msg) }));
            }
        }
        public close() {
            //
        }
    }

    const connection = new KernelConnection({
        model: { id: 'modelId', name: 'modelName' },
        clientId: 'clientId',
        handleComms: true,
        username: 'userName',
        serverSettings: {
            appendToken: true,
            appUrl: '',
            baseUrl: '',
            WebSocket: FakeSocket as any,
            fetch: requestCreator.getFetchMethod(),
            init: requestCreator.getRequestInit(),
            Headers: requestCreator.getHeadersCtor(),
            Request: requestCreator.getRequestCtor(),
            token: '',
            wsUrl: ''
        }
    });

    return { connection, socket: FakeSocket.instance };
}

export class MsgIdProducer {
    private _id = 1;
    public reset() {
        this._id = 1;
    }
    public next() {
        return `${this._id++}`;
    }
}

export function createMessageProducers(msgIdProducer: MsgIdProducer) {
    function forExecRequest(
        request: Kernel.IShellFuture<KernelMessage.IExecuteRequestMsg, KernelMessage.IExecuteReplyMsg>
    ) {
        const parentHeader = request.msg.header;
        function stream(content: IStreamMsg['content']) {
            const ioPubMessage: IStreamMsg = {
                channel: 'iopub',
                content,
                header: {
                    date: new Date().toISOString(),
                    msg_id: msgIdProducer.next(),
                    msg_type: 'stream',
                    session: '1',
                    username: '1',
                    version: '1'
                },
                metadata: {},
                parent_header: parentHeader
            };
            return ioPubMessage;
        }
        function reply(executionCount: number | IExecuteReplyMsg['content']) {
            const content: IExecuteReplyMsg['content'] =
                typeof executionCount === 'number'
                    ? {
                          execution_count: executionCount,
                          status: 'ok',
                          user_expressions: {}
                      }
                    : executionCount;
            const execReplyMessage: IExecuteReplyMsg = {
                channel: 'shell',
                content,
                header: {
                    date: new Date().toISOString(),
                    msg_id: msgIdProducer.next(),
                    msg_type: 'execute_reply',
                    session: '1',
                    username: '1',
                    version: '1'
                },
                metadata: {},
                parent_header: parentHeader
            };
            return execReplyMessage;
        }
        function execInput(executionCount: number) {
            const execInput: IExecuteInputMsg = {
                channel: 'iopub',
                content: {
                    code: request.msg.content.code,
                    execution_count: executionCount
                },
                header: {
                    date: new Date().toISOString(),
                    msg_id: msgIdProducer.next(),
                    msg_type: 'execute_input',
                    session: '1',
                    username: '1',
                    version: '1'
                },
                metadata: {},
                parent_header: parentHeader
            };
            return execInput;
        }
        function status(status: IStatusMsg['content']['execution_state']) {
            const idleMessage: IStatusMsg = {
                channel: 'iopub',
                content: {
                    execution_state: status
                },
                header: {
                    date: new Date().toISOString(),
                    msg_id: msgIdProducer.next(),
                    msg_type: 'status',
                    session: '1',
                    username: '1',
                    version: '1'
                },
                metadata: {},
                parent_header: parentHeader
            };
            return idleMessage;
        }
        function displayOutput(content: IDisplayDataMsg['content']) {
            const msg: IDisplayDataMsg = {
                channel: 'iopub',
                content,
                header: {
                    date: new Date().toISOString(),
                    msg_id: msgIdProducer.next(),
                    msg_type: 'display_data',
                    session: '1',
                    username: '1',
                    version: '1'
                },
                metadata: {},
                parent_header: parentHeader
            };
            return msg;
        }
        function displayUpdate(content: IUpdateDisplayDataMsg['content']) {
            const msg: IUpdateDisplayDataMsg = {
                channel: 'iopub',
                content,
                header: {
                    date: new Date().toISOString(),
                    msg_id: msgIdProducer.next(),
                    msg_type: 'update_display_data',
                    session: '1',
                    username: '1',
                    version: '1'
                },
                metadata: {},
                parent_header: parentHeader
            };
            return msg;
        }
        return {
            stream,
            reply,
            status,
            execInput,
            displayOutput,
            displayUpdate
        };
    }
    function forKernelInfo() {
        function reply() {
            const idleMessage: IInfoReplyMsg = {
                channel: 'shell',
                content: {
                    banner: '',
                    help_links: [],
                    implementation: '',
                    implementation_version: '',
                    language_info: {
                        codemirror_mode: {
                            name: 'ipython'
                        },
                        name: 'python',
                        nbconvert_exporter: '',
                        pygments_lexer: '',
                        version: ''
                    },
                    protocol_version: '',
                    status: 'ok'
                },
                header: {
                    date: new Date().toISOString(),
                    msg_id: msgIdProducer.next(),
                    msg_type: 'kernel_info_reply',
                    session: '1',
                    username: '1',
                    version: '1'
                },
                metadata: {},
                parent_header: {
                    date: new Date().toISOString(),
                    msg_id: msgIdProducer.next(),
                    msg_type: 'kernel_info_request',
                    session: '1',
                    username: '1',
                    version: '1'
                }
            };
            return idleMessage;
        }
        return {
            reply
        };
    }

    return {
        forExecRequest,
        forKernelInfo
    };
}
