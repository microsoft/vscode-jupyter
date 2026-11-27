// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { EventEmitter } from 'events';
import * as sinon from 'sinon';
import type * as WebSocketWS from 'ws';
import type WebSocketIsomorphic from 'isomorphic-ws';
import { KernelMessage } from '@jupyterlab/services';
import * as serializer from '@jupyterlab/services/lib/kernel/serialize';
import { createDeferred, raceTimeoutError } from '../../../platform/common/utils/async';
import { noop } from '../../../platform/common/utils/misc';
import { ClassType } from '../../../platform/ioc/types';
import { IKernelSocket } from '../../types';
import { KernelSocketMap } from '../../kernelSocket';
import { JupyterRequestCreator } from './jupyterRequestCreator.node';
import { JupyterRequestCreator as WebRequestCreator } from './jupyterRequestCreator.web';

type Hook = (data: WebSocketWS.Data) => Promise<void>;

// This stands in for the provider, not for the wrapper under test.
class Recorder extends EventEmitter {
    public onopen = null;
    public onerror = null;
    public onclose: (() => void) | null = null;
    public onmessage: ((event: { data: unknown }) => void) | null = null;
    constructor(_url: string, _protocols?: unknown, _options?: unknown) {
        super();
    }
    public send = noop;
    public ping = noop;
    public close() {
        this.emit('close');
        this.onclose?.();
    }
    public addEventListener(event: string, listener: (...args: unknown[]) => void) {
        this.on(event, listener);
    }
    public removeEventListener(event: string, listener: (...args: unknown[]) => void) {
        this.off(event, listener);
    }
}

// The provider double implements only the socket surface used by these tests.
const recorderCtor = Recorder as unknown as ClassType<WebSocketIsomorphic>;

// Wrong event shapes should fail rather than leave a test waiting indefinitely.
function waitFor(promise: Promise<void>) {
    return raceTimeoutError(2000, new Error('Timed out waiting for socket event'), promise);
}

suite('Kernel socket receive payload', () => {
    let socket: Recorder & IKernelSocket;
    let kernelId: string;
    let sequence = 0;
    let timerStub: sinon.SinonStub;
    let hooks: Hook[];

    setup(() => {
        hooks = [];
        kernelId = `receive-payload-test-${++sequence}`;
        timerStub = sinon.stub(global, 'setInterval').returns({} as NodeJS.Timeout);
        const ctor = new JupyterRequestCreator().wrapWebSocketCtor(recorderCtor);
        socket = new ctor(`ws://test/kernels/${kernelId}/channels`) as unknown as Recorder & IKernelSocket;
    });

    teardown(() => {
        try {
            hooks.forEach((hook) => socket.removeReceiveHook(hook));
            socket.close();
            socket.removeAllListeners();
            assert.isFalse(KernelSocketMap.has(kernelId));
        } finally {
            timerStub.restore();
        }
    });

    function addHook(hook: Hook) {
        hooks.push(hook);
        socket.addReceiveHook(hook);
    }

    test('decodes one UTF-8 slice for both hooks and preserves FIFO provider arguments', async () => {
        const text = 'héllo 🌍';
        const backing = Buffer.concat([Buffer.from([0xff]), Buffer.from(text), Buffer.from([0xfe])]);
        const payload = backing.subarray(1, backing.length - 1);
        const extra = {};
        const decode = sinon.spy(payload, 'toString');
        const entered = createDeferred<void>();
        const release = createDeferred<void>();
        const delivered = createDeferred<void>();
        const seen: unknown[][] = [];
        const events: unknown[][] = [];
        const order: string[] = [];
        try {
            addHook(async (data) => {
                seen.push(['first', data]);
                order.push(`hook1-${seen.length === 1 ? 'first' : 'second'}`);
                if (seen.length === 1) {
                    entered.resolve();
                    await release.promise;
                }
            });
            addHook(async (data) => {
                seen.push(['second', data]);
                order.push(`hook2-${seen.length === 2 ? 'first' : 'second'}`);
            });
            socket.on('message', (...args: unknown[]) => {
                events.push(args);
                order.push(`provider-${events.length}`);
                if (events.length === 2) {
                    delivered.resolve();
                }
            });
            assert.isTrue(socket.emit('message', payload, false, extra));
            assert.isTrue(socket.emit('message', 'next', true));
            await waitFor(entered.promise);
            assert.lengthOf(events, 0);
            assert.lengthOf(seen, 2);
            release.resolve();
            await waitFor(delivered.promise);

            assert.strictEqual(seen[0][1], text);
            assert.strictEqual(seen[1][1], text);
            assert.strictEqual(seen[2][1], 'next');
            assert.strictEqual(seen[3][1], 'next');
            assert.strictEqual(decode.callCount, 1);
            assert.deepEqual(decode.firstCall.args, ['utf8']);
            assert.deepEqual(order, [
                'hook1-first',
                'hook2-first',
                'provider-1',
                'hook1-second',
                'hook2-second',
                'provider-2'
            ]);
            assert.lengthOf(events[0], 3);
            assert.strictEqual(events[0][0], payload);
            assert.strictEqual(events[0][1], false);
            assert.strictEqual(events[0][2], extra);
            assert.lengthOf(events[1], 2);
            assert.strictEqual(events[1][0], 'next');
            assert.strictEqual(events[1][1], true);
        } finally {
            release.resolve();
            decode.restore();
        }
    });

    test('delivers synchronously without hooks or decoding', () => {
        const payload = Buffer.from('text');
        const decode = sinon.spy(payload, 'toString');
        const extra = {};
        const events: unknown[][] = [];
        try {
            socket.on('message', (...args: unknown[]) => events.push(args));
            assert.isTrue(socket.emit('message', payload, false, extra));
            assert.lengthOf(events, 1);
            assert.lengthOf(events[0], 3);
            assert.strictEqual(events[0][0], payload);
            assert.strictEqual(events[0][1], false);
            assert.strictEqual(events[0][2], extra);
            assert.strictEqual(decode.callCount, 0);
        } finally {
            decode.restore();
        }
    });

    test('leaves old, binary and opaque shapes and flags unchanged', async () => {
        const buffer = Buffer.from([0, 255, 128]);
        const arrayBuffer = new Uint8Array([0, 255, 128]).buffer;
        const view = new Uint8Array([0, 255, 128]);
        const opaque = { data: 'opaque' };
        const frames: unknown[][] = [
            ['already text'],
            [arrayBuffer],
            [buffer],
            [buffer, true],
            [buffer, 0],
            [buffer, null],
            [buffer, undefined],
            [buffer, 'false'],
            [view, false],
            [opaque, false]
        ];
        const seen: unknown[] = [];
        addHook(async (data) => {
            seen.push(data);
        });
        for (const [index, frame] of frames.entries()) {
            const delivered = createDeferred<void>();
            let actual: unknown[] = [];
            socket.once('message', (...args: unknown[]) => {
                actual = args;
                delivered.resolve();
            });
            socket.emit('message', ...frame);
            await waitFor(delivered.promise);
            assert.strictEqual(seen[index], frame[0]);
            assert.lengthOf(actual, frame.length);
            frame.forEach((value, i) => assert.strictEqual(actual[i], value));
        }
        assert.lengthOf(seen, frames.length);
        assert.deepEqual([...buffer], [0, 255, 128]);
        assert.deepEqual([...view], [0, 255, 128]);
    });

    test('preserves serialized legacy and v1 binary messages, including v1 without attachments', async () => {
        const v1 = KernelMessage.supportedKernelWebSocketProtocols.v1KernelWebsocketJupyterOrg;
        const makeMessage = (withAttachment: boolean) =>
            KernelMessage.createMessage<KernelMessage.ICommMsgMsg<'iopub'>>({
                channel: 'iopub',
                session: 'session',
                msgType: 'comm_msg',
                content: { comm_id: 'comm', data: {} },
                buffers: withAttachment ? [new Uint8Array([0, 255, 128]).buffer] : []
            });
        const frames = [
            { protocol: '', message: makeMessage(true), flag: false, flagged: false },
            { protocol: v1, message: makeMessage(true), flag: true, flagged: true },
            { protocol: v1, message: makeMessage(false), flag: true, flagged: true }
        ];
        const seen: unknown[] = [];
        addHook(async (data) => {
            seen.push(data);
        });
        for (const [index, frame] of frames.entries()) {
            const encoded = serializer.serialize(frame.message, frame.protocol);
            assert.instanceOf(encoded, ArrayBuffer);
            const delivered = createDeferred<void>();
            let args: unknown[] = [];
            socket.once('message', (...received: unknown[]) => {
                args = received;
                delivered.resolve();
            });
            if (frame.flagged) {
                socket.emit('message', encoded, frame.flag);
            } else {
                socket.emit('message', encoded);
            }
            await waitFor(delivered.promise);
            assert.strictEqual(seen[index], encoded);
            assert.lengthOf(args, frame.flagged ? 2 : 1);
            assert.strictEqual(args[0], encoded);
            if (frame.flagged) {
                assert.strictEqual(args[1], frame.flag);
            }
            const decoded = serializer.deserialize(
                seen[index] as ArrayBuffer,
                frame.protocol
            ) as KernelMessage.ICommMsgMsg<'iopub'>;
            assert.strictEqual(decoded.content.comm_id, 'comm');
            if (index < 2) {
                assert.lengthOf(decoded.buffers!, 1);
                const attachment = decoded.buffers![0];
                const bytes = ArrayBuffer.isView(attachment)
                    ? new Uint8Array(attachment.buffer, attachment.byteOffset, attachment.byteLength)
                    : new Uint8Array(attachment);
                assert.deepEqual([...bytes], [0, 255, 128]);
            } else {
                assert.lengthOf(decoded.buffers!, 0);
            }
        }
        assert.lengthOf(seen, frames.length);
    });

    test('keeps the web wrapper single-argument data opaque without an adapter', async () => {
        const webId = `${kernelId}-web`;
        const ctor = new WebRequestCreator().wrapWebSocketCtor(recorderCtor);
        const web = new ctor(`ws://test/kernels/${webId}/channels`) as unknown as Recorder & IKernelSocket;
        const received = createDeferred<void>();
        const payload = new Uint8Array([0, 255, 128]).buffer;
        const input = { data: payload };
        let hookData: unknown;
        let providerData: unknown;
        const hook: Hook = async (data) => {
            hookData = data;
        };
        try {
            web.addReceiveHook(hook);
            web.onmessage = (event) => {
                providerData = event.data;
                received.resolve();
            };
            web.emit('open');
            web.onmessage!(input);
            await waitFor(received.promise);
            assert.strictEqual(hookData, payload);
            assert.strictEqual(providerData, payload);
        } finally {
            web.removeReceiveHook(hook);
            web.close();
            web.removeAllListeners();
            assert.isFalse(KernelSocketMap.has(webId));
        }
    });

    test('withholds a rejected frame and delivers the following healthy frame', async () => {
        const delivered = createDeferred<void>();
        const seen: unknown[] = [];
        const events: unknown[][] = [];
        addHook(async (data) => {
            seen.push(data);
            if (data === 'bad') {
                throw new Error('test rejection');
            }
        });
        socket.on('message', (...args: unknown[]) => {
            events.push(args);
            delivered.resolve();
        });
        socket.emit('message', 'bad', false);
        socket.emit('message', 'good', true);
        await waitFor(delivered.promise);
        assert.deepEqual(seen, ['bad', 'good']);
        assert.deepEqual(events, [['good', true]]);
    });
});
