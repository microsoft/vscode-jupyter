// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EventEmitter } from 'events';
import { assert } from 'chai';
import { KernelSocketWrapper } from './kernelSocketWrapper';

class FakeWebSocket extends EventEmitter {
    public onopen = null;
    public onerror = null;
    public onclose = null;
    public onmessage = null;

    public send(_data: unknown, _callback: unknown): void {
        // No-op for receive-hook tests.
    }

    public close(): void {
        // No-op for receive-hook tests.
    }
}

suite('KernelSocketWrapper', () => {
    test('Normalizes a text frame Buffer before invoking receive hooks', async () => {
        const Socket = KernelSocketWrapper(FakeWebSocket);
        const socket = new Socket();
        const payload = Buffer.from('{"msg":"hello"}');

        const hookData = new Promise<unknown>((resolve) => {
            socket.addReceiveHook(async (data) => resolve(data));
        });
        const deliveredData = new Promise<{ data: unknown; isBinary: boolean }>((resolve) => {
            socket.on('message', (data, isBinary) => resolve({ data, isBinary }));
        });

        socket.emit('message', payload, false);

        assert.strictEqual(await hookData, payload.toString());
        assert.deepEqual(await deliveredData, { data: payload, isBinary: false });
    });

    test('Leaves a binary frame Buffer unchanged for receive hooks', async () => {
        const Socket = KernelSocketWrapper(FakeWebSocket);
        const socket = new Socket();
        const payload = Buffer.from([0, 1, 2, 3]);

        const hookData = new Promise<unknown>((resolve) => {
            socket.addReceiveHook(async (data) => resolve(data));
        });

        socket.emit('message', payload, true);

        assert.strictEqual(await hookData, payload);
    });

    test('Delivers a message even when a receive hook throws', async () => {
        const Socket = KernelSocketWrapper(FakeWebSocket);
        const socket = new Socket();
        const payload = Buffer.from('{"msg":"still delivered"}');

        socket.addReceiveHook(async () => {
            throw new Error('receive hook failed');
        });
        const deliveredData = new Promise<{ data: unknown; isBinary: boolean }>((resolve) => {
            socket.on('message', (data, isBinary) => resolve({ data, isBinary }));
        });

        socket.emit('message', payload, false);

        assert.deepEqual(await deliveredData, { data: payload, isBinary: false });
    });
});
