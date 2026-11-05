// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import * as zeroMQ from './zeromq.node';
import { RawSocket } from './rawSocket.node';
import { IKernelConnection } from '../types';

class FakeSocket {
    public closed = false;
    public closeCalls = 0;
    public closeFailures = 0;

    public connect(_endpoint: string) {
        return undefined;
    }
    public subscribe() {
        return undefined;
    }
    public close() {
        this.closeCalls += 1;
        if (this.closeFailures) {
            this.closeFailures -= 1;
            throw new Error('Close failed');
        }
        this.closed = true;
    }
    public async *[Symbol.asyncIterator]() {
        await new Promise<void>(() => undefined);
        yield [];
    }
}

suite('Raw Socket failed-start cleanup', () => {
    teardown(() => sinon.restore());

    test('strict cleanup retries every open handle retained by ordinary close', () => {
        class FakeDealer extends FakeSocket {}
        class FakeSubscriber extends FakeSocket {}
        sinon.stub(zeroMQ, 'getZeroMQ').returns({
            Dealer: FakeDealer,
            Subscriber: FakeSubscriber
        } as unknown as typeof import('zeromq'));
        const connection: IKernelConnection = {
            control_port: 1,
            hb_port: 2,
            iopub_port: 3,
            ip: '127.0.0.1',
            key: '',
            shell_port: 4,
            signature_scheme: 'hmac-sha256',
            stdin_port: 5,
            transport: 'tcp'
        };
        const socket = new RawSocket(connection, () => '');
        const internals = socket as unknown as {
            channels: {
                control: FakeSocket;
                iopub: FakeSocket;
                shell: FakeSocket;
                stdin: FakeSocket;
            };
            recoveryPeers: Set<FakeSocket>;
        };
        const recoveryPeer = new FakeDealer();
        internals.channels.control.closeFailures = 2;
        internals.channels.shell.closeFailures = 2;
        recoveryPeer.closeFailures = 1;
        internals.recoveryPeers.add(recoveryPeer);

        socket.close();
        assert.isFalse(internals.channels.control.closed);
        assert.isFalse(recoveryPeer.closed);
        assert.throws(() => socket.closeAfterFailedStartup(), /control/);
        assert.isFalse(internals.channels.control.closed);
        assert.isFalse(internals.channels.shell.closed);
        assert.isTrue(recoveryPeer.closed);
        assert.strictEqual(internals.recoveryPeers.size, 0);
        assert.strictEqual(internals.channels.control.closeCalls, 2);
        assert.strictEqual(internals.channels.shell.closeCalls, 2);
        assert.strictEqual(internals.channels.iopub.closeCalls, 1);
        assert.strictEqual(internals.channels.stdin.closeCalls, 1);
        assert.strictEqual(recoveryPeer.closeCalls, 2);

        socket.closeAfterFailedStartup();
        assert.isTrue(internals.channels.control.closed);
        assert.isTrue(internals.channels.shell.closed);
        assert.strictEqual(internals.channels.control.closeCalls, 3);
        assert.strictEqual(internals.channels.shell.closeCalls, 3);
    });
});
